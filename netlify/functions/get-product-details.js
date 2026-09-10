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
        // ⚠️ IMPORTANTE:
        // - De PRODUCTOS: solo columnas que existen ahí (NO recargas_america_id)
        // - De PAQUETES: precios + recargas_america_id (esa sí existe aquí)
        const { data: producto, error } = await supabase
            .from('productos')
            .select(`
                id,
                nombre,
                slug,
                descripcion,
                banner_url,
                require_id,
                es_free_fire,
                paquetes (
                    nombre_paquete, 
                    precio_usd, 
                    precio_ves, 
                    precio_usdm,
                    precio_cop, 
                    orden,
                    recargas_america_id
                )
            `)
            .eq('slug', slug)
            .maybeSingle(); 
            
        if (error) {
            console.error("Error de Supabase al obtener producto:", error);
            throw new Error(error.message || "Error desconocido en la consulta a Supabase."); 
        }

        if (!producto) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: `Producto no encontrado con el slug: ${slug}` })
            };
        }

        if (producto.paquetes && producto.paquetes.length > 0) {
            producto.paquetes.sort((a, b) => a.orden - b.orden);
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(producto),
        };

    } catch (error) {
        console.error("Error FATAL en la función get-product-details:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `Error interno del servidor al cargar el producto: "${error.message}"` }),
        };
    }
}