// load-product-details.js

document.addEventListener('DOMContentLoaded', () => {
    // Estas variables son accesibles por todas las funciones anidadas (closure)
    let selectedPackage = null;
    let currentProductData = null;
    const productContainer = document.getElementById('product-container');
    const rechargeForm = document.getElementById('recharge-form');

    // 1. Funciones de ayuda
    function getSlugFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('slug');
    }

    function handlePackageClick() {
        const packageOptions = document.querySelectorAll('.package-option');
        
        packageOptions.forEach(opt => opt.classList.remove('selected'));
        
        this.classList.add('selected');
        selectedPackage = this;
        
        console.log('Paquete seleccionado:', selectedPackage.dataset.packageName);
    }
    
    function attachPackageEventListeners() {
        const packageOptions = document.querySelectorAll('.package-option');
        
        packageOptions.forEach(option => {
            option.removeEventListener('click', handlePackageClick); 
            option.addEventListener('click', handlePackageClick);
        });
        
        if (packageOptions.length > 0) {
            let shouldSelectDefault = true;
            
            if (selectedPackage && document.body.contains(selectedPackage)) {
                packageOptions.forEach(opt => opt.classList.remove('selected'));
                selectedPackage.classList.add('selected');
                shouldSelectDefault = false;
            } 
            
            if (shouldSelectDefault) {
                packageOptions[0].classList.add('selected');
                selectedPackage = packageOptions[0];
            }
        }
    }

    function renderProductPackages(data, currency) {
        const packageOptionsGrid = document.getElementById('package-options-grid');
        
        if (!packageOptionsGrid) {
            console.error("El contenedor de paquetes (#package-options-grid) no fue encontrado en el HTML.");
            return;
        }
        
        packageOptionsGrid.innerHTML = ''; 

        if (!data.paquetes || data.paquetes.length === 0) {
            packageOptionsGrid.innerHTML = '<p class="empty-message">Aún no hay paquetes de recarga disponibles para este juego.</p>';
            return;
        }

        const currencySymbol = (currency === 'VES') ? 'Bs.' : (currency === 'COP' ? 'COP$' : '$');

        data.paquetes.forEach(pkg => {
            const usdPrice = parseFloat(pkg.precio_usd || 0).toFixed(2);
            const vesPrice = parseFloat(pkg.precio_ves || 0).toFixed(2);
            const jpusdPrice = parseFloat(pkg.precio_usdm || 0).toFixed(2); 
            const copPrice = parseFloat(pkg.precio_cop || 0).toFixed(2);

            let displayPrice;
            if (currency === 'VES') {
                displayPrice = vesPrice;
            } else if (currency === 'JPUSD') {
                displayPrice = jpusdPrice;
            } else if (currency === 'COP') {
                displayPrice = copPrice;
            } else { 
                displayPrice = usdPrice;
            }

            const packageHtml = `
                <div 
                    class="package-option" 
                    data-package-name="${pkg.nombre_paquete}"
                    data-price-usd="${usdPrice}"
                    data-price-ves="${vesPrice}"
                    data-price-jpusd="${jpusdPrice}"
                    data-price-cop="${copPrice}" 
                >
                    <div class="package-name">${pkg.nombre_paquete}</div>
                    <div class="package-price">${currencySymbol} ${displayPrice}</div>
                </div>
            `;
            packageOptionsGrid.insertAdjacentHTML('beforeend', packageHtml);
        });
        
        attachPackageEventListeners();
    }
    
    function updatePackagesUI(currency) {
        if (!currentProductData || !currentProductData.paquetes) return;

        const packageOptionsGrid = document.getElementById('package-options-grid');
        if (!packageOptionsGrid) return; 
        
        const currencySymbol = (currency === 'VES') ? 'Bs.' : (currency === 'COP' ? 'COP$' : '$');

        const packageElements = packageOptionsGrid.querySelectorAll('.package-option');
        packageElements.forEach(element => {
            
            let priceKeyDataset;
            if (currency === 'VES') {
                priceKeyDataset = 'priceVes';
            } else if (currency === 'JPUSD') {
                priceKeyDataset = 'priceJpusd'; 
            } else if (currency === 'COP') {
                priceKeyDataset = 'priceCop';
            } else {
                priceKeyDataset = 'priceUsd';
            }

            const priceVal = parseFloat(element.dataset[priceKeyDataset]);
            const priceFallback = parseFloat(element.dataset.priceUsd);
            
            let finalPrice;
            if (currency === 'COP') {
                finalPrice = priceVal.toFixed(2);
            } else {
                finalPrice = (priceVal > 0) ? priceVal.toFixed(2) : priceFallback.toFixed(2);
            }
            
            element.querySelector('.package-price').textContent = `${currencySymbol} ${finalPrice}`;
        });
    }

    async function loadProductDetails() {
        const slug = getSlugFromUrl();
        if (!slug) {
            if (productContainer) {
                 productContainer.innerHTML = '<h2 class="error-message">❌ Error: No se especificó el juego.</h2><p style="text-align:center;"><a href="index.html">Volver a la página principal</a></p>';
            }
            const pageTitle = document.getElementById('page-title');
            if (pageTitle) pageTitle.textContent = 'Error - JP STORE';
            return;
        }

        try {
            const response = await fetch(`/.netlify/functions/get-product-details?slug=${slug}`);
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Error ${response.status}: ${errorData.message}`);
            }

            const data = await response.json();
            
            if (data) {
                currentProductData = data; 
                
                const pageTitle = document.getElementById('page-title');
                if (pageTitle) pageTitle.textContent = `${data.nombre} - JP STORE`;

                const productName = document.getElementById('product-name');
                if (productName) productName.textContent = data.nombre;

                const productDescription = document.getElementById('product-description');
                if (productDescription) productDescription.textContent = data.descripcion;

                const bannerImage = document.getElementById('product-banner-image');
                if (bannerImage) {
                    bannerImage.src = data.banner_url || 'images/default_banner.jpg';
                    bannerImage.alt = data.nombre;
                }
                
                const playerIdInputGroup = document.getElementById('player-id-input-group');
                const whatsappMessage = document.getElementById('whatsapp-info-message');
                const stepOneTitle = document.getElementById('step-one-title');

                if (playerIdInputGroup && whatsappMessage && stepOneTitle) {
                    if (data.require_id === true) {
                        playerIdInputGroup.style.display = 'block'; 
                        whatsappMessage.style.display = 'none';
                        stepOneTitle.textContent = 'Paso 1: Ingresa tu ID';
                    } else {
                        playerIdInputGroup.style.display = 'none';
                        whatsappMessage.style.display = 'block';
                        stepOneTitle.textContent = 'Paso 1: Asistencia Requerida';
                        const playerIdInput = document.getElementById('player-id-input');
                        if(playerIdInput) playerIdInput.value = '';
                    }
                }

                // 🆕 NUEVO: LÓGICA ESPECIAL PARA FREE FIRE
                // Si es Free Fire, forzamos JPUSD y ocultamos el selector de moneda
                let initialCurrency;
                if (data.es_free_fire === true) {
                    console.log('[FREE FIRE] Detectado. Forzando moneda JPUSD y ocultando selector.');
                    
                    // Forzamos JPUSD en localStorage
                    localStorage.setItem('selectedCurrency', 'JPUSD');
                    initialCurrency = 'JPUSD';
                    
                    // Añadimos la clase al body para ocultar el selector con CSS
                    document.body.classList.add('hide-currency-selector');
                    
                    // Disparamos el evento para que otros scripts (como script.js) actualicen la UI
                    window.dispatchEvent(new CustomEvent('currencyChanged', { detail: { currency: 'JPUSD' } }));
                } else {
                    initialCurrency = localStorage.getItem('selectedCurrency') || 'VES';
                }
                // 🔚 FIN LÓGICA FREE FIRE
                
                renderProductPackages(data, initialCurrency); 

                // Solo escuchamos cambios de moneda si NO es Free Fire
                // (así evitamos que un cambio externo rompa la moneda única de Free Fire)
                if (data.es_free_fire !== true) {
                    window.addEventListener('currencyChanged', (event) => {
                        updatePackagesUI(event.detail.currency);
                    });
                }

            } else {
                if (productContainer) {
                    productContainer.innerHTML = '<h2 class="error-message">❌ Producto no encontrado.</h2><p style="text-align:center;"><a href="index.html">Volver a la página principal</a></p>';
                }
            }

        } catch (error) {
            console.error('Error al cargar detalles del producto:', error);
            if (productContainer) {
                productContainer.innerHTML = '<h2 class="error-message">❌ Error al conectar con el servidor.</h2><p style="text-align:center;">Por favor, recarga la página o vuelve más tarde.</p>';
            }
            const pageTitle = document.getElementById('page-title');
            if (pageTitle) pageTitle.textContent = 'Error de Carga - JP STORE';
        }
    }
    
    // 3. Manejo del envío del formulario
    if (rechargeForm) {
        rechargeForm.addEventListener('submit', (e) => {
            e.preventDefault();

            if (!selectedPackage) {
                alert('Por favor, selecciona un paquete de recarga.');
                return;
            }

            const playerIdInput = document.getElementById('player-id-input');
            const playerId = playerIdInput ? playerIdInput.value.trim() : ''; 

            if (currentProductData && currentProductData.require_id === true) {
                if (!playerId) {
                    alert('Por favor, ingresa tu ID de Jugador. Este campo es obligatorio para este producto.');
                    return;
                }
            }
            
            const packageName = selectedPackage.dataset.packageName;
            const itemPriceUSD = selectedPackage.dataset.priceUsd; 
            const itemPriceVES = selectedPackage.dataset.priceVes; 
            const itemPriceJPUSD = selectedPackage.dataset.priceJpusd; 
            const itemPriceCOP = selectedPackage.dataset.priceCop;
            
            // 🆕 NUEVO: Detectar si es Free Fire con recarga automática
            const isFreeFireAuto = currentProductData && currentProductData.es_free_fire === true && currentProductData.recargas_america_id;
            
            const cartItem = {
                id: Date.now(), 
                game: currentProductData ? currentProductData.nombre : 'Juego Desconocido',
                playerId: playerId, 
                packageName: packageName,
                priceUSD: itemPriceUSD, 
                priceVES: itemPriceVES, 
                priceJPUSD: itemPriceJPUSD,
                priceCOP: itemPriceCOP, 
                requiresAssistance: currentProductData.require_id !== true,
                // 🆕 NUEVO: Datos para la API de Recargas América
                isFreeFireAutoRecharge: isFreeFireAuto,
                recargasAmericaProductId: isFreeFireAuto ? currentProductData.recargas_america_id : null
            };

            if (window.addToCart) {
                window.addToCart(cartItem);
            } else {
                console.error("Función addToCart no encontrada. ¿Está script.js cargado?");
            }

            alert(`✅ ¡Tu recarga de ${packageName} para ${cartItem.game} se ha agregado al carrito!`);
        });
    }

    loadProductDetails();
});