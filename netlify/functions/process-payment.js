// netlify/functions/process-payment.js
const axios = require('axios');
const { Formidable } = require('formidable');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const { Readable } = require('stream');
const fs = require('fs');
const FormData = require('form-data');

// Función de Normalización
function normalizeWhatsappNumber(number) {
    console.log(`[LOG normalizeWhatsappNumber] Input number: "${number}"`);
    
    if (!number) {
        console.log(`[LOG normalizeWhatsappNumber] Number is null/empty, returning null`);
        return null;
    }

    let cleanedNumber = number.replace(/[^\d]/g, '');
    console.log(`[LOG normalizeWhatsappNumber] Cleaned number: "${cleanedNumber}"`);

    if (cleanedNumber.length === 11 && cleanedNumber.startsWith('0')) {
        const result = '58' + cleanedNumber.substring(1);
        console.log(`[LOG normalizeWhatsappNumber] Pattern 1 matched (11 digits starting with 0): ${result}`);
        return result;
    }

    if (cleanedNumber.length === 13 && cleanedNumber.startsWith('580')) {
        const result = '58' + cleanedNumber.substring(3);
        console.log(`[LOG normalizeWhatsappNumber] Pattern 2 matched (13 digits starting with 580): ${result}`);
        return result;
    }
    
    if (cleanedNumber.length === 12 && cleanedNumber.startsWith('58')) {
        console.log(`[LOG normalizeWhatsappNumber] Pattern 3 matched (12 digits starting with 58): ${cleanedNumber}`);
        return cleanedNumber;
    }
    
    if (cleanedNumber.length === 10 && (cleanedNumber.startsWith('412') || cleanedNumber.startsWith('424') || cleanedNumber.startsWith('414') || cleanedNumber.startsWith('416') || cleanedNumber.startsWith('426'))) {
        const result = '58' + cleanedNumber;
        console.log(`[LOG normalizeWhatsappNumber] Pattern 4 matched (10 digits with area code): ${result}`);
        return result;
    }

    if (cleanedNumber.length >= 10) {
        console.log(`[LOG normalizeWhatsappNumber] Pattern 5 (fallback): returning cleaned number: ${cleanedNumber}`);
        return cleanedNumber; 
    }

    console.log(`[LOG normalizeWhatsappNumber] No pattern matched, returning null`);
    return null;
}


exports.handler = async function(event, context) {
    console.log(`[LOG handler] Function started. HTTP Method: ${event.httpMethod}`);
    console.log(`[LOG handler] Headers: ${JSON.stringify(event.headers, null, 2)}`);
    
    if (event.httpMethod !== "POST") {
        console.log(`[LOG handler] Method not allowed: ${event.httpMethod}`);
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    let data;
    let paymentReceiptFile; 

    // --- Configuración de Supabase ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    console.log(`[LOG handler] Supabase URL configured: ${supabaseUrl ? 'YES' : 'NO'}`);
    console.log(`[LOG handler] Supabase Service Key configured: ${supabaseServiceKey ? 'YES' : 'NO'}`);
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- Parsing de FormData con formidable ---
    console.log(`[LOG handler] Content-Type: ${event.headers['content-type']}`);
    const form = new Formidable({ multiples: true });

    let bodyBuffer;
    if (event.isBase64Encoded) {
        console.log(`[LOG handler] Body is base64 encoded`);
        bodyBuffer = Buffer.from(event.body, 'base64');
    } else {
        console.log(`[LOG handler] Body is NOT base64 encoded`);
        bodyBuffer = Buffer.from(event.body || '');
    }

    const reqStream = new Readable();
    reqStream.push(bodyBuffer);
    reqStream.push(null);

    reqStream.headers = event.headers;
    reqStream.method = event.httpMethod;

    try {
        if (event.headers['content-type'] && event.headers['content-type'].includes('multipart/form-data')) {
            console.log(`[LOG handler] Processing multipart/form-data`);
            const { fields, files } = await new Promise((resolve, reject) => {
                form.parse(reqStream, (err, fields, files) => {
                    if (err) {
                        console.error('[LOG handler] Formidable parse error:', err);
                        return reject(err); 
                    }
                    console.log(`[LOG handler] Formidable fields keys: ${Object.keys(fields)}`);
                    console.log(`[LOG handler] Formidable files keys: ${Object.keys(files)}`);
                    resolve({ fields, files });
                });
            });

            data = Object.fromEntries(Object.entries(fields).map(([key, value]) => {
                console.log(`[LOG handler] Field ${key}: ${JSON.stringify(value)}`);
                return [key, Array.isArray(value) ? value[0] : value];
            }));
            
            paymentReceiptFile = files['paymentReceipt'] ? files['paymentReceipt'][0] : null;
            console.log(`[LOG handler] Payment receipt file: ${paymentReceiptFile ? 'PRESENT' : 'ABSENT'}`);
            if (paymentReceiptFile) {
                console.log(`[LOG handler] Payment receipt details:`, {
                    filepath: paymentReceiptFile.filepath,
                    originalFilename: paymentReceiptFile.originalFilename,
                    size: paymentReceiptFile.size
                });
            }

        } else if (event.headers['content-type'] && event.headers['content-type'].includes('application/json')) {
            console.log(`[LOG handler] Processing application/json`);
            data = JSON.parse(event.body);
            console.log(`[LOG handler] Parsed JSON data keys: ${Object.keys(data)}`);
        } else {
            console.log(`[LOG handler] Processing other content type (likely x-www-form-urlencoded)`);
            const { parse } = require('querystring');
            data = parse(event.body);
            console.log(`[LOG handler] Parsed form data keys: ${Object.keys(data)}`);
        }
        
        console.log(`[LOG handler] Final data object keys: ${Object.keys(data)}`);
        console.log(`[LOG handler] Data object preview:`, Object.entries(data).map(([k, v]) => `${k}: ${typeof v === 'string' ? v.substring(0, 50) + (v.length > 50 ? '...' : '') : typeof v}`));
        
    } catch (parseError) {
        console.error("[LOG handler] Error al procesar los datos de la solicitud:", parseError);
        return {
            statusCode: 400,
            body: JSON.stringify({ 
                message: `Error al procesar los datos de la solicitud: ${parseError.message || 'Unknown error'}. Por favor, verifica tus datos e inténtalo de nuevo.` 
            })
        };
    }

    // --- Verificación de Variables de Entorno ---
    console.log(`[LOG handler] Checking environment variables...`);
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const SMTP_HOST = process.env.SMTP_HOST;
    const SMTP_PORT = process.env.SMTP_PORT;
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;
    const SENDER_EMAIL = process.env.SENDER_EMAIL || SMTP_USER;
    
    console.log(`[LOG handler] TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN ? 'PRESENT' : 'MISSING'}`);
    console.log(`[LOG handler] TELEGRAM_CHAT_ID: ${TELEGRAM_CHAT_ID ? 'PRESENT' : 'MISSING'}`);
    console.log(`[LOG handler] SMTP_HOST: ${SMTP_HOST ? 'PRESENT' : 'MISSING'}`);
    console.log(`[LOG handler] SMTP_PORT: ${SMTP_PORT ? 'PRESENT' : 'MISSING'}`);
    console.log(`[LOG handler] SMTP_USER: ${SMTP_USER ? 'PRESENT' : 'MISSING'}`);
    console.log(`[LOG handler] SMTP_PASS: ${SMTP_PASS ? 'PRESENT' : 'MISSING'}`);
    console.log(`[LOG handler] SENDER_EMAIL: ${SENDER_EMAIL ? 'PRESENT' : 'MISSING'}`);
    console.log(`[LOG handler] supabaseUrl: ${supabaseUrl ? 'PRESENT' : 'MISSING'}`);
    console.log(`[LOG handler] supabaseServiceKey: ${supabaseServiceKey ? 'PRESENT' : 'MISSING'}`);

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !SMTP_HOST || !parseInt(SMTP_PORT, 10) || !SMTP_USER || !SMTP_PASS || !supabaseUrl || !supabaseServiceKey) {
        console.error("[LOG handler] Faltan variables de entorno requeridas o SMTP_PORT no es un número válido.");
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                message: "Error de configuración del servidor: Faltan credenciales o configuración inválida." 
            })
        };
    }

    // --- Extracción y Normalización de Datos del Carrito y Globales ---
    console.log(`[LOG handler] Extracting data from request...`);
    const { finalPrice, currency, paymentMethod, email, whatsappNumber, cartDetails } = data;
    
    console.log(`[LOG handler] Data extracted:`, {
        finalPrice,
        currency,
        paymentMethod,
        email,
        whatsappNumber,
        cartDetailsLength: cartDetails ? cartDetails.length : 0
    });
    
    let cleanedFinalPrice = finalPrice;
    if (finalPrice) {
        cleanedFinalPrice = finalPrice.toString().replace(/[^\d.]/g, '');
        console.log(`[LOG handler] Original finalPrice: "${finalPrice}" -> Cleaned: "${cleanedFinalPrice}"`);
    }
    
    if (!cleanedFinalPrice || isNaN(parseFloat(cleanedFinalPrice))) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Falta o es inválido el campo 'finalPrice'. Debe ser un número válido." })
        };
    }
    
    if (!currency) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Falta el campo 'currency'." })
        };
    }
    
    if (!paymentMethod) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Falta el campo 'paymentMethod'." })
        };
    }
    
    if (!email) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Falta el campo 'email'." })
        };
    }
    
    if (!cartDetails) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Falta el campo 'cartDetails'." })
        };
    }
    
    const normalizedWhatsapp = normalizeWhatsappNumber(whatsappNumber);
    if (normalizedWhatsapp) {
        data.whatsappNumber = normalizedWhatsapp;
    }
    
    // Parsear el JSON del carrito
    let cartItems = [];
    if (cartDetails) {
        try {
            cartItems = JSON.parse(cartDetails);
            
            cartItems.forEach((item, index) => {
                console.log(`[LOG handler] Cart item ${index + 1}:`, {
                    game: item.game,
                    packageName: item.packageName,
                    playerId: item.playerId,
                    priceUSD: item.priceUSD,
                    priceJPUSD: item.priceJPUSD,
                    priceVES: item.priceVES,
                    priceCOP: item.priceCOP,
                    isFreeFireAutoRecharge: item.isFreeFireAutoRecharge,
                    apiResult: item.apiResult
                });
            });
        } catch (e) {
            console.error("[LOG handler] Error al parsear cartDetails JSON:", e);
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Formato de detalles del carrito inválido." })
            };
        }
    }

    if (cartItems.length === 0) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "El carrito de compra está vacío." })
        };
    }
    
    // Obtener detalles específicos del método de pago
    let methodSpecificDetails = {};
    console.log(`[LOG handler] Processing payment method: ${paymentMethod}`);
    
    if (paymentMethod === 'pago-movil') {
        methodSpecificDetails.phone = data.phone;
        methodSpecificDetails.reference = data.reference;
    } else if (paymentMethod === 'binance') {
        methodSpecificDetails.txid = data.txid;
    } else if (paymentMethod === 'zinli') {
        methodSpecificDetails.reference = data.reference;
    }
    
    // --- Guardar Transacción Inicial en Supabase ---
    let newTransactionData;
    let id_transaccion_generado;

    try {
        id_transaccion_generado = `JPSTORE-${Date.now()}`;
        console.log(`[LOG handler] Generated transaction ID: ${id_transaccion_generado}`);

        const firstItem = cartItems[0] || {};
        
        const isGameWalletRecharge = firstItem.game && firstItem.game.includes('Recarga de Saldo');
        console.log(`[LOG handler] DIAGNÓSTICO: isGameWalletRecharge = ${isGameWalletRecharge}`);
        
        // 🆕 NUEVO: Determinar si es una recarga automática de Free Fire exitosa
        // Esto se cumple si el item es Free Fire auto y tiene apiResult exitoso
        const isFreeFireAutoCompleted = cartItems.some(item => 
            item.isFreeFireAutoRecharge === true && 
            item.apiResult && 
            item.apiResult.success !== false
        );
        console.log(`[LOG handler] DIAGNÓSTICO: isFreeFireAutoCompleted = ${isFreeFireAutoCompleted}`);
        
        // 🆕 NUEVO: El status inicial es 'realizada' si es Free Fire auto completado, sino 'pendiente'
        const initialStatus = isFreeFireAutoCompleted ? 'realizada' : 'pendiente';
        
        const transactionToInsert = {
            id_transaccion: id_transaccion_generado,
            finalPrice: parseFloat(cleanedFinalPrice),
            currency: currency,
            paymentMethod: paymentMethod,
            email: email,
            whatsappNumber: normalizedWhatsapp || whatsappNumber || null,
            methodDetails: methodSpecificDetails,
            status: initialStatus,
            telegram_chat_id: TELEGRAM_CHAT_ID,
            receipt_url: paymentReceiptFile ? paymentReceiptFile.filepath : null,
            google_id: firstItem.google_id || null, 
            game: firstItem.game || 'Carrito Múltiple',
            packageName: firstItem.packageName || 'Múltiples Paquetes',
            playerId: firstItem.playerId || null,
            roblox_email: firstItem.robloxEmail || null,
            roblox_password: firstItem.robloxPassword || null,
            codm_email: firstItem.codmEmail || null,
            codm_password: firstItem.codmPassword || null,
            codm_vinculation: firstItem.codmVinculation || null
        };

        console.log(`[LOG handler] Inserting transaction to Supabase:`, transactionToInsert);

        const { data: insertedData, error: insertError } = await supabase
            .from('transactions')
            .insert(transactionToInsert)
            .select();

        if (insertError) {
            console.error(`[LOG handler] Supabase insert error:`, insertError);
            throw insertError; 
        }
        
        newTransactionData = insertedData[0];
        console.log(`[LOG handler] Transacción guardada en Supabase con ID interno:`, newTransactionData.id);

    } catch (supabaseError) {
        console.error("[LOG handler] Error al guardar la transacción en Supabase:", supabaseError.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error al guardar la transacción en la base de datos." })
        };
    }

    // --- Generar Notificación para Telegram ---
    const firstItem = cartItems[0] || {};
    
    const isWalletRecharge = cartItems.length === 1 && firstItem.game && firstItem.game.includes('Recarga de Saldo');
    
    // 🆕 NUEVO: Recalcular aquí también (para usar en el mensaje de Telegram)
    const isFreeFireAutoCompleted = cartItems.some(item => 
        item.isFreeFireAutoRecharge === true && 
        item.apiResult && 
        item.apiResult.success !== false
    );

    let messageText = isWalletRecharge 
        ? `💸 Nueva Recarga de Billetera JP Store 💸\n\n`
        : `✨ Nueva Recarga (CARRITO) JP Store ✨\n\n`;
    
    messageText += `*ID de Transacción:* \`${id_transaccion_generado || 'N/A'}\`\n`;
    // 🆕 Estado dinámico en Telegram también
    messageText += `*Estado:* \`${isFreeFireAutoCompleted ? 'REALIZADA ✅' : 'PENDIENTE'}\`\n`;
    
    if (isWalletRecharge && firstItem.google_id) {
        messageText += `🔗 *Google ID (Billetera):* \`${firstItem.google_id}\`\n`;
        messageText += `💵 *Monto Recargado (Paquete):* *${firstItem.packageName || 'N/A'}*\n`;
    }
    
    messageText += `------------------------------------------------\n`;

    cartItems.forEach((item, index) => {
        messageText += `*📦 Producto ${index + 1}:*\n`;
        messageText += `🎮 Juego/Servicio: *${item.game || 'N/A'}*\n`;
        messageText += `📦 Paquete: *${item.packageName || 'N/A'}*\n`;
        
        if (item.game === 'Roblox') {
            messageText += `📧 Correo Roblox: ${item.robloxEmail || 'N/A'}\n`;
            messageText += `🔑 Contraseña Roblox: ${item.robloxPassword || 'N/A'}\n`;
        } else if (item.game === 'Call of Duty Mobile') {
            messageText += `📧 Correo CODM: ${item.codmEmail || 'N/A'}\n`;
            messageText += `🔑 Contraseña CODM: ${item.codmPassword || 'N/A'}\n`;
            messageText += `🔗 Vinculación CODM: ${item.codmVinculation || 'N/A'}\n`;
        } else if (item.playerId) {
            messageText += `👤 ID de Jugador: *${item.playerId}*\n`;
        }
        
        // 🆕 Lógica de precios CORREGIDA - ahora soporta priceJPUSD
        let itemPrice;
        let itemCurrency = currency;
        
        console.log(`[LOG handler] itemCurrency (Seleccionada - Global): ${itemCurrency}`);

        if (itemCurrency === 'JPUSD' || itemCurrency === 'USDM') { 
            // 🆕 CORRECCIÓN: usar priceJPUSD (el campo real del carrito)
            itemPrice = item.priceJPUSD || item.priceUSDM;
            console.log(`[LOG handler] LÓGICA APLICADA: GLOBAL ${itemCurrency}. Price usado: ${itemPrice}. Fuente: item.priceJPUSD`);
        } else if (itemCurrency === 'VES') {
            itemPrice = item.priceVES;
        } else if (itemCurrency === 'COP') {
            itemPrice = item.priceCOP;
        } else {
            itemPrice = item.priceUSD;
        }
        
        if (itemPrice) {
            messageText += `💲 Precio (Est.): ${parseFloat(itemPrice).toFixed(2)} ${itemCurrency}\n`;
        }
        
        // 🆕 NUEVO: Mostrar transaction_id de Recargas América si está disponible
        if (item.apiResult && item.apiResult.transaction_id) {
            messageText += `🎫 ID Recarga (API): \`${item.apiResult.transaction_id}\`\n`;
        }
        
        messageText += `------------------------------------------------\n`;
    });

    messageText += `\n*RESUMEN DE PAGO*\n`;
    const displayFinalPrice = parseFloat(cleanedFinalPrice).toFixed(2);
    messageText += `💰 *TOTAL A PAGAR:* *${displayFinalPrice} ${currency}*\n`;
    messageText += `💳 Método de Pago: *${paymentMethod.replace('-', ' ').toUpperCase()}*\n`;
    messageText += `📧 Correo Cliente: ${email}\n`;
    
    if (whatsappNumber) {
        messageText += `📱 WhatsApp Cliente: ${whatsappNumber}\n`;
        if (normalizedWhatsapp && normalizedWhatsapp !== whatsappNumber) {
             messageText += `(Número normalizado: ${normalizedWhatsapp})\n`;
        }
    }

    if (paymentMethod === 'pago-movil') {
        messageText += `📞 Teléfono Pago Móvil: ${methodSpecificDetails.phone || 'N/A'}\n`;
        messageText += `📊 Referencia Pago Móvil: ${methodSpecificDetails.reference || 'N/A'}\n`;
    } else if (paymentMethod === 'binance') {
        messageText += `🆔 TXID Binance: ${methodSpecificDetails.txid || 'N/A'}\n`;
    } else if (paymentMethod === 'zinli') {
        messageText += `📊 Referencia Zinli: ${methodSpecificDetails.reference || 'N/A'}\n`;
    }

    // Construcción de Botones Inline para Telegram
    const inlineKeyboard = [];
    
    // 🆕 NUEVO: Solo agregar el botón "Marcar como Realizada" si NO es Free Fire auto completado
    // (porque ya está realizada automáticamente)
    if (!isFreeFireAutoCompleted) {
        inlineKeyboard.push([{ text: "✅ Marcar como Realizada", callback_data: `mark_done_${id_transaccion_generado}` }]);
    } else {
        inlineKeyboard.push([{ text: "✅ Ya realizada automáticamente", callback_data: `already_done_${id_transaccion_generado}` }]);
    }
    
    if (normalizedWhatsapp) {
        const whatsappLink = `https://wa.me/${normalizedWhatsapp}`;
        inlineKeyboard.push(
            [{ text: "💬 Contactar Cliente por WhatsApp", url: whatsappLink }]
        );
    }
    
    const replyMarkup = {
        inline_keyboard: inlineKeyboard
    };

    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    let telegramMessageResponse;

    try {
        telegramMessageResponse = await axios.post(telegramApiUrl, {
            chat_id: TELEGRAM_CHAT_ID,
            text: messageText,
            parse_mode: 'Markdown',
            reply_markup: replyMarkup
        });
        console.log(`[LOG handler] Mensaje de Telegram enviado con éxito.`);
        
        if (paymentReceiptFile && paymentReceiptFile.filepath) {
            if (fs.existsSync(paymentReceiptFile.filepath)) {
                const fileStream = fs.createReadStream(paymentReceiptFile.filepath);
                const captionText = `*Comprobante de Pago* para Transacción \`${id_transaccion_generado}\`\n\n*Método:* ${paymentMethod.replace('-', ' ').toUpperCase()}\n*Monto:* ${displayFinalPrice} ${currency}`;

                const form = new FormData();
                form.append('chat_id', TELEGRAM_CHAT_ID);
                form.append('caption', captionText);
                form.append('parse_mode', 'Markdown');
                form.append('document', fileStream, paymentReceiptFile.originalFilename || 'comprobante_pago.jpg');

                const telegramDocumentApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;

                await axios.post(telegramDocumentApiUrl, form, {
                    headers: form.getHeaders(),
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                });
                console.log(`[LOG handler] Comprobante enviado a Telegram con éxito.`);
            }
        }
        
        if (newTransactionData && telegramMessageResponse && telegramMessageResponse.data && telegramMessageResponse.data.result) {
            const { error: updateError } = await supabase
                .from('transactions')
                .update({ telegram_message_id: telegramMessageResponse.data.result.message_id })
                .eq('id', newTransactionData.id);

            if (updateError) {
                console.error(`[LOG handler] Error al actualizar la transacción con telegram_message_id:`, updateError.message);
            }
        }

    } catch (telegramError) {
        console.error(`[LOG handler] Error al enviar mensaje de Telegram:`, telegramError.response ? telegramError.response.data : telegramError.message);
    }

    // --- Enviar Confirmación por Correo Electrónico al Cliente ---
    if (email) {
        console.log(`[LOG handler] Preparing to send email to: ${email}`);
        
        let transporter;
        try {
            transporter = nodemailer.createTransport({
                host: SMTP_HOST,
                port: parseInt(SMTP_PORT, 10),
                secure: parseInt(SMTP_PORT, 10) === 465,
                auth: {
                    user: SMTP_USER,
                    pass: SMTP_PASS,
                },
                tls: {
                    rejectUnauthorized: false
                }
            });
        } catch (createTransportError) {
            console.error(`[LOG handler] Error al crear el transportador de Nodemailer:`, createTransportError);
        }

        // Generar el HTML de los detalles del carrito para el correo
        let cartDetailsHtml = '';
        let subtotal = 0;
        
        cartItems.forEach((item, index) => {
            let playerInfoEmail = '';
            let game = item.game || 'Servicio';
            let packageName = item.packageName || 'Paquete Desconocido';
            
            // 🆕 CORRECCIÓN CRÍTICA: usar priceJPUSD en lugar de priceUSDM
            let itemPrice;
            if (currency === 'JPUSD' || currency === 'USDM') {
                itemPrice = item.priceJPUSD || item.priceUSDM || 0;
            } else if (currency === 'VES') {
                itemPrice = item.priceVES || 0;
            } else if (currency === 'COP') {
                itemPrice = item.priceCOP || 0;
            } else {
                itemPrice = item.priceUSD || 0;
            }
            
            subtotal += parseFloat(itemPrice) || 0;
            
            if (game === 'Roblox') {
                playerInfoEmail = `
                    <div style="margin-top: 5px;">
                        <span style="color: #00ff00; font-size: 12px;">• Correo: ${item.robloxEmail || 'N/A'}</span><br>
                        <span style="color: #00ff00; font-size: 12px;">• Contraseña: ${item.robloxPassword || 'N/A'}</span>
                    </div>
                `;
            } else if (game === 'Call of Duty Mobile') {
                playerInfoEmail = `
                    <div style="margin-top: 5px;">
                        <span style="color: #00ff00; font-size: 12px;">• Correo: ${item.codmEmail || 'N/A'}</span><br>
                        <span style="color: #00ff00; font-size: 12px;">• Contraseña: ${item.codmPassword || 'N/A'}</span><br>
                        <span style="color: #00ff00; font-size: 12px;">• Vinculación: ${item.codmVinculation || 'N/A'}</span>
                    </div>
                `;
            } else if (game.includes('Recarga de Saldo') && item.google_id) {
                playerInfoEmail = `
                    <div style="margin-top: 5px;">
                        <span style="color: #00ff00; font-size: 12px;">• ID Google: ${item.google_id}</span><br>
                        <span style="color: #00ff00; font-size: 12px;">• Paquete: ${packageName}</span>
                    </div>
                `;
            } else if (item.playerId) {
                playerInfoEmail = `
                    <div style="margin-top: 5px;">
                        <span style="color: #00ff00; font-size: 12px;">• ID Jugador: ${item.playerId}</span>
                    </div>
                `;
            }

            cartDetailsHtml += `
                <tr>
                    <td style="border: 1px solid #00ff00; padding: 10px; color: #ffffff;">${index + 1}</td>
                    <td style="border: 1px solid #00ff00; padding: 10px; color: #ffffff;">${game}</td>
                    <td style="border: 1px solid #00ff00; padding: 10px; color: #ffffff;">${packageName}</td>
                    <td style="border: 1px solid #00ff00; padding: 10px; color: #ffffff; text-align: right;">
                        ${itemPrice ? parseFloat(itemPrice).toFixed(2) : '0.00'} ${currency}
                    </td>
                </tr>
                ${playerInfoEmail ? `
                <tr>
                    <td colspan="4" style="border: 1px solid #00ff00; padding: 8px; background: rgba(0, 255, 0, 0.1);">
                        ${playerInfoEmail}
                    </td>
                </tr>
                ` : ''}
            `;
        });
        
        let paymentDetailsHtml = '';
        if (paymentMethod === 'pago-movil') {
            paymentDetailsHtml = `
                <div style="margin: 5px 0;">
                    <span style="color: #00ff00;">• Teléfono:</span> ${methodSpecificDetails.phone || 'N/A'}
                </div>
                <div style="margin: 5px 0;">
                    <span style="color: #00ff00;">• Referencia:</span> ${methodSpecificDetails.reference || 'N/A'}
                </div>
            `;
        } else if (paymentMethod === 'binance') {
            paymentDetailsHtml = `
                <div style="margin: 5px 0;">
                    <span style="color: #00ff00;">• TXID:</span> ${methodSpecificDetails.txid || 'N/A'}
                </div>
            `;
        } else if (paymentMethod === 'zinli') {
            paymentDetailsHtml = `
                <div style="margin: 5px 0;">
                    <span style="color: #00ff00;">• Referencia:</span> ${methodSpecificDetails.reference || 'N/A'}
                </div>
            `;
        }
        
        // 🆕 NUEVO: Corregir la hora restando 4 horas
        const now = new Date();
        now.setHours(now.getHours() - 4);  // ⏰ Restar 4 horas
        const formattedDate = now.toLocaleDateString('es-VE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // 🆕 NUEVO: Estado dinámico para la factura del email
        const emailStatusText = isFreeFireAutoCompleted ? 'REALIZADA' : 'PENDIENTE';
        const emailStatusColor = isFreeFireAutoCompleted ? '#28a745' : '#ffc107';
        const emailStatusBg = isFreeFireAutoCompleted ? 'rgba(40, 167, 69, 0.2)' : 'rgba(255, 193, 7, 0.2)';
        const emailStatusBorder = isFreeFireAutoCompleted ? '#28a745' : '#ffc107';
        const emailStatusIcon = isFreeFireAutoCompleted ? '✅' : '⚠️';
        
        // 🆕 NUEVO: Mensaje contextual según estado
        const statusMessage = isFreeFireAutoCompleted 
            ? `<div style="margin-top: 10px; color: #28a745; font-size: 14px;">
                ✅ Tu recarga fue procesada y entregada exitosamente.
               </div>`
            : `<div style="margin-top: 10px; color: #ffc107; font-size: 14px;">
                ⚠️ Esta factura será confirmada después de verificar el pago
               </div>`;
        
        const mailOptions = {
            from: SENDER_EMAIL,
            to: email,
            subject: `🎉 FACTURA VIRTUAL #${id_transaccion_generado} - JP STORE 🎉`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Factura Virtual - JP Store</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            background-color: #0a1929;
                            color: #ffffff;
                            margin: 0;
                            padding: 20px;
                        }
                        .invoice-container {
                            max-width: 800px;
                            margin: 0 auto;
                            background: linear-gradient(135deg, #0a1929 0%, #0c2340 100%);
                            border-radius: 10px;
                            padding: 30px;
                            border: 2px solid #00ff00;
                            box-shadow: 0 0 20px rgba(0, 255, 0, 0.3);
                        }
                        .header {
                            text-align: center;
                            margin-bottom: 30px;
                            padding-bottom: 20px;
                            border-bottom: 2px solid #00ff00;
                        }
                        .store-name {
                            font-size: 36px;
                            color: #00ff00;
                            font-weight: bold;
                            margin-bottom: 10px;
                            text-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
                        }
                        .invoice-title {
                            font-size: 24px;
                            color: #ffffff;
                            margin-bottom: 20px;
                        }
                        .info-grid {
                            display: grid;
                            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                            gap: 15px;
                            margin-bottom: 30px;
                        }
                        .info-box {
                            background: rgba(0, 30, 60, 0.7);
                            padding: 15px;
                            border-radius: 8px;
                            border-left: 4px solid #00ff00;
                        }
                        .info-label {
                            font-size: 12px;
                            color: #00ff00;
                            text-transform: uppercase;
                            margin-bottom: 5px;
                        }
                        .info-value {
                            font-size: 16px;
                            color: #ffffff;
                            font-weight: 500;
                        }
                        table {
                            width: 100%;
                            border-collapse: collapse;
                            margin: 20px 0;
                        }
                        th {
                            background: rgba(0, 40, 80, 0.9);
                            color: #00ff00;
                            padding: 12px;
                            text-align: left;
                            border: 1px solid #00ff00;
                        }
                        td {
                            padding: 10px;
                            border: 1px solid #00ff00;
                        }
                        .total-section {
                            text-align: center;
                            padding: 25px;
                            background: rgba(0, 40, 80, 0.9);
                            border-radius: 10px;
                            margin: 30px 0;
                            border: 2px solid #00ff00;
                        }
                        .total-amount {
                            font-size: 32px;
                            color: #00ff00;
                            font-weight: bold;
                            margin: 10px 0;
                            text-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
                        }
                        .status-badge {
                            display: inline-block;
                            padding: 8px 15px;
                            background: ${emailStatusBg};
                            color: ${emailStatusColor};
                            border-radius: 20px;
                            font-weight: bold;
                            border: 1px solid ${emailStatusBorder};
                        }
                        .footer {
                            text-align: center;
                            margin-top: 30px;
                            padding-top: 20px;
                            border-top: 1px solid #00ff00;
                            color: #8a9ba8;
                            font-size: 14px;
                        }
                        .whatsapp-btn {
                            display: inline-block;
                            background: #25D366;
                            color: white;
                            padding: 12px 25px;
                            text-decoration: none;
                            border-radius: 25px;
                            font-weight: bold;
                            margin: 15px 0;
                        }
                    </style>
                </head>
                <body>
                    <div class="invoice-container">
                        <div class="header">
                            <div class="store-name">JP STORE</div>
                            <div>Tu tienda de recargas y servicios gaming</div>
                        </div>
                        
                        <div class="invoice-title">FACTURA VIRTUAL #${id_transaccion_generado}</div>
                        
                        <div class="info-grid">
                            <div class="info-box">
                                <div class="info-label">Número de Factura</div>
                                <div class="info-value">${id_transaccion_generado}</div>
                            </div>
                            <div class="info-box">
                                <div class="info-label">Fecha de Emisión</div>
                                <div class="info-value">${formattedDate}</div>
                            </div>
                            <div class="info-box">
                                <div class="info-label">Estado</div>
                                <div class="status-badge">${emailStatusIcon} ${emailStatusText}</div>
                            </div>
                            <div class="info-box">
                                <div class="info-label">Cliente</div>
                                <div class="info-value">${email}</div>
                            </div>
                        </div>
                        
                        <div class="info-box">
                            <div class="info-label">Detalles del Método de Pago</div>
                            ${paymentDetailsHtml || '<div style="margin-top: 5px;">Sin detalles adicionales</div>'}
                        </div>
                        
                        <table>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Juego/Servicio</th>
                                    <th>Paquete</th>
                                    <th>Precio (${currency})</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${cartDetailsHtml}
                            </tbody>
                        </table>
                        
                        <div class="total-section">
                            <div>Total a Pagar</div>
                            <div class="total-amount">${displayFinalPrice} ${currency}</div>
                            <div style="margin-top: 15px; font-size: 18px;">
                                Método: <strong>${paymentMethod.replace('-', ' ').toUpperCase()}</strong>
                            </div>
                            ${statusMessage}
                        </div>
                        
                        <div class="info-box">
                            <div class="info-label">Instrucciones</div>
                            <ul style="color: #ffffff; padding-left: 20px;">
                                <li>Guarda este correo como comprobante</li>
                                <li>${isFreeFireAutoCompleted ? 'Tu recarga ya fue entregada' : 'Tu recarga se procesará en 15-60 minutos'}</li>
                                <li>${isFreeFireAutoCompleted ? 'Verifica tu cuenta del juego para confirmar' : 'Recibirás confirmación cuando se complete'}</li>
                                <li>Para consultas, menciona el número: ${id_transaccion_generado}</li>
                            </ul>
                        </div>
                        
                        <div class="footer">
                            <a href="https://wa.me/584143187185" class="whatsapp-btn">
                                📲 Contactar por WhatsApp
                            </a>
                            <div style="margin-top: 20px;">
                                © ${now.getFullYear()} JP STORE. Factura virtual generada automáticamente.
                            </div>
                        </div>
                    </div>
                </body>
                </html>
            `,
        };

        try {
            if (transporter) {
                await transporter.sendMail(mailOptions);
                console.log(`[LOG handler] Factura JP Store enviada al cliente: ${email}`);
            } else {
                 console.error(`[LOG handler] Transporter no inicializado, omitiendo envío de factura.`);
            }
        } catch (emailError) {
            console.error(`[LOG handler] Error al enviar la factura:`, emailError.message);
        }
    }

    // --- Limpieza del archivo temporal ---
    if (paymentReceiptFile && paymentReceiptFile.filepath && fs.existsSync(paymentReceiptFile.filepath)) {
        try {
            fs.unlinkSync(paymentReceiptFile.filepath);
        } catch (unlinkError) {
            console.error(`[LOG handler] Error al eliminar el archivo temporal:`, unlinkError);
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ 
            message: "Solicitud de pago recibida exitosamente. ¡Te enviaremos una confirmación pronto!" 
        }),
    };
};