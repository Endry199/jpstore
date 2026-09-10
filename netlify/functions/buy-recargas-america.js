// netlify/functions/buy-recargas-america.js
const axios = require('axios');

const RA_API_BASE = 'https://panel.recargasamerica.com/api/v1';

// =========================================================
// 🆕 NUEVA FUNCIÓN: Notificar al admin por Telegram cuando falla por falta de fondos
// =========================================================
async function notifyAdminAboutBalance(errorMessage, productId, redemptionId, httpStatus) {
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.warn('[RA] No se puede notificar a Telegram: faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.');
        return;
    }

    const alertText = 
        `🚨 *ALERTA CRÍTICA — RECARGAS AMÉRICA* 🚨\n\n` +
        `⚠️ *No se pudo procesar una recarga por falta de fondos o stock.*\n\n` +
        `📦 *Producto (Recargas América):* \`${productId}\`\n` +
        `👤 *Redemption ID (Jugador):* \`${redemptionId}\`\n` +
        `💬 *Mensaje de la API:* ${errorMessage}\n` +
        `🔢 *HTTP Status:* ${httpStatus}\n\n` +
        `🔴 *ACCIÓN REQUERIDA:*\n` +
        `Recarga saldo en tu panel de Recargas América lo antes posible.\n\n` +
        `_Nota: El saldo del cliente fue REEMBOLSADO automáticamente (si aplicó). No se perdió dinero del cliente._`;

    try {
        await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                chat_id: TELEGRAM_CHAT_ID,
                text: alertText,
                parse_mode: 'Markdown'
            }
        );
        console.log('[RA] ✅ Alerta de fondos enviada a Telegram.');
    } catch (tgError) {
        console.error('[RA] ❌ No se pudo enviar la alerta a Telegram:', tgError.message);
    }
}

exports.handler = async function(event, context) {
    // Solo POST
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ message: "Method Not Allowed" }) };
    }

    // --- Variables de entorno ---
    const RA_API_KEY = process.env.RECARGAS_AMERICA_API_KEY;

    if (!RA_API_KEY) {
        console.error('[RA] RECARGAS_AMERICA_API_KEY no está configurada.');
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Error de configuración: Falta la API Key de Recargas América.' })
        };
    }

    // --- Parsear body ---
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Body JSON inválido.' }) };
    }

    const { product_id, redemption_id } = body;

    if (!product_id || !redemption_id) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Faltan campos requeridos: product_id y redemption_id.' })
        };
    }

    // --- Llamada a la API de Recargas América ---
    try {
        console.log(`[RA] Enviando recarga. product_id=${product_id}, redemption_id=${redemption_id}`);

        const response = await axios.post(
            `${RA_API_BASE}/buy/pins`,
            {
                product_id: parseInt(product_id, 10),
                redemption_id: String(redemption_id)
            },
            {
                headers: {
                    'Authorization': `Bearer ${RA_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30 segundos de timeout
            }
        );

        console.log('[RA] Respuesta:', JSON.stringify(response.data));

        // La API devuelve { success: true, data: { transaction_id, amount_charged, api_data } }
        if (response.data && response.data.success === true) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    data: response.data.data
                })
            };
        } else {
            // La API respondió pero con success: false
            const errMsg = response.data.error || 'La API de Recargas América rechazó la orden.';
            const errCode = response.data.code || 'RA_ERROR';

            // 🆕 Si el error es por fondos/stock, alertar al admin
            if (errCode === 'PURCHASE_FAILED' || errMsg.toLowerCase().includes('saldo') || errMsg.toLowerCase().includes('stock')) {
                await notifyAdminAboutBalance(errMsg, product_id, redemption_id, 422);
            }

            return {
                statusCode: 422,
                body: JSON.stringify({
                    success: false,
                    message: errMsg,
                    code: errCode
                })
            };
        }

    } catch (error) {
        console.error('[RA] Error en la llamada:', error.message);

        // Manejo de errores de la API
        if (error.response) {
            // La API respondió con código de error
            const status = error.response.status;
            const data = error.response.data;

            console.error('[RA] Error response:', status, JSON.stringify(data));

            // Códigos de error documentados
            let errorMessage = 'Error al procesar la recarga.';
            let shouldNotifyAdmin = false;

            if (status === 401) {
                errorMessage = 'API Key inválida o desactivada.';
                shouldNotifyAdmin = true; // También avisamos porque requiere acción del admin
            } else if (status === 403) {
                errorMessage = 'IP no permitida o cuenta bloqueada.';
                shouldNotifyAdmin = true;
            } else if (status === 422) {
                errorMessage = data.error || 'Saldo insuficiente o sin stock.';
                shouldNotifyAdmin = true; // 🆕 Falta de fondos
            } else if (status === 409) {
                errorMessage = 'Compra duplicada (ya fue procesada).';
            } else if (status === 502) {
                errorMessage = 'El proveedor rechazó la orden. Saldo devuelto.';
                shouldNotifyAdmin = true;
            } else if (data && data.error) {
                errorMessage = data.error;
            }

            // 🆕 Notificar al admin si aplica
            if (shouldNotifyAdmin) {
                await notifyAdminAboutBalance(errorMessage, product_id, redemption_id, status);
            }

            return {
                statusCode: status,
                body: JSON.stringify({
                    success: false,
                    message: errorMessage,
                    code: data ? data.code : 'RA_ERROR'
                })
            };
        }

        // Error de red o timeout
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message: `Error de conexión con Recargas América: ${error.message}`
            })
        };
    }
};