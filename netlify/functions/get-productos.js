// netlify/functions/get-productos.js
// 1-10 (Líneas ya dadas)
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    // 1. Verificar el método (solo GET)
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // 2. Configuración de Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; // Usar clave Anon para lectura pública
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 11-20 (Líneas restantes para completar la función)
    // 3. Obtener los datos con JOIN de productos y paquetes
    const { data: productos, error } = await supabase
        .from('productos')
        .select(`
            *, 
            paquetes (*)
        `)
        .eq('activo', true) 
        .order('orden', { ascending: true });
        
    // 4. Manejar errores
    if (error) {
        console.error("Error fetching products:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error al obtener los productos", details: error.message })
        };
    }

    // 5. Devolver los datos
    return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(productos),
    };
}