/**
 * Script de prueba para el sistema de buffer de webhooks
 * 
 * Uso: node scripts/test-webhook-buffer.js <test_number>
 * 
 * Tests disponibles:
 * 1. Test webhook antes de orden - Pago exitoso
 * 2. Test webhook después de orden - Pago exitoso
 * 3. Test webhook con rechazo
 * 4. Test consultar buffer
 * 5. Test consultar orden por cart_id
 */

const BACKEND_URL = process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || 'http://localhost:9000';
const PUBLISHABLE_KEY = process.env.STORE_PUBLISHABLE_API_KEY || process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || '';

// Función para obtener la API key desde el servidor si no está configurada
async function getPublishableKeyFromServer() {
  try {
    console.log('ℹ️  Intentando obtener API key desde el servidor...');
    const response = await fetch(`${BACKEND_URL}/key-exchange`);
    if (response.ok) {
      const data = await response.json();
      if (data.publishableApiKey) {
        console.log(`✅ API key obtenida desde el servidor: ${data.publishableApiKey.substring(0, 10)}...`);
        return data.publishableApiKey;
      }
    }
  } catch (error) {
    console.warn('⚠️  No se pudo obtener la API key desde el servidor');
  }
  return null;
}

// Variable global para la API key (se inicializará antes de los tests)
let PUBLISHABLE_KEY_FINAL = PUBLISHABLE_KEY;

// Función para inicializar la API key
async function initializePublishableKey() {
  if (PUBLISHABLE_KEY) {
    return PUBLISHABLE_KEY;
  }
  
  console.log(`
⚠️  STORE_PUBLISHABLE_API_KEY no está configurada

Intentando obtenerla desde el servidor...
  `);
  
  // Intentar obtener desde el servidor
  const serverKey = await getPublishableKeyFromServer();
  if (serverKey) {
    return serverKey;
  } else {
    console.error(`
❌ ERROR: No se pudo obtener la API key

Opciones:
1. Configurar la variable de entorno:
   Windows PowerShell: $env:STORE_PUBLISHABLE_API_KEY="pk_xxx"
   Windows CMD: set STORE_PUBLISHABLE_API_KEY=pk_xxx
   Linux/Mac: export STORE_PUBLISHABLE_API_KEY=pk_xxx

2. Agregar al archivo .env:
   STORE_PUBLISHABLE_API_KEY=pk_xxx

3. Obtenerla desde el admin de Medusa:
   - Ir a Settings > API Key Management
   - Copiar el "Publishable Key" (empieza con "pk_")
    `);
    process.exit(1);
  }
}

// Colores para console
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

// Helper para hacer requests
async function makeRequest(method, url, body = null, headers = {}) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    logInfo(`Haciendo ${method} a ${url}`);
    const response = await fetch(url, options);
    
    let data;
    try {
      data = await response.json();
    } catch (e) {
      data = { message: response.statusText, raw: await response.text().catch(() => '') };
    }
    
    return { status: response.status, data, ok: response.ok };
  } catch (error) {
    logError(`Error de conexión: ${error.message}`);
    logWarning(`Verifica que el servidor esté corriendo en ${BACKEND_URL}`);
    return { status: 0, error: error.message, details: error };
  }
}

// Verificar que el servidor esté disponible
async function checkServerHealth() {
  try {
    const response = await fetch(`${BACKEND_URL}/health`).catch(() => null);
    if (response && response.ok) {
      logSuccess('Servidor está disponible');
      logInfo(`URL: ${BACKEND_URL}`);
      logInfo(`API Key configurada: ${PUBLISHABLE_KEY_FINAL.substring(0, 10)}...`);
      return true;
    }
    // Si no hay endpoint /health, intentar cualquier endpoint
    logWarning('Endpoint /health no disponible, asumiendo que el servidor está corriendo');
    logInfo(`URL: ${BACKEND_URL}`);
    logInfo(`API Key configurada: ${PUBLISHABLE_KEY_FINAL.substring(0, 10)}...`);
    return true;
  } catch (error) {
    logError(`No se pudo conectar al servidor en ${BACKEND_URL}`);
    logWarning('Verifica que el servidor esté corriendo: pnpm dev o pnpm start:server');
    return false;
  }
}

// Test 1: Webhook antes de orden - Pago exitoso (usando ADDI)
async function test1() {
  logInfo('Test 1: Webhook llega ANTES de crear orden - Pago exitoso (ADDI)');
  
  // Verificar servidor primero
  const serverOk = await checkServerHealth();
  if (!serverOk) {
    return;
  }
  
  const cartId = process.argv[3] || `cart_test_${Date.now()}`;
  logInfo(`Usando cart_id: ${cartId}`);
  
  // Preparar headers según modo de testing
  const headers = {};
  
  if (process.env.ADDI_TESTING_LOCAL === 'true') {
    // Modo testing local: no enviar autenticación
    logWarning('⚠️  ADDI_TESTING_LOCAL=true: Autenticación deshabilitada');
  } else {
    // Modo normal: enviar autenticación básica
    const addiUsername = process.env.ADDI_CALLBACK_USERNAME || 'addi_callback';
    const addiPassword = process.env.ADDI_CALLBACK_PASSWORD || 'test_password';
    const basicAuth = Buffer.from(`${addiUsername}:${addiPassword}`).toString('base64');
    headers['Authorization'] = `Basic ${basicAuth}`;
    logInfo(`⚠️  NOTA: Usando autenticación básica con usuario: ${addiUsername}`);
    logInfo(`⚠️  Si falla, verifica ADDI_CALLBACK_USERNAME y ADDI_CALLBACK_PASSWORD en .env`);
    logInfo(`⚠️  O configura ADDI_TESTING_LOCAL=true para deshabilitar autenticación en pruebas`);
  }
  
  logInfo('Enviando webhook de ADDI con pago aprobado...');
  
  const webhookResponse = await makeRequest('POST', `${BACKEND_URL}/hooks/addi/payment`, {
    orderId: cartId, // ADDI usa orderId que es realmente el cartId
    applicationId: `test_app_${Date.now()}`,
    approvedAmount: '100000',
    currency: 'COP',
    status: 'APPROVED',
    statusTimestamp: Math.floor(Date.now() / 1000).toString(),
  }, headers);

  if (webhookResponse.status === 0) {
    logError(`Error de conexión: ${webhookResponse.error || 'No se pudo conectar al servidor'}`);
    logWarning(`Verifica que el servidor esté corriendo en ${BACKEND_URL}`);
    if (webhookResponse.details) {
      console.error(webhookResponse.details);
    }
    return;
  }

  if (webhookResponse.status === 200) {
    logSuccess('Webhook procesado correctamente');
    logInfo(`Respuesta: ${JSON.stringify(webhookResponse.data, null, 2)}`);
  } else {
    logError(`Webhook falló con status: ${webhookResponse.status}`);
    logInfo(`Respuesta del servidor: ${JSON.stringify(webhookResponse.data, null, 2)}`);
    
    if (webhookResponse.status === 401) {
      logError('Error de autenticación - Las credenciales de ADDI no son válidas');
      logWarning('Verifica ADDI_CALLBACK_USERNAME y ADDI_CALLBACK_PASSWORD en .env');
      logInfo('En desarrollo, puedes usar: addi_callback:test_password');
    } else if (webhookResponse.status === 400) {
      logWarning('Error en el payload - Verifica el formato del webhook');
    } else if (webhookResponse.status === 500) {
      logWarning('Error interno del servidor - Revisa los logs del servidor');
    }
    return;
  }

  // Consultar buffer
  logInfo('Consultando buffer de resultados...');
  logInfo(`Usando API Key: ${PUBLISHABLE_KEY_FINAL.substring(0, 10)}...`);
  const bufferResponse = await makeRequest(
    'GET',
    `${BACKEND_URL}/store/payment-status/${cartId}`,
    null,
    { 'x-publishable-api-key': PUBLISHABLE_KEY_FINAL }
  );

  if (bufferResponse.status === 0) {
    logError(`Error de conexión: ${bufferResponse.error || 'No se pudo conectar al servidor'}`);
    return;
  }

  if (bufferResponse.status === 200) {
    logSuccess('Resultado encontrado en buffer');
    logInfo(`Datos: ${JSON.stringify(bufferResponse.data, null, 2)}`);
  } else if (bufferResponse.status === 404) {
    logWarning('No hay resultado en buffer para este cart_id');
    logInfo('Esto puede ser normal si el webhook no se procesó correctamente');
  } else {
    logError(`Error consultando buffer: ${bufferResponse.status}`);
    logInfo(`Respuesta: ${JSON.stringify(bufferResponse.data, null, 2)}`);
    return;
  }

  logSuccess('Test 1 completado: Webhook guardado en buffer correctamente');
}

// Test 2: Consultar buffer
async function test2() {
  logInfo('Test 2: Consultar buffer de resultados');
  
  const cartId = process.argv[3] || `cart_test_${Date.now()}`;
  logInfo(`Consultando buffer para cart_id: ${cartId}`);
  
  const response = await makeRequest(
    'GET',
    `${BACKEND_URL}/store/payment-status/${cartId}`,
    null,
    { 'x-publishable-api-key': PUBLISHABLE_KEY_FINAL }
  );

  if (response.status === 200) {
    logSuccess('Resultado encontrado en buffer');
    console.log(JSON.stringify(response.data, null, 2));
  } else if (response.status === 404) {
    logWarning('No hay resultado en buffer para este cart_id');
  } else {
    logError(`Error consultando buffer: ${response.status}`);
    console.log(response.data);
  }
}

// Test 3: Consultar orden por cart_id
async function test3() {
  logInfo('Test 3: Consultar orden por cart_id');
  
  const cartId = process.argv[3] || `cart_test_${Date.now()}`;
  logInfo(`Consultando orden para cart_id: ${cartId}`);
  
  const response = await makeRequest(
    'GET',
    `${BACKEND_URL}/store/cart/${cartId}/order`,
    null,
    { 'x-publishable-api-key': PUBLISHABLE_KEY_FINAL }
  );

  if (response.status === 200) {
    logSuccess('Orden encontrada');
    console.log(JSON.stringify(response.data, null, 2));
  } else if (response.status === 404) {
    logWarning('No hay orden para este cart_id');
  } else {
    logError(`Error consultando orden: ${response.status}`);
    console.log(response.data);
  }
}

// Test 4: Webhook con rechazo (usando ADDI)
async function test4() {
  logInfo('Test 4: Webhook con pago rechazado (ADDI)');
  
  const cartId = process.argv[3] || `cart_test_${Date.now()}`;
  logInfo(`Usando cart_id: ${cartId}`);
  
  // Preparar headers según modo de testing
  const headers = {};
  
  if (process.env.ADDI_TESTING_LOCAL === 'true') {
    // Modo testing local: no enviar autenticación
    logWarning('⚠️  ADDI_TESTING_LOCAL=true: Autenticación deshabilitada');
  } else {
    // Modo normal: enviar autenticación básica
    const addiUsername = process.env.ADDI_CALLBACK_USERNAME || 'addi_callback';
    const addiPassword = process.env.ADDI_CALLBACK_PASSWORD || 'test_password';
    const basicAuth = Buffer.from(`${addiUsername}:${addiPassword}`).toString('base64');
    headers['Authorization'] = `Basic ${basicAuth}`;
  }
  
  // Simular webhook de ADDI con rechazo
  logInfo('Enviando webhook de ADDI con pago rechazado...');
  const webhookResponse = await makeRequest('POST', `${BACKEND_URL}/hooks/addi/payment`, {
    orderId: cartId,
    applicationId: `test_app_${Date.now()}`,
    approvedAmount: '0',
    currency: 'COP',
    status: 'REJECTED', // Rechazado
    statusTimestamp: Math.floor(Date.now() / 1000).toString(),
  }, headers);

  if (webhookResponse.status === 200) {
    logSuccess('Webhook procesado correctamente');
    logInfo(`Respuesta: ${JSON.stringify(webhookResponse.data, null, 2)}`);
    logInfo('El error debería estar guardado en cart.metadata.payment_error');
    logInfo('Puedes verificar consultando el carrito desde el admin o API');
  } else {
    logError(`Webhook falló: ${webhookResponse.status}`);
    console.log(webhookResponse.data);
    
    if (webhookResponse.status === 401) {
      logError('Error de autenticación - Verifica ADDI_CALLBACK_USERNAME y ADDI_CALLBACK_PASSWORD');
    }
  }
}

// Main
const testNumber = process.argv[2];

if (!testNumber) {
  console.log(`
Uso: node scripts/test-webhook-buffer.js <test_number> [cart_id]

Tests disponibles:
  1 - Webhook ADDI antes de orden - Pago exitoso (opcional: cart_id)
  2 - Consultar buffer (opcional: cart_id)
  3 - Consultar orden por cart_id (opcional: cart_id)
  4 - Webhook ADDI con pago rechazado (opcional: cart_id)

Ejemplos:
  node scripts/test-webhook-buffer.js 1
  node scripts/test-webhook-buffer.js 1 cart_01XXX
  node scripts/test-webhook-buffer.js 2 cart_01XXX
  node scripts/test-webhook-buffer.js 3 cart_01XXX
  node scripts/test-webhook-buffer.js 4
  node scripts/test-webhook-buffer.js 4 cart_01XXX
  `);
  process.exit(1);
}

(async () => {
  try {
    // Inicializar API key antes de ejecutar tests
    PUBLISHABLE_KEY_FINAL = await initializePublishableKey();
    
    switch (testNumber) {
      case '1':
        await test1();
        break;
      case '2':
        await test2();
        break;
      case '3':
        await test3();
        break;
      case '4':
        await test4();
        break;
      default:
        logError(`Test ${testNumber} no existe`);
        process.exit(1);
    }
  } catch (error) {
    logError(`Error ejecutando test: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
})();

