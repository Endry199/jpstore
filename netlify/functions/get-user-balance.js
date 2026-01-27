const { createClient } = require('@supabase/supabase-js');

/**
 * Netlify Function para obtener el saldo actual del usuario desde Supabase,
 * usando el token de sesión personalizado guardado en Supabase.
 */
exports.handler = async function(event, context) {
    console.log("--- INICIO DE FUNCIÓN get-user-balance (Custom Auth) ---");
    
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // 1. Obtener y verificar el token de sesión (Custom Auth)
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log("❌ ERROR 401: Falta el token Bearer.");
        return { 
            statusCode: 401, 
            body: JSON.stringify({ message: "No autorizado. Falta el token de sesión." }) 
        };
    }
    
    // Extraer el token de la forma "Bearer [token]"
    const sessionToken = authHeader.split(' ')[1];
    console.log("Token de sesión extraído (Longitud):", sessionToken.length);

    // 2. Configuración de Supabase (Usando la Service Key para operaciones de backend)
    const supabaseUrl = process.env.SUPABASE_URL;
    // CLAVE: Usamos la Service Key para poder buscar por el campo session_token de forma segura.
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; 

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error("Faltan variables de entorno de Supabase (URL o SERVICE_KEY).");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor." })
        };
    }

    // Usamos el cliente de Supabase con la Service Key
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    try {
        // 3. Buscar el user_id (Google ID) asociado a este token de sesión personalizado
        const { data: userData, error: userError } = await supabase
            .from('usuarios')
            .select('google_id') 
            .eq('session_token', sessionToken)
            .maybeSingle(); 

        if (userError || !userData) {
            console.error("❌ ERROR 401: Token de sesión inválido o no encontrado en la tabla 'usuarios'.", userError?.message);
            return { statusCode: 401, body: JSON.stringify({ message: "Sesión inválida o expirada. Por favor, vuelve a iniciar sesión." }) };
        }
        
        const userId = userData.google_id; // Este es el ID que mapea a saldos.user_id
        console.log("✅ Token verificado con Supabase. User ID (Google ID):", userId);

        // 4. Buscar el saldo usando el google_id
        const { data: saldoData, error: saldoError } = await supabase
            .from('saldos') 
            .select('saldo_usd') 
            .eq('user_id', userId) // Filtramos por el Google ID
            .maybeSingle(); 

        if (saldoError) {
            console.error("Error de Supabase al obtener saldo:", saldoError.message);
            throw new Error(saldoError.message || "Error desconocido en la consulta de saldo."); 
        }

        // 5. Extraer el valor con el nombre de columna correcto (saldo_usd)
        const saldoActual = saldoData?.saldo_usd || '0.00'; 
        console.log(`✅ Saldo final encontrado: ${saldoActual}`);
        
        // 6. Devolver el saldo.
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ saldo: saldoActual }),
        };

    } catch (error) {
        console.error("Error FATAL en la función get-user-balance:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `Error interno del servidor al cargar el saldo: "${error.message}"` }),
        };
    } finally {
        console.log("--- FIN DE FUNCIÓN get-user-balance ---");
    }
}