// load-recharge-packages.js (FINAL: Lectura de ID desde localStorage + Monto Personalizado + Equivalente VES)

// =========================================================================
// === UTILITY: Obtener Google ID desde localStorage ===
// =========================================================================

/**
 * Utilidad para obtener el google_id del usuario desde localStorage.
 * Asume que el objeto 'userData' guardado en localStorage contiene la propiedad 'google_id'.
 * @returns {string|null} El google_id si existe, o null.
 */
function getUserId() {
    const userDataJson = localStorage.getItem('userData');
    if (userDataJson) {
        try {
            const userData = JSON.parse(userDataJson);
            return userData.google_id || null; 
        } catch (e) {
            console.error("Error al parsear userData de localStorage:", e);
            return null;
        }
    }
    return null;
}

// =========================================================================
// === LÓGICA PRINCIPAL DE PAQUETES ===
// =========================================================================

document.addEventListener('DOMContentLoaded', () => {
    const packageGrid = document.getElementById('recharge-package-options-grid');
    const rechargeForm = document.getElementById('recharge-wallet-form');
    const selectButton = document.getElementById('select-package-btn');
    const customAmountInput = document.getElementById('custom-amount-input');
    const customAmountGroup = document.getElementById('custom-amount-group');
    let selectedPackageData = null;
    let isCustomAmountMode = false; // 🆕 Flag para saber si se está usando el monto personalizado

    // 🆕 NUEVO: Se agregaron los paquetes de $1 y $500
    const RECHARGE_PACKAGES = [
        { name: 'Saldo $1 USD', usd: '1.00' },
        { name: 'Saldo $5 USD', usd: '5.00' },
        { name: 'Saldo $10 USD', usd: '10.00' }, 
        { name: 'Saldo $20 USD', usd: '20.00' },
        { name: 'Saldo $50 USD', usd: '50.00' },
        { name: 'Saldo $100 USD', usd: '100.00' },
        { name: 'Saldo $200 USD', usd: '200.00' },
        { name: 'Saldo $500 USD', usd: '500.00' }  // 🆕 Agregado
    ];

    /**
     * 🎯 OBTENER TASA: Obtiene la tasa de cambio del Dólar guardada en la configuración CSS.
     * @returns {number} La tasa de VES/USD. Por defecto 38.00.
     */
    function getExchangeRate() {
        const rootStyle = getComputedStyle(document.documentElement);
        let rate = rootStyle.getPropertyValue('--tasa-dolar')?.trim().replace(/['"]/g, ''); 
        return parseFloat(rate) || 38.00; 
    }

    /**
     * Renders the package options based on the current currency.
     */
    function renderPackages() {
        if (!packageGrid) return;
        
        packageGrid.innerHTML = ''; 
        
        const currentCurrency = window.getCurrentCurrency ? window.getCurrentCurrency() : 'USD'; 
        const exchangeRate = getExchangeRate(); 
        
        RECHARGE_PACKAGES.forEach((pkg) => {
            
            const usdPrice = parseFloat(pkg.usd);
            const calculatedVesPrice = (usdPrice * exchangeRate).toFixed(2);
            
            const priceValue = currentCurrency === 'USD' ? usdPrice.toFixed(2) : calculatedVesPrice;
            const priceSymbol = currentCurrency === 'USD' ? '$' : 'Bs.';
            const price = `${priceSymbol} ${priceValue}`;

            const packageHtml = document.createElement('div');
            packageHtml.className = 'package-option';
            packageHtml.dataset.packageName = pkg.name;
            packageHtml.dataset.priceUsd = pkg.usd;
            packageHtml.dataset.priceVes = calculatedVesPrice; 

            packageHtml.innerHTML = `
                <p class="package-name">${pkg.name.replace('Saldo ', '')}</p>
                <p class="package-price">${price}</p>
            `;
            
            packageGrid.appendChild(packageHtml);
        });

        attachPackageEventListeners();

        if (selectedPackageData && !isCustomAmountMode) {
            const currentSelected = Array.from(packageGrid.children).find(
                opt => opt.dataset.packageName === selectedPackageData.name
            );
            if (currentSelected) {
                currentSelected.classList.add('selected');
                selectButton.disabled = false;
                selectButton.textContent = `Pagar Recarga de ${selectedPackageData.name}`;
            }
        } else if (isCustomAmountMode) {
            // Si estamos en modo personalizado, actualizar el botón con el monto actual
            updateButtonForCustomAmount();
        } else {
             selectButton.disabled = true;
             selectButton.textContent = 'Continuar al Pago';
        }
    }

    /**
     * Attaches click listeners to the dynamically created package options.
     */
    function attachPackageEventListeners() {
        const packageOptions = document.querySelectorAll('.package-option');
        
        packageOptions.forEach(opt => {
            opt.addEventListener('click', function() {
                // 🆕 Si el usuario hace clic en un paquete predefinido, salir del modo personalizado
                isCustomAmountMode = false;
                if (customAmountInput) customAmountInput.value = '';
                if (customAmountGroup) customAmountGroup.classList.remove('active');

                // 1. Deseleccionar todos
                packageOptions.forEach(o => o.classList.remove('selected'));
                
                // 2. Seleccionar el actual
                this.classList.add('selected');
                
                // 3. Actualizar datos seleccionados
                selectedPackageData = {
                    name: this.dataset.packageName,
                    usd: this.dataset.priceUsd,
                    ves: this.dataset.priceVes 
                };
                
                // 4. Habilitar y actualizar el botón
                selectButton.disabled = false;
                selectButton.textContent = `Pagar Recarga de ${selectedPackageData.name}`;
            });
        });
    }

    /**
     * 🆕 ACTUALIZADO: Ahora muestra también el equivalente en VES
     * Ejemplo: "Pagar Recarga de $1.04 (Bs. 39.52)"
     */
    function updateButtonForCustomAmount() {
        if (!customAmountInput || !selectButton) return;
        
        const value = parseFloat(customAmountInput.value);
        
        if (!isNaN(value) && value >= 1) {
            const formattedValue = value.toFixed(2);
            const exchangeRate = getExchangeRate();
            const vesValue = (value * exchangeRate).toFixed(2);
            
            // 🆕 Mostrar USD y su equivalente en VES
            selectButton.disabled = false;
            selectButton.textContent = `Pagar Recarga de $${formattedValue} (Bs. ${vesValue})`;
        } else {
            selectButton.disabled = true;
            selectButton.textContent = 'Continuar al Pago';
        }
    }

    /**
     * 🆕 NUEVA FUNCIÓN: Activa el modo de monto personalizado
     */
    function activateCustomAmountMode() {
        isCustomAmountMode = true;
        
        // Deseleccionar todos los paquetes predefinidos
        document.querySelectorAll('.package-option').forEach(o => o.classList.remove('selected'));
        selectedPackageData = null;
        
        // Marcar el grupo de monto personalizado como activo
        if (customAmountGroup) customAmountGroup.classList.add('active');
        
        // Focus en el input
        if (customAmountInput) customAmountInput.focus();
        
        // Actualizar el botón
        updateButtonForCustomAmount();
    }

    // Escuchar el evento global de cambio de moneda y carga de configuración
    window.addEventListener('currencyChanged', renderPackages); 
    document.addEventListener('siteConfigLoaded', renderPackages, { once: true });

    // 🆕 NUEVO: Listener del input de monto personalizado
    if (customAmountInput) {
        customAmountInput.addEventListener('focus', activateCustomAmountMode);
        customAmountInput.addEventListener('input', () => {
            // Si el usuario escribe algo, activamos el modo personalizado
            if (!isCustomAmountMode) {
                activateCustomAmountMode();
            }
            updateButtonForCustomAmount();
        });
    }
    
    // 🎯 Lógica de Pago Directo al enviar el formulario
    rechargeForm.addEventListener('submit', (e) => { 
        e.preventDefault();

        let finalAmountUSD = null;
        let finalAmountVES = null;
        let finalPackageName = null;

        // 🆕 NUEVO: Si estamos en modo personalizado, validar el input
        if (isCustomAmountMode) {
            const customValue = parseFloat(customAmountInput.value);
            
            if (isNaN(customValue) || customValue < 1) {
                alert('⚠️ Por favor, ingresa un monto válido (mínimo $1.00).');
                customAmountInput.focus();
                return;
            }
            
            const exchangeRate = getExchangeRate();
            
            finalAmountUSD = customValue.toFixed(2);
            finalAmountVES = (customValue * exchangeRate).toFixed(2);
            finalPackageName = `Saldo Personalizado $${finalAmountUSD}`;
            
            // Actualizar selectedPackageData para el flujo
            selectedPackageData = {
                name: finalPackageName,
                usd: finalAmountUSD,
                ves: finalAmountVES
            };
            
        } else {
            // Modo paquete predefinido
            if (!selectedPackageData) {
                alert('Por favor, selecciona un paquete de saldo o ingresa un monto personalizado.');
                return;
            }
        }
        
        // 🟢 PASO 1: Obtener el ID del usuario desde localStorage
        const googleId = getUserId();
        
        if (!googleId) {
            alert('Error: No se encontró la sesión o el ID de usuario. Por favor, inicia sesión para recargar.');
            return;
        }

        // 🟢 PASO 2: Crear el objeto de transacción 
        const transactionItem = {
            id: 'WALLET_RECHARGE_' + Date.now(), 
            game: 'Recarga de Saldo JP STORE',
            playerId: 'N/A', 
            packageName: selectedPackageData.name,
            priceUSD: selectedPackageData.usd, 
            priceVES: selectedPackageData.ves, 
            requiresAssistance: false,
            google_id: googleId 
        };

        // 🟢 PASO 3: Guardar el array de transacción en localStorage
        localStorage.setItem('transactionDetails', JSON.stringify([transactionItem]));

        // 🟢 PASO 4: Redirigir inmediatamente a payment.html para procesar el pago.
        window.location.href = 'payment.html';
    });
});