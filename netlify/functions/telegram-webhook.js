const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const nodemailer = require('nodemailer'); 

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        console.log("Method Not Allowed: Expected POST.");
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // --- Variables de Entorno y Cliente Supabase ---
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    // 🔑 VARIABLES DE CORREO
    const SMTP_HOST = process.env.SMTP_HOST;
    const SMTP_PORT = process.env.SMTP_PORT;
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;

    // 🚨 VERIFICACIÓN DE TODAS LAS VARIABLES ESENCIALES
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TELEGRAM_BOT_TOKEN || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
        console.error("FATAL ERROR: Faltan variables de entorno esenciales (DB, Telegram o SMTP).");
        return { statusCode: 500, body: "Error de configuración. Verifique SMTP y Supabase." };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = JSON.parse(event.body);

    // ----------------------------------------------------------------------
    // 🔑 PASO 1: OBTENER LA TASA DE CAMBIO DINÁMICA
    // ----------------------------------------------------------------------
    let EXCHANGE_RATE = 1.0; 
    
    try {
        const { data: configData, error: configError } = await supabase
            .from('configuracion_sitio')
            .select('tasa_dolar')
            .eq('id', 1) 
            .maybeSingle();

        if (configError) {
            console.warn(`WARN DB: Fallo al obtener tasa de dólar. Usando tasa por defecto (1.0). Mensaje: ${configError.message}`);
        } else if (configData && configData.tasa_dolar > 0) {
            EXCHANGE_RATE = configData.tasa_dolar;
            console.log(`LOG: Tasa de dólar obtenida de DB: ${EXCHANGE_RATE}`);
        }
    } catch (e) {
        console.error("ERROR CRITICO al obtener configuración de DB:", e.message);
    }


    // ----------------------------------------------------------------------
    // 💡 LÓGICA CLAVE: Manejo de la consulta de Callback
    // ----------------------------------------------------------------------
    if (body.callback_query) {
        const callbackData = body.callback_query.data;
        const chatId = body.callback_query.message.chat.id;
        const messageId = body.callback_query.message.message_id;
        const originalText = body.callback_query.message.text;
        const transactionPrefix = 'mark_done_';
        
        if (callbackData.startsWith(transactionPrefix)) {
            const transactionId = callbackData.replace(transactionPrefix, '');
            const NEW_STATUS = 'REALIZADA'; 
            
            console.log(`LOG: >>> INICIO PROCESO DE MARCADO. Transacción ID: ${transactionId} <<<`);
            
            let emailCliente = null; 

            try {
                // 2. BUSCAR LA TRANSACCIÓN (SELECCIONANDO LA COLUMNA 'email' de transactions)
                console.log(`LOG: Buscando datos de transacción ${transactionId} en 'transactions'.`);
                const { data: transactionData, error: fetchError } = await supabase
                    .from('transactions')
                    .select('status, google_id, "finalPrice", currency, game, "cartDetails", email') 
                    .eq('id_transaccion', transactionId)
                    .maybeSingle();

                if (fetchError || !transactionData) {
                    console.error(`ERROR DB: Fallo al buscar la transacción ${transactionId}.`, fetchError ? fetchError.message : 'No encontrada');
                    await sendTelegramAlert(TELEGRAM_BOT_TOKEN, chatId, `❌ <b>Error:</b> No se encontró la transacción ${transactionId}.`, messageId);
                    return { statusCode: 200, body: "Processed" };
                }

                const { 
                    status: currentStatus, 
                    google_id, 
                    "finalPrice": finalPrice, 
                    currency,
                    game,
                    "cartDetails": productDetails,
                    email: transactionEmail // OBTENEMOS EL EMAIL DIRECTO DE LA TRANSACCIÓN
                } = transactionData;
                
                // INICIALIZAMOS emailCliente con el email de la transacción (fuente principal)
                emailCliente = transactionEmail; 

                console.log(`LOG: Transacción encontrada. Google ID: ${google_id}. Email en transac.: ${emailCliente || 'Nulo'}. Estado: ${currentStatus}.`);
                
                // 2.1. BÚSQUEDA SECUNDARIA: SOLO SI EL EMAIL DE LA TRANSACCIÓN ES NULO Y HAY GOOGLE_ID
                if (!emailCliente && google_id) {
                    console.warn(`WARN: Email en transacción es nulo. Intentando buscar en tabla 'usuarios' usando google_id: ${google_id}.`);
                    const { data: userData, error: userError } = await supabase
                        .from('usuarios')
                        .select('email')
                        .eq('google_id', google_id)
                        .maybeSingle();

                    if (userError) {
                        console.error(`ERROR DB: Fallo al buscar el email del usuario ${google_id}. Mensaje: ${userError.message}`);
                    } else if (userData && userData.email) {
                        emailCliente = userData.email;
                        console.log(`LOG: ✅ Email de cliente encontrado (vía usuarios): ${emailCliente}`);
                    } else {
                        console.warn(`WARN: El google_id ${google_id} NO tiene registro en la tabla 'usuarios'.`);
                    }
                } else if (!emailCliente) {
                    console.warn(`WARN: Email en transacción es nulo y google_id es nulo. No se intentó búsqueda secundaria.`);
                }
                
                // 🔍 DETECCIÓN MEJORADA DE RECARGA DE SALDO
                // Busca "Recarga de Saldo" en cualquier parte del string
                const IS_WALLET_RECHARGE = game && game.includes('Recarga de Saldo');
                console.log(`LOG: DIAGNÓSTICO: game = "${game}"`);
                console.log(`LOG: DIAGNÓSTICO: IS_WALLET_RECHARGE = ${IS_WALLET_RECHARGE} (game.includes('Recarga de Saldo'))`);

                const amountInTransactionCurrency = parseFloat(finalPrice);
                let amountToInject = amountInTransactionCurrency;
                let injectionMessage = ""; 
                let updateDBSuccess = true; 


                // -------------------------------------------------------------
                // 3. LÓGICA DE INYECCIÓN CONDICIONAL - CORREGIDA DEFINITIVAMENTE
                // -------------------------------------------------------------
                
                console.log(`LOG: ⚡ PROCESANDO - Estado actual: ${currentStatus}, Es recarga: ${IS_WALLET_RECHARGE}`);
                
                if (IS_WALLET_RECHARGE) { 
                    console.log(`LOG: 🎯 DETECTADA RECARGA DE SALDO - Iniciando proceso para Google ID: ${google_id}`);
                    
                    // PASO 3.1: LÓGICA CONDICIONAL DE CONVERSIÓN
                    if (currency === 'VES' || currency === 'BS') { 
                        if (EXCHANGE_RATE > 0) {
                            amountToInject = amountInTransactionCurrency / EXCHANGE_RATE;
                            console.log(`LOG: Moneda VES detectada. Convirtiendo ${amountInTransactionCurrency.toFixed(2)} VES a USD con tasa ${EXCHANGE_RATE}. Resultado: $${amountToInject.toFixed(2)} USD.`);
                        } else {
                            throw new Error("ERROR FATAL: El tipo de cambio (tasa_dolar) no es válido o es cero. No se puede convertir VES a USD.");
                        }
                    } 

                    // PASO 3.2: INYECCIÓN DE SALDO (SIEMPRE se intenta para recargas)
                    if (!google_id || isNaN(amountToInject) || amountToInject <= 0) {
                        console.error(`LOG: ❌ ERROR - Datos inválidos para inyección: Google ID: ${google_id}, Monto: ${amountToInject}`);
                        injectionMessage = `\n\n❌ <b>ERROR DE INYECCIÓN DE SALDO:</b> Datos incompletos (Google ID: ${google_id || 'NULO'}, Monto: ${finalPrice}). <b>¡REVISIÓN MANUAL REQUERIDA!</b>`;
                        updateDBSuccess = false;
                    } else {
                        // 4. INYECTAR SALDO AL CLIENTE (Usando la función RPC)
                        console.log(`LOG: 💰 INYECTANDO SALDO - $${amountToInject.toFixed(2)} USD a 'user_id' ${google_id}`);
                        
                        try {
                            const { error: balanceUpdateError } = await supabase
                                .rpc('incrementar_saldo', { 
                                    p_user_id: google_id, 
                                    p_monto: amountToInject.toFixed(2)
                                }); 
                                
                            if (balanceUpdateError) {
                                console.error(`ERROR DB: Fallo al inyectar saldo a ${google_id}. Mensaje: ${balanceUpdateError.message}.`);
                                injectionMessage = `\n\n❌ <b>ERROR CRÍTICO AL INYECTAR SALDO:</b> No se pudo actualizar la billetera del cliente (<code>${google_id}</code>). <br/>${balanceUpdateError.message}`;
                                updateDBSuccess = false; 
                                throw new Error("Fallo en la inyección de saldo.");
                            }
                            
                            console.log(`LOG: ✅ INYECCIÓN EXITOSA - $${amountToInject.toFixed(2)} USD inyectados a ${google_id}`);
                            injectionMessage = `\n\n💰 <b>INYECCIÓN DE SALDO EXITOSA:</b> Se inyectaron <b>$${amountToInject.toFixed(2)} USD</b> a la billetera del cliente (<code>${google_id}</code>).`;
                            
                            // Mensaje adicional si ya estaba REALIZADA
                            if (currentStatus === NEW_STATUS) {
                                injectionMessage += `\n\n⚠️ <b>NOTA:</b> La transacción ya estaba en estado 'REALIZADA'. Se verificó e inyectó el saldo.`;
                            }
                        } catch (e) {
                            console.error("ERROR CRITICO: Falló la llamada RPC para inyección de saldo.", e.message);
                            updateDBSuccess = false;
                            throw new Error(`Falló la inyección atómica (RPC). Error: ${e.message}`); 
                        }
                    }
                } else {
                    // Si NO es 'Recarga de Saldo' (es un producto normal)
                    console.log(`LOG: 🛒 ES PRODUCTO NORMAL - Game: "${game}"`);
                    if (currentStatus === NEW_STATUS) {
                        injectionMessage = `\n\n🛒 <b>PRODUCTO ENTREGADO ✅:</b> La transacción ya estaba marcada como realizada.`;
                    } else {
                        injectionMessage = `\n\n🛒 <b>PRODUCTO ENTREGADO ✅:</b> No se requería inyección de saldo.`;
                    }
                } 


                // 5. ACTUALIZACIÓN DEL ESTADO... 
                // Solo se actualiza si el estado actual es diferente y el proceso fue exitoso.
                if (currentStatus !== NEW_STATUS && updateDBSuccess) {
                    console.log(`LOG: 🔄 Actualizando estado de transacción ${transactionId} a ${NEW_STATUS}.`);
                    const { error: updateError } = await supabase
                        .from('transactions')
                        .update({ 
                            status: NEW_STATUS
                        })
                        .eq('id_transaccion', transactionId)
                        .in('status', ['pendiente', 'CONFIRMADO']); 
                    
                    if (updateError) {
                        console.error(`ERROR DB: Fallo al actualizar el estado a ${NEW_STATUS}.`, updateError.message);
                        injectionMessage += `\n\n⚠️ <b>ADVERTENCIA:</b> Fallo al actualizar el estado de la transacción: ${updateError.message}`;
                        updateDBSuccess = false; 
                    } else {
                        console.log(`LOG: ✅ Estado actualizado exitosamente a ${NEW_STATUS}.`);
                    }
                } else if (currentStatus === NEW_STATUS) {
                    console.log(`LOG: ℹ️ Estado ya era ${NEW_STATUS}, no se actualiza.`);
                }
                
                // 5.5. 📧 LÓGICA DE ENVÍO DE CORREO DE FACTURA (SIMPLIFICADA)
                // ENVIAR CORREO SIEMPRE QUE EL PROCESO SEA EXITOSO, SIN IMPORTAR EL ESTADO PREVIO
                if (updateDBSuccess) {
                    console.log(`LOG: 📧 Preparando envío de email. Email cliente: ${emailCliente || 'NO ENCONTRADO'}.`);

                    if (emailCliente) {
                        const invoiceSubject = `✅ ¡Pedido Entregado! Factura #${transactionId} - ${game}`;
                        
                        // 🚀 MODIFICACIÓN CLAVE: Mensaje de confirmación fijo y formal
                        const productDetailHtml = `
                            <p style="font-size: 1.1em; color: #007bff; font-weight: bold;">
                                Le confirmamos que todos los productos de su pedido han sido procesados y entregados con éxito.
                            </p>
                            <p>Puede verificar el estado de su cuenta o billetera.</p>
                        `;
                        // 🔚 FIN DE LA MODIFICACIÓN CLAVE
                        
                        const invoiceBody = `
                            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                                <h2 style="color: #28a745;">✅ Transacción REALIZADA y Confirmada</h2>
                                <p>Estimado/a cliente,</p>
                                <p>Su pedido <b>${transactionId}</b> ha sido procesado con éxito y marcado como <b>REALIZADO</b> por nuestro operador.</p>
                                <hr style="border-top: 1px solid #eee;"/>
                                <h3 style="color: #007bff;">Mensaje de Entrega:</h3>
                                ${productDetailHtml}
                                <hr style="border-top: 1px solid #eee;"/>
                                <h3 style="color: #007bff;">Resumen de la Factura:</h3>
                                <ul style="list-style: none; padding: 0;">
                                    <li style="margin-bottom: 5px;"><b>ID Transacción:</b> <code>${transactionId}</code></li>
                                    <li style="margin-bottom: 5px;"><b>Monto Total Pagado:</b> <b>${parseFloat(finalPrice).toFixed(2)} ${currency}</b></li>
                                    <li style="margin-bottom: 5px;"><b>Monto Inyectado (si aplica):</b> ${IS_WALLET_RECHARGE ? `$${amountToInject.toFixed(2)} USD` : 'N/A'}</li>
                                </ul>
                                
                                <p style="margin-top: 20px;">Gracias por su preferencia.</p>
                                <p style="font-size: 0.9em; color: #999;"><i>Este es un correo automático de confirmación de servicio.</i></p>
                            </div>
                        `;

                        // LLAMAR A LA FUNCIÓN DE ENVÍO
                        const emailSent = await sendInvoiceEmail(transactionId, emailCliente, invoiceSubject, invoiceBody);
                        
                        if (emailSent) {
                            injectionMessage += `\n\n📧 <b>CORREO ENVIADO:</b> Factura simplificada enviada a <code>${emailCliente}</code>.`;
                        } else {
                            injectionMessage += `\n\n⚠️ <b>ERROR DE CORREO:</b> No se pudo enviar la factura. Revisar logs SMTP.`;
                        }
                    } else {
                        injectionMessage += `\n\n⚠️ <b>ADVERTENCIA DE CORREO:</b> Email no encontrado (Google ID: ${google_id}). No se pudo enviar la factura.`;
                    }
                }
                
                // Si ya estaba REALIZADA, aún se considera un éxito en el marcado
                const finalStatusText = (currentStatus === NEW_STATUS || updateDBSuccess) ? NEW_STATUS : 'ERROR CRÍTICO';
                const finalStatusEmoji = (currentStatus === NEW_STATUS || updateDBSuccess) ? '✅' : '❌';

                console.log(`LOG: 📊 RESUMEN FINAL - Estado: ${finalStatusText}, Es recarga: ${IS_WALLET_RECHARGE}, Mensaje: ${injectionMessage.substring(0, 50)}...`);

                // 6. CONFIRMACIÓN Y EDICIÓN DEL MENSAJE DE TELEGRAM...
                console.log("LOG: ✏️ Editando mensaje de Telegram.");
                
                const statusMarker = `\n\n------------------------------------------------\n` +
                                     `${finalStatusEmoji} <b>ESTADO FINAL: ${finalStatusText}</b>\n` +
                                     `<i>Marcada por operador a las: ${new Date().toLocaleTimeString('es-VE')}</i> \n` +
                                     `------------------------------------------------` +
                                     injectionMessage; 

                const newFullText = originalText + statusMarker;
                
                await editTelegramMessage(
                    TELEGRAM_BOT_TOKEN, chatId, messageId, 
                    newFullText, 
                    {}
                );
                
                console.log(`LOG: ✅ FIN PROCESO DE MARCADO. Transacción ID: ${transactionId} <<<`);
                
            } catch (e) {
                console.error("ERROR FATAL en callback_query handler (Catch block):", e.message);
                await editTelegramMessage(
                    TELEGRAM_BOT_TOKEN, chatId, messageId, 
                    `❌ <b>ERROR CRÍTICO EN PROCESO DE MARCADO</b> ❌<br/>Transacción: <code>${transactionId}</code><br/>Fallo: ${e.message}<br/><br/><b>¡REVISIÓN MANUAL URGENTE!</b>`,
                    {}
                );
            }
        }
    } 
    
    return { statusCode: 200, body: "Webhook processed" };
};


// ----------------------------------------------------------------------
// --- FUNCIONES AUXILIARES ---
// ----------------------------------------------------------------------

// 📧 FUNCIÓN: Envío de correo con Nodemailer (con log de error detallado)
async function sendInvoiceEmail(transactionId, userEmail, emailSubject, emailBody) {
    // 1. Convertir el puerto a número para una comparación segura
    const port = parseInt(process.env.SMTP_PORT, 10); 
    
    // 2. Configurar el transporter de Nodemailer
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: port,
        secure: port === 465, // <-- Corrección de tipo de dato
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        },
    });

    const mailOptions = {
        from: process.env.SMTP_USER,
        to: userEmail,               
        subject: emailSubject,
        html: emailBody,             
    };

    // 3. Enviar el correo
    try {
        console.log(`LOG EMAIL: Intentando enviar correo de factura para transacción ${transactionId} a ${userEmail}.`);
        let info = await transporter.sendMail(mailOptions);
        console.log(`LOG EMAIL: ✅ Correo enviado con éxito. Message ID: ${info.messageId}`);
        return true;
    } catch (e) {
        // Log detallado en caso de fallo de Nodemailer
        console.error(`ERROR EMAIL: ❌ Fallo al enviar el correo para ${transactionId}. Receptor: ${userEmail}`);
        console.error(`ERROR EMAIL DETALLE: ${e.message}`);
        if (e.response) {
            console.error(`ERROR EMAIL RESPUESTA SMTP: ${e.response}`);
        }
        return false;
    }
}


// Funciones de Telegram (sin cambios)
async function editTelegramMessage(token, chatId, messageId, text, replyMarkup) {
    const telegramApiUrl = `https://api.telegram.org/bot${token}/editMessageText`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: chatId,
            message_id: messageId,
            text: text,
            parse_mode: 'HTML', 
            reply_markup: replyMarkup
        });
    } catch (error) {
        console.error("ERROR TELEGRAM: Fallo al editar mensaje de Telegram.", error.response ? error.response.data : error.message);
    }
}

async function sendTelegramAlert(token, chatId, text, replyToMessageId = null) {
    const telegramApiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML', 
            reply_to_message_id: replyToMessageId 
        });
    } catch (error) {
        console.error("ERROR TELEGRAM: Fallo al enviar alerta de Telegram.", error.response ? error.response.data : error.message);
    }
}