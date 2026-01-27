const { createClient } = require('@supabase/supabase-js');

// =================================================================
// 💡 CONFIGURACIÓN DE SUPABASE (FUERA DEL HANDLER para reuso)
// =================================================================

// Variables de entorno de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
// Usamos la Service Key ya que estamos en el backend y necesitamos permisos de escritura/actualización
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; 

let supabase = null;

if (supabaseUrl && supabaseServiceKey) {
    supabase = createClient(supabaseUrl, supabaseServiceKey);
}

// =================================================================
// 🔑 FUNCIÓN NETLIFY HANDLER
// =================================================================

exports.handler = async function(event, context) {
    
    // Verificar si la configuración de Supabase está disponible
    if (!supabase) {
        console.error("Faltan variables de entorno de Supabase.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Faltan credenciales de Supabase." }) 
        };
    }
    
    // 1. Verificar el método (solo POST)
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ message: "Method Not Allowed" }) };
    }

    // 2. Obtener y verificar el token de sesión (Custom Auth)
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log("❌ ERROR 401: Falta el token Bearer.");
        return { 
            statusCode: 401, 
            body: JSON.stringify({ message: "No autorizado. Falta el token de sesión." }) 
        };
    }

    // Extraer el token de la cadena "Bearer <token>"
    const sessionToken = authHeader.substring(7);

    // 3. Obtener el cuerpo de la solicitud
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ message: "Formato de cuerpo inválido." }) };
    }
    
    // Validar los datos necesarios para la deducción
    const { 
        amountUSD, 
        email, 
        whatsapp, 
        cartDetails
    } = body;
    
    // ⚠️ Importante: Aseguramos que el monto sea un número válido antes de la deducción
    const deductionAmount = parseFloat(amountUSD);

    if (isNaN(deductionAmount) || deductionAmount <= 0) {
        return { statusCode: 400, body: JSON.stringify({ message: "Monto de deducción inválido." }) };
    }

    try {
        // 4. Buscar usuario por el token de sesión (Verificación de sesión)
        const { data: userData, error: authError } = await supabase
            .from('usuarios')
            .select('google_id, nombre, email, saldos!left(saldo_usd)') 
            .eq('session_token', sessionToken) 
            .maybeSingle();

        if (authError || !userData) {
            console.error("❌ ERROR 401: Token de sesión inválido o expirado.", authError);
            return { 
                statusCode: 401, 
                body: JSON.stringify({ message: "La sesión no es válida. Por favor, inicia sesión de nuevo." }) 
            };
        }
        
        const googleId = userData.google_id;
        
        // 🚨 LÍNEA CLAVE DE DIAGNÓSTICO AÑADIDA
        console.log(`✅ DIAGNÓSTICO: Google ID del usuario logueado: ${googleId}`);
        console.log("✅ DIAGNÓSTICO: Saldo crudo (userData.saldos):", JSON.stringify(userData.saldos));
        
        if (!googleId) {
            console.error("Usuario encontrado sin Google ID.", userData);
            return { 
                statusCode: 500, 
                body: JSON.stringify({ message: "Error interno: ID de usuario no disponible." }) 
            };
        }

        // 5. Verificar saldo suficiente
        // ⭐️ LÍNEA CORREGIDA ⭐️
        // Se accede directamente a 'saldo_usd' dentro del objeto 'saldos', ya que .maybeSingle() 
        // anida el resultado del JOIN como un objeto simple, no un array.
        const currentBalance = parseFloat(userData.saldos?.saldo_usd || 0.00); 

        console.log(`Saldo de ${userData.nombre} encontrado. Actual: ${currentBalance}, Requerido: ${deductionAmount}`);

        if (currentBalance < deductionAmount) {
            console.log(`❌ ERROR: Saldo insuficiente para ${userData.nombre}. Actual: ${currentBalance}, Requerido: ${deductionAmount}`);
            return { 
                statusCode: 403, 
                body: JSON.stringify({ message: "Saldo insuficiente en la billetera. Recarga para continuar." }) 
            };
        }

        const newBalance = currentBalance - deductionAmount;

        // =========================================================
        // === DEDUCCIÓN EN TRANSACCIÓN ===
        // =========================================================
        
        // 6. Actualizar saldo 
        const { error: updateError } = await supabase
            .from('saldos')
            .update({ 
                saldo_usd: newBalance.toFixed(2)
            })
            .eq('user_id', googleId); 

        if (updateError) {
            console.error("Error al actualizar saldo:", updateError);
            return { 
                statusCode: 500, 
                body: JSON.stringify({ message: "Fallo al actualizar el saldo en la base de datos." }) 
            };
        }

        // 7. Registrar la transacción
        let parsedCartDetails = cartDetails;
        try {
            if (typeof cartDetails === 'string') {
                parsedCartDetails = JSON.parse(cartDetails);
            }
        } catch (parseError) {
            console.error("Advertencia: Falló el parseo de cartDetails. Se insertará el valor original.", parseError);
            parsedCartDetails = cartDetails; 
        }

        const transactionData = {
            user_id: googleId,
            monto: -deductionAmount, 
            tipo: 'pago_servicio',
            descripcion: `Pago de servicio con Wallet (${email})`,
            metadatos: { email, whatsapp, cartDetails: parsedCartDetails } 
        };

        const { error: transError } = await supabase
            .from('transacciones')
            .insert(transactionData);

        if (transError) {
            console.error("Error al registrar transacción (advertencia):", transError);
        }

        // 8. Éxito
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: "Deducción exitosa.",
                nuevo_saldo: newBalance.toFixed(2),
                usuario: userData.nombre
            }),
        };

    } catch (error) {
        console.error(`[NETLIFY FUNCTION] Error FATAL: ${error.message}`);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: error.message || "Error desconocido al procesar el pago." }),
        };
    }
}