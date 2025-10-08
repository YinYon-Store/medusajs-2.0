/**
 * Genera hash SHA-256 para Wompi usando Web Crypto API
 * @param {string} orderId - ID de la orden
 * @param {string} amount - Monto en centavos
 * @param {string} currency - Moneda (default: COP)
 * @param {string} integrity - Clave de integridad
 * @returns {Promise<string>} Hash SHA-256 en hexadecimal
 */
async function generateWompiHash(orderId, amount, currency = "COP", integrity) {
    const concatenatedData = orderId + amount + currency + integrity;
    const encodedText = new TextEncoder().encode(concatenatedData);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encodedText);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    return hashHex;
}

/**
 * Genera hash SHA-256 para eventos de Wompi
 * @param {string} concatenatedData - Datos concatenados (propiedades + timestamp + secreto)
 * @returns {Promise<string>} Hash SHA-256 en hexadecimal
 */
async function generateWompiEventHash(transactionId, status, amount, timestamp, eventSecret) {
    // Concatenar según documentación de Wompi: propiedades + timestamp + secreto
    const concatenatedData = transactionId + status + amount + timestamp + eventSecret;
    const encodedText = new TextEncoder().encode(concatenatedData);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encodedText);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();

    return hashHex;
}

module.exports = {
    generateWompiHash,
    generateWompiEventHash
};
