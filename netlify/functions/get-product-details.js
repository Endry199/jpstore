// netlify/functions/get-product-details.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }
    
    const slug = event.queryStringParameters.slug;

    if (!slug) {
        return { 
            statusCode: 400, 
            body: JSON.stringify({ message: "Falta el 'slug' del producto." }) 
        };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; 
    
    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("Faltan variables de entorno de Supabase.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Faltan credenciales de Supabase." })
        };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
        // Consulta limpia a Supabase:
        const { data: producto, error } = await supabase
            .from('productos')
            .select(`
                id,
                nombre,
                slug,
                descripcion,
                banner_url,
                require_id,
                paquetes (
                    nombre_paquete, 
                    precio_usd, 
                    precio_ves, 
                    precio_usdm,
                    precio_cop, 
                    orden
                )
            `) // 👈 CAMBIO CLAVE: Se agregó 'precio_usdm'
            .eq('slug', slug)
            .maybeSingle(); 
            
        // Manejar errores de consulta de Supabase
        if (error) {
            console.error("Error de Supabase al obtener producto:", error);
            throw new Error(error.message || "Error desconocido en la consulta a Supabase."); 
        }

        // Manejar el caso de producto no encontrado
        if (!producto) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: `Producto no encontrado con el slug: ${slug}` })
            };
        }

        // Ordenar los paquetes
        if (producto.paquetes && producto.paquetes.length > 0) {
            producto.paquetes.sort((a, b) => a.orden - b.orden);
        }

        // Devolver los datos
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(producto),
        };

    } catch (error) {
        // Devolvemos el error de la consulta de Supabase al frontend
        console.error("Error FATAL en la función get-product-details:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `Error interno del servidor al cargar el producto: "${error.message}"` }),
        };
    }
}