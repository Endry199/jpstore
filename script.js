// script.js COMPLETO Y MODIFICADO (Versión Final con Soporte JPUSD Separado y Refresco de Saldo)

// 🎯 FUNCIÓN PARA CARGAR Y APLICAR LA CONFIGURACIÓN DE COLORES
async function applySiteConfig() {
    try {
        const response = await fetch('/.netlify/functions/get-site-config');
        
        if (!response.ok) {
            throw new Error(`Error ${response.status}: No se pudo cargar la configuración del sitio.`);
        }

        const config = await response.json();
        
        for (const [key, value] of Object.entries(config)) {
            if (value && key.startsWith('--')) {
                document.documentElement.style.setProperty(key, value);
            }
        }
        
        document.dispatchEvent(new CustomEvent('siteConfigLoaded')); 
        
    } catch (error) {
        console.error('[CLIENTE] Error al aplicar configuración de colores:', error.message);
    }
}


// =================================================================
// === MÓDULO DE AUTENTICACIÓN: GOOGLE SIGN-IN & SESIÓN ===
// =================================================================

const GOOGLE_CLIENT_ID = '308840006976-mttmu0hd65scpg9umpgk4tt2qnrgn07d.apps.googleusercontent.com'; 

function checkUserSessionAndRenderUI() {
    const sessionToken = localStorage.getItem('userSessionToken');
    const userDataJson = localStorage.getItem('userData');
    const isLoggedIn = sessionToken && userDataJson;
    
    const walletContainer = document.getElementById('wallet-container'); 
    const virtualBalanceElement = document.getElementById('virtual-balance'); 

    const toggleLoginBtn = document.getElementById('toggle-login-btn');
    const authDisplayName = document.getElementById('auth-display-name'); 
    const authUserPicture = document.getElementById('auth-user-picture');
    const googleLoginBtnContainer = document.getElementById('google-login-btn');
    const logoutBtn = document.getElementById('logout-btn');

    const genericIcon = toggleLoginBtn ? toggleLoginBtn.querySelector('.fas.fa-user-circle') : null;
    
    if (isLoggedIn) {
        const userData = JSON.parse(userDataJson);
        const userName = userData.name || userData.email || 'Mi Cuenta'; 

        if (toggleLoginBtn) {
            if (authUserPicture) {
                authUserPicture.src = userData.picture || 'images/default_user.png';
                authUserPicture.style.display = 'block';
            }
            
            if (genericIcon) genericIcon.style.display = 'none';

            if (authDisplayName) {
                authDisplayName.textContent = userName;
            }
            
            if (logoutBtn) logoutBtn.style.display = 'block';
            if (googleLoginBtnContainer) googleLoginBtnContainer.style.display = 'none';
        }
        
        if (walletContainer && virtualBalanceElement) {
            const balance = userData.balance || '0.00'; 
            virtualBalanceElement.textContent = `$. ${balance}`;
            walletContainer.style.display = 'flex';
        }


    } else {
        if (toggleLoginBtn) {
            if (genericIcon) genericIcon.style.display = 'block';
            
            if (authUserPicture) {
                authUserPicture.style.display = 'none';
            }
        }
        
        if (authDisplayName) authDisplayName.textContent = 'Iniciar Sesión';
        
        if (logoutBtn) logoutBtn.style.display = 'none';

        if (walletContainer) {
            walletContainer.style.display = 'none';
        }
    }
    
    return isLoggedIn;
}

window.handleCredentialResponse = async (response) => {
    const idToken = response.credential;
    
    const loginBtnContainer = document.getElementById('google-login-btn');
    if (loginBtnContainer) {
        loginBtnContainer.innerHTML = '<p style="color:var(--text-color); margin: 0; text-align: center;">Iniciando sesión...</p>';
    }

    try {
        const serverResponse = await fetch('/.netlify/functions/process-google-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: idToken }),
        });

        if (serverResponse.ok) {
            const data = await serverResponse.json();
            
            localStorage.setItem('userSessionToken', data.sessionToken);
            localStorage.setItem('userData', JSON.stringify(data.user)); 
            
            const redirectUrl = localStorage.getItem('redirectAfterLogin');
            const finalRedirect = redirectUrl || 'index.html';

            if (redirectUrl) {
                localStorage.removeItem('redirectAfterLogin');
                console.log(`Redirigiendo de vuelta a: ${finalRedirect}`);
            }

            const userName = data.user.name || 'Usuario';
            
            setTimeout(() => {
                    alert(`¡Bienvenido(a), ${userName}! Has iniciado sesión correctamente.`);
                    window.location.href = finalRedirect; 
            }, 50);

        } else {
            const errorData = await serverResponse.json();
            alert(`Error al iniciar sesión: ${errorData.message || 'Token inválido o error del servidor.'}`);
            console.error("Error del servidor en el login:", errorData);
            
            if (window.google && window.google.accounts && window.google.accounts.id) {
                    initGoogleSignIn(true);
            }
        }

    } catch (error) {
        alert('Hubo un problema de conexión con el servidor. Inténtalo de nuevo.');
        console.error("Error de red/cliente:", error);
    }
};

function initGoogleSignIn(forceRender = false) {
    const loginButtonElement = document.getElementById('google-login-btn');
    
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


window.getCurrentCurrency = function() {
    return localStorage.getItem('selectedCurrency') || 'VES'; 
};


// =========================================================================
// === NUEVA FUNCIÓN CLAVE: Refresco de Saldo de Billetera ===
// =========================================================================

async function refreshWalletBalance() {
    const userDataJson = localStorage.getItem('userData');
    const userSessionToken = localStorage.getItem('userSessionToken');
    
    if (!userDataJson || !userSessionToken) {
        console.log("[Wallet] No hay usuario logueado o token. Cancelando refresh.");
        return;
    }

    try {
        console.log("[Wallet] Enviando solicitud de saldo con token de sesión...");
        
        const response = await fetch('/.netlify/functions/get-user-balance', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${userSessionToken}`,
                'Content-Type': 'application/json' 
            }
        }); 

        if (response.status === 401) {
            console.error("[Wallet] Error 401: El token de sesión fue rechazado por el servidor. Forzando cierre de sesión.");
            window.logoutUser(); 
            return;
        }

        if (!response.ok) {
            throw new Error(`Error ${response.status}: No se pudo obtener el saldo.`);
        }

        const data = await response.json();
        
        const newBalance = data.saldo || '0.00';
        
        const userData = JSON.parse(userDataJson);
        userData.balance = parseFloat(newBalance).toFixed(2); 
        localStorage.setItem('userData', JSON.stringify(userData));

        const virtualBalanceElement = document.getElementById('virtual-balance'); 
        if (virtualBalanceElement) {
            virtualBalanceElement.textContent = `$. ${userData.balance}`;
        }
        
        console.log(`[Wallet] Saldo actualizado a: $.${userData.balance}`);
        
    } catch (error) {
        console.error("Error al refrescar el saldo de la billetera:", error);
    }
}
window.refreshWalletBalance = refreshWalletBalance; 


document.addEventListener('DOMContentLoaded', () => {
    // ---- Lógica para el nuevo selector de moneda personalizado ----
    const customCurrencySelector = document.getElementById('custom-currency-selector');
    const selectedCurrencyDisplay = document.getElementById('selected-currency');
    const currencyOptionsDiv = document.getElementById('currency-options');
    const currencyOptions = currencyOptionsDiv ? currencyOptionsDiv.querySelectorAll('.option') : []; 

    function updateCurrencyDisplay(value, text, imgSrc) {
        if (selectedCurrencyDisplay) { 
            selectedCurrencyDisplay.innerHTML = `<img src="${imgSrc}" alt="${text.split(' ')[2] ? text.split(' ')[2].replace(/[()]/g, '') : 'Flag'}"> <span>${text}</span> <i class="fas fa-chevron-down"></i>`;
        }
        const prevCurrency = localStorage.getItem('selectedCurrency');
        localStorage.setItem('selectedCurrency', value);
        
        if (prevCurrency !== value) {
             window.dispatchEvent(new CustomEvent('currencyChanged', { detail: { currency: value } }));
        }
    }

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

    if (selectedCurrencyDisplay) { 
        selectedCurrencyDisplay.addEventListener('click', (event) => {
            event.stopPropagation(); 
            if (customCurrencySelector) { 
                customCurrencySelector.classList.toggle('show'); 
            }
        });
    }

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

    const authDropdown = document.getElementById('auth-dropdown');
    const toggleLoginBtn = document.getElementById('toggle-login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const authDisplayLink = document.getElementById('auth-display-name');


    function getCart() {
        const cart = localStorage.getItem('cartItems');
        return cart ? JSON.parse(cart) : [];
    }

    function saveCart(cart) {
        localStorage.setItem('cartItems', JSON.stringify(cart));
    }

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

    function renderCart() {
        const cart = getCart();
        if (!cartItemsContainer) return; 
        
        cartItemsContainer.innerHTML = ''; 
        let total = 0;
        const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
        const currencySymbol = selectedCurrency === 'VES' ? 'Bs.S' : '$';

        if (cart.length === 0) {
            cartItemsContainer.innerHTML = '<p class="empty-cart-message">Tu carrito está vacío.</p>';
            if (cartTotalElement) cartTotalElement.textContent = `${currencySymbol}0.00`;
            if (cartCountElement) cartCountElement.textContent = '0';
            if (checkoutBtn) checkoutBtn.disabled = true;
            return;
        }

        cart.forEach(item => {
            // 🆕 NUEVO: Si es Free Fire con recarga automática, SIEMPRE usa JPUSD
            let price;
            
            if (item.isFreeFireAutoRecharge) {
                // Free Fire siempre usa JPUSD (el precio base sin recargo)
                price = parseFloat(item.priceJPUSD || 0);
            } else if (selectedCurrency === 'VES') {
                price = parseFloat(item.priceVES || 0);
            } else if (selectedCurrency === 'JPUSD') {
                price = parseFloat(item.priceJPUSD || 0); 
            } else if (selectedCurrency === 'COP') {
                price = parseFloat(item.priceCOP || item.priceUSD || 0);
            } else {
                price = parseFloat(item.priceUSD || 0);
            }
            
            total += price;
            
            // 🆕 NUEVO: Símbolo de moneda para Free Fire siempre es $
            const itemCurrencySymbol = item.isFreeFireAutoRecharge ? '$' : currencySymbol;
            const priceDisplay = `${itemCurrencySymbol}${price.toFixed(2)}`;
            
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

    window.toggleCart = function(forceOpen = false) {
        if (cartSidebar) {
            if (forceOpen) {
                cartSidebar.classList.add('open');
            } else {
                cartSidebar.classList.toggle('open');
            }
        }
    };

    if (toggleLoginBtn && authDropdown) {
        toggleLoginBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            authDropdown.classList.toggle('active');
        });
        
        document.addEventListener('click', (event) => {
            if (authDropdown && !authDropdown.contains(event.target) && authDropdown.classList.contains('active')) {
                authDropdown.classList.remove('active');
            }
        });
    }
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('userSessionToken');
            localStorage.removeItem('userData');
            
            checkUserSessionAndRenderUI();
            
            if (authDropdown) authDropdown.classList.remove('active');
            
            alert('¡Sesión cerrada con éxito!');
            
            if (window.location.pathname.includes('index.html') === false) {
                 window.location.href = 'index.html'; 
            } else {
                 window.location.reload(); 
            }
        });
    }

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
    
    if (authDisplayLink) {
        authDisplayLink.addEventListener('click', (e) => {
            e.preventDefault(); 
            
            const isUserLoggedIn = authDisplayLink.textContent.trim() !== 'Iniciar Sesión';

            if (isUserLoggedIn) {
                if (authDropdown) authDropdown.classList.remove('active');
                window.location.href = 'index.html'; 
            } else {
                if (authDropdown) authDropdown.classList.remove('active');
                window.location.href = 'login.html';
            }
        });
    }
    
    if (cartIcon && closeCartBtn) {
        cartIcon.addEventListener('click', () => { window.toggleCart(); });
        closeCartBtn.addEventListener('click', () => { window.toggleCart(false); });

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
    
    window.addEventListener('currencyChanged', renderCart);
    
    renderCart();
    applySiteConfig();
    
    const isUserLoggedIn = checkUserSessionAndRenderUI(); 
    
    if (isUserLoggedIn) { 
        window.refreshWalletBalance(); 
    }
    
    if (!isUserLoggedIn) {
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
    if (header) {
        let lastScrollTop = 0;
        const mobileBreakpoint = 768; 
        const scrollThreshold = 50; 

        window.addEventListener('scroll', () => {
            const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
            
            if (window.innerWidth <= mobileBreakpoint) {
                
                if (currentScroll > lastScrollTop && currentScroll > header.offsetHeight + scrollThreshold) {
                    header.classList.add('header-hide');
                } 
                else if (currentScroll < lastScrollTop) {
                    header.classList.remove('header-hide');
                }
                
                if (currentScroll < scrollThreshold) {
                    header.classList.remove('header-hide');
                }
            } else {
                header.classList.remove('header-hide');
            }
            
            lastScrollTop = currentScroll <= 0 ? 0 : currentScroll; 
        }, { passive: true }); 
    }

});