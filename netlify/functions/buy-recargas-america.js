// netlify/functions/buy-recargas-america.js
const axios = require('axios');

const RA_API_BASE = 'https://panel.recargasamerica.com/api/v1';

// =========================================================
// Notificar al admin por Telegram cuando falla por falta de fondos
// =========================================================
async function notifyAdminAboutBalance(errorMessage, productId, redemptionId, httpStatus) {
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.warn('[RA] No se puede notificar a Telegram: faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.');
        return;
    }

    const alertText =
        `🚨 <b>ALERTA CRÍTICA — RECARGAS AMÉRICA</b> 🚨\n\n` +
        `⚠️ <b>No se pudo procesar una recarga por falta de fondos o stock.</b>\n\n` +
        `📦 <b>Producto:</b> <code>${productId}</code>\n` +
        `👤 <b>Redemption ID:</b> <code>${redemptionId}</code>\n` +
        `💬 <b>Mensaje de la API:</b> ${errorMessage}\n` +
        `🔢 <b>HTTP Status:</b> ${httpStatus}\n\n` +
        `🔴 <b>ACCIÓN REQUERIDA:</b>\n` +
        `Recarga saldo en tu panel de Recargas América lo antes posible.\n\n` +
        `<i>Nota: El saldo del cliente fue REEMBOLSADO automáticamente (si aplicó). No se perdió dinero del cliente.</i>`;

    try {
        await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                chat_id: TELEGRAM_CHAT_ID,
                text: alertText,
                parse_mode: 'HTML'
            }
        );
        console.log('[RA] ✅ Alerta de fondos enviada a Telegram.');
    } catch (tgError) {
        console.error('[RA] ❌ No se pudo enviar la alerta a Telegram:', tgError.message);
    }
}

exports.handler = async function (event, context) {
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

    const { product_id, redemption_id, required_field } = body;

    if (!product_id || !redemption_id) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Faltan campos requeridos: product_id y redemption_id.' })
        };
    }

    // Determinar el campo correcto según lo que pida la API
    // - required_field === 'manual_id' → enviar manual_id
    // - required_field === 'player_id' → enviar player_id
    // - por defecto → 'player_id'
    const fieldName = required_field === 'manual_id' ? 'manual_id' : 'player_id';

    // Construir el body para /buy/catalog (Catálogo Unificado)
    const requestBody = {
        product_id: parseInt(product_id, 10),
        quantity: 1,
        [fieldName]: String(redemption_id)
    };

    // --- Llamada a la API de Recargas América (Catálogo Unaaaificado) ---
    try {
        console.log(`[RA] Enviando recarga (Catálogo). product_id=${product_id}, ${fieldName}=${redemption_id}`);

        const response = await axios.post(
            `${RA_API_BASE}/buy/catalog`,
            requestBody,
            {
                headers: {
                    'Authorization': `Bearer ${RA_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        console.log('[RA] Respuesta:', JSON.stringify(response.data));

        if (response.data && response.data.success === true) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    data: response.data.data
                })
            };
        } else {
            const errMsg = response.data.error || 'La API de Recargas América rechazó la orden.';
            const errCode = response.data.code || 'RA_ERROR';

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

        if (error.response) {
            const status = error.response.status;
            const data = error.response.data;

            console.error('[RA] Error response:', status, JSON.stringify(data));

            let errorMessage = 'Error al procesar la recarga.';
            let shouldNotifyAdmin = false;

            if (status === 401) {
                errorMessage = 'API Key inválida o desactivada.';
                shouldNotifyAdmin = true;
            } else if (status === 403) {
                errorMessage = 'IP no permitida o cuenta bloqueada.';
                shouldNotifyAdmin = true;
            } else if (status === 422) {
                errorMessage = data.error || 'Saldo insuficiente o sin stock.';
                shouldNotifyAdmin = true;
            } else if (status === 409) {
                errorMessage = 'Compra duplicada (ya fue procesada).';
            } else if (status === 502) {
                errorMessage = 'El proveedor rechazó la orden. Saldo devuelto.';
                shouldNotifyAdmin = true;
            } else if (status === 404) {
                errorMessage = 'Endpoint deshabilitado. Migrar al catálogo unificado.';
                shouldNotifyAdmin = true;
            } else if (data && data.error) {
                errorMessage = data.error;
            }

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

        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message: `Error de conexión con Recargas América: ${error.message}`
            })
        };
    }
};