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

/**
 * Valida la firma del webhook de Bold usando HMAC-SHA256
 * @param {string} rawBody - Cuerpo crudo de la petición como string
 * @param {string} receivedSignature - Firma recibida en el header x-bold-signature
 * @param {string} secretKey - Llave secreta de Bold
 * @returns {boolean} - true si la firma es válida, false si no
 */
function validateBoldWebhookSignature(rawBody, receivedSignature, secretKey) {
    try {
        if (!rawBody || !receivedSignature || !secretKey) {
            return false;
        }

        // 1. Convertir el cuerpo a Base64
        const encodedBody = Buffer.from(rawBody, 'utf-8').toString('base64');

        // 2. Cifrar el Base64 usando HMAC-SHA256 con la secret key
        // Usar el módulo crypto de Node.js para mejor compatibilidad
        const crypto = require('crypto');
        const calculatedSignature = crypto
            .createHmac('sha256', secretKey)
            .update(encodedBody)
            .digest('hex');

        // 3. Comparar con la firma recibida (usando timing-safe comparison)
        const receivedBuffer = Buffer.from(receivedSignature, 'hex');
        const calculatedBuffer = Buffer.from(calculatedSignature, 'hex');

        // Comparación segura contra timing attacks usando crypto.timingSafeEqual
        if (receivedBuffer.length !== calculatedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(receivedBuffer, calculatedBuffer);
    } catch (error) {
        console.error("Error validando firma de Bold:", error);
        return false;
    }
}

module.exports = {
    generateBoldHash,
    generateBoldEventHash,
    validateBoldWebhookSignature
};
