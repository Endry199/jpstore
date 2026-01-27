// script.js COMPLETO Y MODIFICADO (Versión Final con Soporte JPUSD Separado y Refresco de Saldo)

// 🎯 FUNCIÓN PARA CARGAR Y APLICAR LA CONFIGURACIÓN DE COLORES
async function applySiteConfig() {
    try {
        // Llama a la Netlify Function que lee Supabase
        const response = await fetch('/.netlify/functions/get-site-config');
        
        if (!response.ok) {
            throw new Error(`Error ${response.status}: No se pudo cargar la configuración del sitio.`);
        }

        const config = await response.json();
        
        // Aplicar las variables CSS al :root (document.documentElement es el <html>)
        for (const [key, value] of Object.entries(config)) {
            // Solo aplica variables que tienen el prefijo --
            if (value && key.startsWith('--')) {
                document.documentElement.style.setProperty(key, value);
            }
        }
        
        // 🟢 CORRECCIÓN CLAVE: Despachar un evento al finalizar la carga de la configuración
        document.dispatchEvent(new CustomEvent('siteConfigLoaded')); 
        
    } catch (error) {
        console.error('[CLIENTE] Error al aplicar configuración de colores:', error.message);
        // Si falla, el sitio seguirá usando los colores por defecto definidos en style.css
    }
}


// =================================================================
// === MÓDULO DE AUTENTICACIÓN: GOOGLE SIGN-IN & SESIÓN ===
// =================================================================

// ⚠️ ATENCIÓN: El CLIENT_ID es un identificador público.
const GOOGLE_CLIENT_ID = '308840006976-mttmu0hd65scpg9umpgk4tt2qnrgn07d.apps.googleusercontent.com'; 

/**
 * Función CLAVE para verificar la sesión en localStorage y actualizar la UI.
 * @returns {boolean} True si hay una sesión activa.
 */
function checkUserSessionAndRenderUI() {
    const sessionToken = localStorage.getItem('userSessionToken');
    const userDataJson = localStorage.getItem('userData');
    const isLoggedIn = sessionToken && userDataJson;
    
    // Elementos del DOM de la Billetera (NUEVOS)
    const walletContainer = document.getElementById('wallet-container'); 
    const virtualBalanceElement = document.getElementById('virtual-balance'); 

    // Elementos del DOM de Auth (Existentes)
    const toggleLoginBtn = document.getElementById('toggle-login-btn');
    const authDisplayName = document.getElementById('auth-display-name'); 
    const authUserPicture = document.getElementById('auth-user-picture');
    const googleLoginBtnContainer = document.getElementById('google-login-btn');
    const logoutBtn = document.getElementById('logout-btn');

    // Selector para el ícono genérico
    const genericIcon = toggleLoginBtn ? toggleLoginBtn.querySelector('.fas.fa-user-circle') : null;
    
    if (isLoggedIn) {
        // SESIÓN ACTIVA
        const userData = JSON.parse(userDataJson);
        const userName = userData.name || userData.email || 'Mi Cuenta'; 

        if (toggleLoginBtn) {
            // 1. Mostrar la imagen de perfil de Google
            if (authUserPicture) {
                authUserPicture.src = userData.picture || 'images/default_user.png';
                authUserPicture.style.display = 'block';
            }
            
            // 2. Ocultar el ícono de usuario genérico
            if (genericIcon) genericIcon.style.display = 'none';

            // 3. Actualizar el nombre en el dropdown
            if (authDisplayName) {
                authDisplayName.textContent = userName;
            }
            
            // 4. Mostrar el botón de Cerrar Sesión y ocultar el contenedor de Google (si existe)
            if (logoutBtn) logoutBtn.style.display = 'block';
            if (googleLoginBtnContainer) googleLoginBtnContainer.style.display = 'none';
        }
        
        // 5. Lógica de la Billetera
        if (walletContainer && virtualBalanceElement) {
            // Lee el saldo de localStorage (el cual será actualizado inmediatamente por refreshWalletBalance)
            const balance = userData.balance || '0.00'; 
            virtualBalanceElement.textContent = `$. ${balance}`;
            walletContainer.style.display = 'flex'; // Mostrar la billetera
        }


    } else {
        // SESIÓN INACTIVA
        if (toggleLoginBtn) {
            // 1. Mostrar el ícono de usuario genérico
            if (genericIcon) genericIcon.style.display = 'block';
            
            // 2. Ocultar la imagen de perfil
            if (authUserPicture) {
                authUserPicture.style.display = 'none';
            }
        }
        
        // 3. Restaurar el texto del dropdown a "Iniciar Sesión"
        if (authDisplayName) authDisplayName.textContent = 'Iniciar Sesión';
        
        // 4. Ocultar el botón de Cerrar Sesión. El botón de Google se manejará en initGoogleSignIn
        if (logoutBtn) logoutBtn.style.display = 'none';

        // 5. Ocultar la Billetera
        if (walletContainer) {
            walletContainer.style.display = 'none';
        }
    }
    
    return isLoggedIn;
}

/**
// script.js (SOLO LA FUNCIÓN handleCredentialResponse)
// ... (código previo de script.js)

/**
 * Función de Callback llamada por el SDK de Google al iniciar sesión.
 */
window.handleCredentialResponse = async (response) => {
    const idToken = response.credential;
    
    const loginBtnContainer = document.getElementById('google-login-btn');
    if (loginBtnContainer) {
        loginBtnContainer.innerHTML = '<p style="color:var(--text-color); margin: 0; text-align: center;">Iniciando sesión...</p>';
    }

    try {
        // Enviar el token a tu Netlify Function para verificación.
        const serverResponse = await fetch('/.netlify/functions/process-google-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: idToken }),
        });

        if (serverResponse.ok) {
            const data = await serverResponse.json();
            
            // Login Exitoso: Guardar la sesión
            localStorage.setItem('userSessionToken', data.sessionToken);
            // El backend ya garantiza que 'balance' existe
            localStorage.setItem('userData', JSON.stringify(data.user)); 
            
            // 🚨 MODIFICACIÓN CLAVE PARA LA REDIRECCIÓN 🚨
            const redirectUrl = localStorage.getItem('redirectAfterLogin');
            const finalRedirect = redirectUrl || 'index.html'; // Usar la URL guardada o index.html como fallback

            // Si se usó una URL de redirección, la eliminamos para que no se use en el futuro
            if (redirectUrl) {
                localStorage.removeItem('redirectAfterLogin');
                console.log(`Redirigiendo de vuelta a: ${finalRedirect}`);
            }
            // ----------------------------------------------

            // Mostrar el mensaje de bienvenida
            const userName = data.user.name || 'Usuario';
            
            // Usamos un pequeño timeout para asegurarnos de que el alert se muestre antes de la recarga
            setTimeout(() => {
                    alert(`¡Bienvenido(a), ${userName}! Has iniciado sesión correctamente.`);
                    
                    // 🎯 REDIRECCIÓN FINAL: Usa la URL determinada (payment.html o index.html)
                    window.location.href = finalRedirect; 
            }, 50);

        } else {
            const errorData = await serverResponse.json();
            alert(`Error al iniciar sesión: ${errorData.message || 'Token inválido o error del servidor.'}`);
            console.error("Error del servidor en el login:", errorData);
            
            // Si falla, re-inicializar el botón
            if (window.google && window.google.accounts && window.google.accounts.id) {
                    initGoogleSignIn(true); // Forzar la renderización del botón
            }
        }

    } catch (error) {
        alert('Hubo un problema de conexión con el servidor. Inténtalo de nuevo.');
        console.error("Error de red/cliente:", error);
    }
};

// ... (resto del código de script.js)
/**
 * Inicializa el SDK de Google y dibuja el botón.
 * @param {boolean} forceRender Si es true, fuerza la renderización aunque haya sesión.
 */
function initGoogleSignIn(forceRender = false) {
    const loginButtonElement = document.getElementById('google-login-btn');
    
    // Si ya hay sesión activa Y no estamos forzando la renderización (ej. después de un error), salir.
    if (!forceRender && checkUserSessionAndRenderUI()) {
        if (loginButtonElement) loginButtonElement.style.display = 'none';
        return;
    }
    
    if (loginButtonElement && typeof window.google !== 'undefined') { 
        
        if (GOOGLE_CLIENT_ID === 'TU_GOOGLE_CLIENT_ID_AQUÍ') {
            loginButtonElement.innerHTML = '<p style="color:red; text-align:center;">❌ CONFIGURACIÓN PENDIENTE: Reemplaza el ID de Google en script.js.</p>';
            loginButtonElement.style.display = 'block';
            return;
        }

        window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: window.handleCredentialResponse, 
            auto_select: false,
            cancel_on_tap_outside: true, 
        });

        // Dibuja el botón
        window.google.accounts.id.renderButton(
            loginButtonElement,
            { 
                theme: "filled_blue", 
                size: "large", 
                text: "continue_with",
                width: 300 
            } 
        );
        loginButtonElement.style.display = 'block';
    }
}


// 💡 Función global para obtener la moneda guardada.
window.getCurrentCurrency = function() {
    // Retorna la moneda guardada ('USD' o 'VES'), o 'VES' como valor por defecto.
    return localStorage.getItem('selectedCurrency') || 'VES'; 
};


// =========================================================================
// === NUEVA FUNCIÓN CLAVE: Refresco de Saldo de Billetera ===
// =========================================================================

/**
 * Llama a la Netlify Function para obtener el saldo actual del usuario
 * y actualiza tanto localStorage como la UI, sin forzar un re-login.
 */
async function refreshWalletBalance() {
    const userDataJson = localStorage.getItem('userData');
    const userSessionToken = localStorage.getItem('userSessionToken'); // Obtener el token de sesión
    
    if (!userDataJson || !userSessionToken) {
        console.log("[Wallet] No hay usuario logueado o token. Cancelando refresh.");
        return; // No hay usuario logueado.
    }

    try {
        console.log("[Wallet] Enviando solicitud de saldo con token de sesión...");
        
        // 🔑 CORRECCIÓN CLAVE: Enviar el token en el encabezado Authorization
        const response = await fetch('/.netlify/functions/get-user-balance', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${userSessionToken}`, // Esto soluciona el 401 del servidor
                'Content-Type': 'application/json' 
            }
        }); 

        if (response.status === 401) {
            console.error("[Wallet] Error 401: El token de sesión fue rechazado por el servidor. Forzando cierre de sesión.");
            // Si el servidor rechaza el token (inválido/expirado), forzamos logout para reautenticar.
            window.logoutUser(); 
            return;
        }

        if (!response.ok) {
            throw new Error(`Error ${response.status}: No se pudo obtener el saldo.`);
        }

        const data = await response.json();
        
        // data.saldo es el campo que devuelve tu Netlify Function
        const newBalance = data.saldo || '0.00';
        
        // 1. Actualizar el localStorage con el nuevo saldo
        const userData = JSON.parse(userDataJson);
        // Aseguramos que el saldo se guarde como un string con 2 decimales.
        userData.balance = parseFloat(newBalance).toFixed(2); 
        localStorage.setItem('userData', JSON.stringify(userData));

        // 2. Actualizar la UI directamente
        const virtualBalanceElement = document.getElementById('virtual-balance'); 
        if (virtualBalanceElement) {
            virtualBalanceElement.textContent = `$. ${userData.balance}`;
        }
        
        console.log(`[Wallet] Saldo actualizado a: $.${userData.balance}`);
        
    } catch (error) {
        console.error("Error al refrescar el saldo de la billetera:", error);
    }
}
// Hacemos la función global para que pueda ser llamada desde la lógica de pago/recarga
window.refreshWalletBalance = refreshWalletBalance; 
// -----------------------------------------------------------------


document.addEventListener('DOMContentLoaded', () => {
    // ---- Lógica para el nuevo selector de moneda personalizado ----
    const customCurrencySelector = document.getElementById('custom-currency-selector');
    const selectedCurrencyDisplay = document.getElementById('selected-currency');
    const currencyOptionsDiv = document.getElementById('currency-options');
    // Aseguramos que los elementos existan antes de hacer querySelectorAll
    const currencyOptions = currencyOptionsDiv ? currencyOptionsDiv.querySelectorAll('.option') : []; 

    // Función para actualizar la UI del selector y guardar la moneda
    function updateCurrencyDisplay(value, text, imgSrc) {
        if (selectedCurrencyDisplay) { 
            selectedCurrencyDisplay.innerHTML = `<img src="${imgSrc}" alt="${text.split(' ')[2] ? text.split(' ')[2].replace(/[()]/g, '') : 'Flag'}"> <span>${text}</span> <i class="fas fa-chevron-down"></i>`;
        }
        const prevCurrency = localStorage.getItem('selectedCurrency');
        localStorage.setItem('selectedCurrency', value);
        
        // Dispatch custom event solo si la moneda realmente cambió
        if (prevCurrency !== value) {
             window.dispatchEvent(new CustomEvent('currencyChanged', { detail: { currency: value } }));
        }
    }

    // Inicializar el selector con la moneda guardada o por defecto
    const savedCurrency = localStorage.getItem('selectedCurrency') || 'VES'; 
    let initialText = 'Bs. (VES)';
    let initialImgSrc = 'images/flag_ve.png';

    if (savedCurrency === 'USD') {
        initialText = '$ (USD)';
        initialImgSrc = 'images/flag_us.png';
    } else if (savedCurrency === 'JPUSD') { 
        initialText = '$ (JPUSD)';
        initialImgSrc = 'images/favicon.ico';
    } else if (savedCurrency === 'COP') {
        initialText = '$ (COP)';
        initialImgSrc = 'images/flag_co.png';
    }
    updateCurrencyDisplay(savedCurrency, initialText, initialImgSrc);

    // Toggle para abrir/cerrar el selector
    if (selectedCurrencyDisplay) { 
        selectedCurrencyDisplay.addEventListener('click', (event) => {
            event.stopPropagation(); 
            if (customCurrencySelector) { 
                customCurrencySelector.classList.toggle('show'); 
            }
        });
    }

    // Manejar la selección de una opción
    currencyOptions.forEach(option => {
        option.addEventListener('click', () => {
            const value = option.dataset.value;
            const text = option.querySelector('span').textContent;
            const imgSrc = option.querySelector('img').src;
            
            updateCurrencyDisplay(value, text, imgSrc);
            if (customCurrencySelector) { 
                customCurrencySelector.classList.remove('show'); 
            }
        });
    });

    // Cerrar el selector si se hace clic fuera de él
    document.addEventListener('click', (event) => {
        if (customCurrencySelector && !customCurrencySelector.contains(event.target)) {
            customCurrencySelector.classList.remove('show'); 
        }
    });

    // ---- Lógica de la barra de búsqueda (filtrado) ----
    const searchInput = document.querySelector('.search-bar input');
    const productGrid = document.getElementById('product-grid'); 

    if (searchInput) { 
        searchInput.addEventListener('input', () => { 
            const searchTerm = searchInput.value.toLowerCase();

            if (productGrid) {
                const gameCards = productGrid.querySelectorAll('.game-card'); 

                gameCards.forEach(card => {
                    const gameName = card.querySelector('h2').textContent.toLowerCase(); 

                    if (gameName.includes(searchTerm)) {
                        card.style.display = 'flex'; 
                    } else {
                        card.style.display = 'none'; 
                    }
                });
            }
        });
    }
    
    
    // =========================================================================
    // === Lógica de Carrito (Shopping Cart) y Autenticación ===
    // =========================================================================

    const cartSidebar = document.getElementById('cart-sidebar');
    const cartIcon = document.getElementById('cart-icon');
    const closeCartBtn = document.getElementById('close-cart-btn');
    const cartItemsContainer = document.getElementById('cart-items');
    const cartTotalElement = document.getElementById('cart-total');
    const cartCountElement = document.getElementById('cart-count');
    const checkoutBtn = document.getElementById('checkout-btn');

    // Lógica de Login/Auth
    const authDropdown = document.getElementById('auth-dropdown');
    const toggleLoginBtn = document.getElementById('toggle-login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    
    // El enlace "Iniciar Sesión" / Nombre de Usuario
    const authDisplayLink = document.getElementById('auth-display-name');


    // --- UTILITY: Gestión de Datos del Carrito ---

    function getCart() {
        const cart = localStorage.getItem('cartItems');
        return cart ? JSON.parse(cart) : [];
    }

    function saveCart(cart) {
        localStorage.setItem('cartItems', JSON.stringify(cart));
    }

    // Función global para agregar un producto al carrito
    window.addToCart = function(item) {
        const cart = getCart();
        cart.push(item);
        saveCart(cart);
        renderCart();
    };

    function removeFromCart(itemId) {
        let cart = getCart();
        cart = cart.filter(item => item.id !== itemId); 
        saveCart(cart);
        renderCart(); 
    }

    // --- RENDERIZADO DEL CARRITO ---

    function renderCart() {
        const cart = getCart();
        if (!cartItemsContainer) return; 
        
        cartItemsContainer.innerHTML = ''; 
        let total = 0;
        const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
        // CLAVE: USD y JPUSD usan el mismo símbolo '$'
        const currencySymbol = selectedCurrency === 'VES' ? 'Bs.S' : '$';

        if (cart.length === 0) {
            cartItemsContainer.innerHTML = '<p class="empty-cart-message">Tu carrito está vacío.</p>';
            if (cartTotalElement) cartTotalElement.textContent = `${currencySymbol}0.00`;
            if (cartCountElement) cartCountElement.textContent = '0';
            if (checkoutBtn) checkoutBtn.disabled = true;
            return;
        }

        cart.forEach(item => {
            // Aseguramos que los precios sean números antes de sumar
            let price;
            
            if (selectedCurrency === 'VES') {
                // Si es VES, usa priceVES
                price = parseFloat(item.priceVES || 0);
            } else if (selectedCurrency === 'JPUSD') {
                // Si es JPUSD, usa el nuevo campo priceJPUSD
                price = parseFloat(item.priceJPUSD || 0); 
            } else if (selectedCurrency === 'COP') {
                // Si es COP, usa priceCOP (si existe, si no, usa USD)
                price = parseFloat(item.priceCOP || item.priceUSD || 0);
            } else {
                // Por defecto (USD), usa priceUSD
                price = parseFloat(item.priceUSD || 0);
            }
            
            total += price;
            
            const priceDisplay = `${currencySymbol}${price.toFixed(2)}`;
            
            const cartItemDiv = document.createElement('div');
            cartItemDiv.className = 'cart-item';
            cartItemDiv.innerHTML = `
                <div class="cart-item-details">
                    <strong>${item.game}</strong>
                    <span>${item.packageName}</span>
                    <span>ID: ${item.playerId || 'N/A'}</span>
                </div>
                <span class="cart-item-price">${priceDisplay}</span>
                <button class="remove-item-btn" data-item-id="${item.id}">
                    <i class="fas fa-trash-alt"></i>
                </button>
            `;
            cartItemsContainer.appendChild(cartItemDiv);
        });

        if (cartTotalElement) {
            const totalDisplay = `${currencySymbol}${total.toFixed(2)}`;
            cartTotalElement.textContent = totalDisplay;
        }
        
        if (cartCountElement) cartCountElement.textContent = cart.length;
        
        if (checkoutBtn) checkoutBtn.disabled = false;
        
        cartItemsContainer.querySelectorAll('.remove-item-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const itemId = parseInt(e.currentTarget.dataset.itemId); 
                removeFromCart(itemId);
            });
        });
    }

    // --- TOGGLE y Event Listeners del Carrito y Login/Logout ---

    // Función global para abrir/cerrar el carrito
    window.toggleCart = function(forceOpen = false) {
        if (cartSidebar) {
            if (forceOpen) {
                cartSidebar.classList.add('open');
            } else {
                cartSidebar.classList.toggle('open');
            }
        }
    };

    // 1. Lógica del Botón de Login/Usuario (Toggle Dropdown)
    if (toggleLoginBtn && authDropdown) {
        toggleLoginBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            authDropdown.classList.toggle('active');
        });
        
        document.addEventListener('click', (event) => {
            // Si el clic es fuera del dropdown y el dropdown está activo, ciérralo.
            if (authDropdown && !authDropdown.contains(event.target) && authDropdown.classList.contains('active')) {
                authDropdown.classList.remove('active');
            }
        });
    }
    
    // 2. Lógica del Botón de Cerrar Sesión (Logout)
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            // 1. Limpiar la sesión en localStorage
            localStorage.removeItem('userSessionToken');
            localStorage.removeItem('userData');
            
            // 2. Forzar la re-detección y actualización de la UI
            checkUserSessionAndRenderUI();
            
            // 3. Opcional: Cerrar el dropdown después de logout
            if (authDropdown) authDropdown.classList.remove('active');
            
            alert('¡Sesión cerrada con éxito!');
            
            // 4. Redirigir a index si no estamos allí o recargar para resetear el estado
            if (window.location.pathname.includes('index.html') === false) {
                 window.location.href = 'index.html'; 
            } else {
                 // Si estamos en index, recargar para resetear el estado de la página
                 window.location.reload(); 
            }
        });
    }

    // 💡 Hacemos window.logoutUser global para que pueda ser llamada desde refreshWalletBalance en caso de 401
    window.logoutUser = function() {
        localStorage.removeItem('userSessionToken');
        localStorage.removeItem('userData');
        checkUserSessionAndRenderUI();
        if (window.location.pathname.includes('index.html') === false) {
            window.location.href = 'index.html'; 
        } else {
            window.location.reload(); 
        }
    };
    
    // 3. Lógica del Enlace "Mi Cuenta" / "Iniciar Sesión" 
    if (authDisplayLink) {
        authDisplayLink.addEventListener('click', (e) => {
            e.preventDefault(); 
            
            // Verificamos si el usuario está logueado (el texto NO es "Iniciar Sesión")
            const isUserLoggedIn = authDisplayLink.textContent.trim() !== 'Iniciar Sesión';

            if (isUserLoggedIn) {
                // Si el usuario está logueado (muestra su nombre), lo redirigimos a su cuenta/perfil
                if (authDropdown) authDropdown.classList.remove('active'); // Cerramos el dropdown
                // Usamos 'index.html' como página de perfil temporal.
                window.location.href = 'index.html'; 
            } else {
                // Si está deslogueado, lo redirigimos a login.html
                if (authDropdown) authDropdown.classList.remove('active'); // Cerramos el dropdown
                window.location.href = 'login.html'; // ⬅️ REDIRECCIÓN A login.html
            }
        });
    }
    
    // 4. Lógica del Botón de Carrito (Abrir/Cerrar)
    if (cartIcon && closeCartBtn) {
        cartIcon.addEventListener('click', () => { window.toggleCart(); });
        closeCartBtn.addEventListener('click', () => { window.toggleCart(false); });

        // 5. Lógica del Botón de Checkout
        if (checkoutBtn) {
            checkoutBtn.addEventListener('click', () => {
                const cart = getCart();
                if (cart.length > 0) {
                    localStorage.setItem('transactionDetails', JSON.stringify(cart));
                    window.location.href = 'payment.html';
                }
            });
        }
    }
    
    // 6. Integración con el cambio de moneda
    window.addEventListener('currencyChanged', renderCart);
    
    // 7. Tareas de Inicialización al cargar el DOM
    renderCart();
    applySiteConfig();
    
    // 🚨 Inicializar Google Sign-In DESPUÉS de comprobar la sesión
    const isUserLoggedIn = checkUserSessionAndRenderUI(); 
    
    // 🚀 LÓGICA CLAVE AÑADIDA: Refrescar el saldo al cargar la página si está logueado
    if (isUserLoggedIn) { 
        window.refreshWalletBalance(); 
    }
    
    if (!isUserLoggedIn) {
        // Lógica para asegurar que initGoogleSignIn se llame después de que el SDK cargue
        if (document.getElementById('google-login-btn')) {
            const checkGoogleLoad = setInterval(() => {
                if (typeof window.google !== 'undefined') {
                    clearInterval(checkGoogleLoad);
                    initGoogleSignIn();
                }
            }, 100);
        }
    }


    // =========================================================================
    // === MÓDULO: OCULTAR/MOSTRAR HEADER AL HACER SCROLL (SOLO MÓVIL) 📱 ===
    // =========================================================================
    const header = document.querySelector('header');
    if (header) { // Solo si el header existe
        let lastScrollTop = 0;
        // Ancho de pantalla MÁXIMO para activar el comportamiento (768px es el estándar de tablet/móvil)
        const mobileBreakpoint = 768; 
        // Mínimo de scroll que debe pasar antes de ocultar/mostrar (ajustable)
        const scrollThreshold = 50; 

        // 2. Define la función de manejo del scroll
        window.addEventListener('scroll', () => {
            const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
            
            // CLAVE: El comportamiento SÓLO se aplica si el ancho de la ventana es menor o igual al breakpoint.
            if (window.innerWidth <= mobileBreakpoint) {
                
                // Ocultar si hace scroll hacia abajo
                // Y si ha bajado más allá de la altura del header + el umbral (para evitar parpadeos al inicio)
                if (currentScroll > lastScrollTop && currentScroll > header.offsetHeight + scrollThreshold) {
                    header.classList.add('header-hide');
                } 
                // Mostrar si hace scroll hacia arriba
                else if (currentScroll < lastScrollTop) {
                    header.classList.remove('header-hide');
                }
                
                // Siempre mostrar si está muy cerca de la parte superior de la página
                if (currentScroll < scrollThreshold) {
                    header.classList.remove('header-hide');
                }
            } else {
                // En Desktop: Aseguramos que la clase 'header-hide' NUNCA esté activa.
                header.classList.remove('header-hide');
            }
            
            // 3. Actualiza la posición de scroll
            lastScrollTop = currentScroll <= 0 ? 0 : currentScroll; 
        }, { passive: true }); 
    }

});