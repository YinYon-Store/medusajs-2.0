/**
 * Genera hash SHA-256 para Bold usando Web Crypto API
 * @param {string} orderId - ID de la orden
 * @param {string} amount - Monto en centavos
 * @param {string} currency - Moneda (default: COP)
 * @param {string} integrity - Clave de integridad
 * @returns {Promise<string>} Hash SHA-256 en hexadecimal
 */
async function generateBoldHash(orderId, amount, currency = "COP", integrity) {
    const concatenatedData = orderId + amount + currency + integrity;
    console.log("concatenatedData", concatenatedData);
    const encodedText = new TextEncoder().encode(concatenatedData);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encodedText);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    return hashHex;
}

/**
 * Genera hash SHA-256 para eventos de Bold
 * @param {string} concatenatedData - Datos concatenados (propiedades + timestamp + secreto)
 * @returns {Promise<string>} Hash SHA-256 en hexadecimal
 */
async function generateBoldEventHash(transactionId, status, amount, timestamp, eventSecret) {
    // Concatenar según documentación de Bold: propiedades + timestamp + secreto
    // Asumimos la misma lógica que Wompi por instrucción del usuario
    const concatenatedData = transactionId + status + amount + timestamp + eventSecret;
    const encodedText = new TextEncoder().encode(concatenatedData);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encodedText);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();

    return hashHex;
}

module.exports = {
    generateBoldHash,
    generateBoldEventHash
};
