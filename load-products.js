// load-products.js

document.addEventListener('DOMContentLoaded', () => {
    // 1. Obtener el contenedor donde se inyectarán los productos
    const productGrid = document.getElementById('product-grid');
    if (!productGrid) return; // Si no estamos en index.html, salimos

    // 2. Función para generar el HTML de una tarjeta de producto
    function createProductCard(product) {
        // Usamos el 'slug' para generar un enlace a la página de producto genérica (product.html)
        const href = `product.html?slug=${product.slug}`;
        
        // La descripción se recorta si es demasiado larga (200 caracteres es el límite que definimos)
        const description = product.descripcion ? 
            (product.descripcion.length > 150 ? product.descripcion.substring(0, 150) + '...' : product.descripcion) :
            'Recarga fácil y rápido con Malok Recargas.';

        // Usamos el 'banner_url' de Supabase
        const imageUrl = product.banner_url || 'images/default_banner.jpg';

        return `
            <a href="${href}" class="game-card">
                <img src="${imageUrl}" alt="${product.nombre}">
                <h2>${product.nombre}</h2>
                <p class="game-description">${description}</p>
            </a>
        `;
    }

    // 3. Función principal para obtener y renderizar los productos
    async function loadProducts() {
        // Mostrar un mensaje de carga mientras llegan los datos
        productGrid.innerHTML = `<p class="loading-message"><i class="fas fa-spinner fa-spin"></i> Cargando productos...</p>`;
        
        try {
            // Llamada a la Netlify Function que lee Supabase
            const response = await fetch('/.netlify/functions/get-productos');
            
            if (!response.ok) {
                throw new Error(`Error ${response.status}: No se pudieron cargar los productos.`);
            }

            const products = await response.json();
            
            // Limpiar el mensaje de carga
            productGrid.innerHTML = ''; 

            if (products.length === 0) {
                productGrid.innerHTML = `<p class="empty-message">Aún no hay productos disponibles. Vuelve pronto.</p>`;
                return;
            }

            // Iterar y renderizar los productos
            products.forEach(product => {
                const cardHtml = createProductCard(product);
                productGrid.insertAdjacentHTML('beforeend', cardHtml);
            });
            
        } catch (error) {
            // Mostrar un mensaje de error si la carga falla
            console.error('Error al cargar productos:', error.message);
            productGrid.innerHTML = `<p class="error-message">❌ Lo sentimos, no pudimos cargar los juegos. Inténtalo más tarde.</p>`;
        }
    }

    loadProducts(); // Ejecutar la función para empezar a cargar
});