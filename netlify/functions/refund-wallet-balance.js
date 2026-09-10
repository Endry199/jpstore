// netlify/functions/refund-wallet-balance.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    // --- Verificar token Bearer ---
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Falta el token de autorización.' }) };
    }
    const sessionToken = authHeader.replace('Bearer ', '').trim();

    // --- Parsear body ---
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Body JSON inválido.' }) };
    }

    const { email, amountUSD, reason } = body;

    if (!email || !amountUSD) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Faltan campos: email y amountUSD.' }) };
    }

    const amount = parseFloat(amountUSD);
    if (isNaN(amount) || amount <= 0) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Monto inválido.' }) };
    }

    // --- Configurar Supabase ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        return { statusCode: 500, body: JSON.stringify({ message: 'Error de configuración del servidor.' }) };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    try {
        // 1. Validar token de sesión
        const { data: userData, error: userError } = await supabase
            .from('usuarios')
            .select('google_id, email, session_token')
            .eq('session_token', sessionToken)
            .maybeSingle();

        if (userError || !userData) {
            console.error('[REFUND] Token inválido:', userError?.message);
            return { statusCode: 401, body: JSON.stringify({ message: 'Token de sesión inválido o expirado.' }) };
        }

        if (userData.email !== email) {
            return { statusCode: 403, body: JSON.stringify({ message: 'El email no coincide con la sesión.' }) };
        }

        const googleId = userData.google_id;
        console.log(`[REFUND] Devolviendo $${amount} a ${googleId} (${email}). Razón: ${reason || 'No especificada'}`);

        // 2. Usar la misma función RPC que usa el webhook para incrementar saldo
        const { error: rpcError } = await supabase
            .rpc('incrementar_saldo', {
                p_user_id: googleId,
                p_monto: amount.toFixed(2)
            });

        if (rpcError) {
            console.error('[REFUND] Error al devolver saldo:', rpcError.message);
            return { statusCode: 500, body: JSON.stringify({ message: `Error al reembolsar: ${rpcError.message}` }) };
        }

        console.log(`[REFUND] ✅ Saldo devuelto exitosamente a ${googleId}`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: `Saldo de $${amount.toFixed(2)} reembolsado a ${email}.`,
                refunded: amount.toFixed(2)
            })
        };

    } catch (error) {
        console.error('[REFUND] Error fatal:', error.message);
        return { statusCode: 500, body: JSON.stringify({ message: `Error interno: ${error.message}` }) };
    }
};