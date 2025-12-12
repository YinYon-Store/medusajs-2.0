# Solución Mejorada: Manejo de Webhooks de Pago en Checkout

## 📋 Contexto del Problema

### Flujo Actual
1. Usuario crea carrito al agregar items
2. Usuario procede al checkout
3. Usuario lanza pasarela de pagos
4. Usuario vuelve de pasarela con status `approved` o `failed`
5. Se crea la orden
6. Backend recibe callback de la pasarela de pagos
7. La orden pasa a estado "pago capturado" si el pago fue exitoso

### Problema Identificado
El callback de la pasarela de pagos puede llegar **antes** de que se cree la orden, ignorando el primer intento de notificación. La pasarela realizará reintentos durante 24 horas, pero queremos aprovechar el primer callback para obtener el resultado lo antes posible.

---

## 🎯 Objetivo

Aprovechar el primer callback de la pasarela de pagos para obtener el resultado de la transacción lo antes posible, mejorando la experiencia del usuario y reduciendo la latencia en la confirmación de pagos.

---

## 🏗️ Arquitectura de la Solución

### Componentes Principales

1. **Buffer Temporal de Resultados de Pago**
   - Almacena resultados de webhooks cuando no existe orden aún
   - Clave: `cart_id`
   - TTL: 30 minutos
   - Formato: Redis o tabla en base de datos

2. **Endpoints Backend Nuevos/Modificados**
   - `GET /store/cart/{cart_id}/order` - Consultar orden por cart_id
   - `GET /store/payment-status/{cart_id}` - Consultar resultado pendiente
   - `POST /store/webhook/payment/{provider}` - Handler mejorado de webhooks

3. **Lógica Frontend Mejorada**
   - Consulta de orden asociada al carrito
   - Polling inteligente antes de crear orden
   - Manejo de estados de pago pendiente
   - UI para mostrar errores de pago

---

## 📐 Flujo Detallado de la Solución

### Escenario A: Webhook Llega ANTES de Crear Orden

#### A.1. Pago Exitoso

```
┌─────────────────┐
│  Webhook llega  │
│  (pago exitoso) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│ Backend: Buscar orden       │
│ por cart_id                 │
└────────┬────────────────────┘
         │
         ├─ Orden NO existe
         │  │
         │  ▼
         │  ┌──────────────────────────────┐
         │  │ Guardar en buffer temporal:   │
         │  │ - cart_id                    │
         │  │ - payment_result (success)   │
         │  │ - transaction_id             │
         │  │ - timestamp                  │
         │  │ - provider                   │
         │  └──────────┬───────────────────┘
         │             │
         │             ▼
         │  ┌──────────────────────────────┐
         │  │ Marcar como                  │
         │  │ pending_order_creation       │
         │  └──────────────────────────────┘
         │
         └─ Orden SÍ existe
            │
            ▼
         ┌──────────────────────────────┐
         │ Capturar pago directamente   │
         │ Actualizar estado de orden   │
         └──────────────────────────────┘
```

**Frontend al volver de pasarela:**

```
┌─────────────────────────────┐
│ Usuario vuelve de pasarela  │
└────────────┬────────────────┘
             │
             ▼
┌──────────────────────────────┐
│ Consultar: GET               │
│ /store/cart/{cart_id}/order  │
└────────────┬─────────────────┘
             │
             ├─ Orden existe
             │  │
             │  ▼
             │  ┌──────────────────────────────┐
             │  │ Verificar payment_status      │
             │  └────────┬─────────────────────┘
             │           │
             │           ├─ captured
             │           │  │
             │           │  ▼
             │           │  Redirigir a:
             │           │  /order/confirmed/{order_id}
             │           │  Mensaje: "Pago exitoso"
             │           │
             │           └─ pending/authorized
             │              │
             │              ▼
             │           Redirigir a:
             │           /order/confirmed/{order_id}
             │           Mensaje: "Procesando pago"
             │           + Iniciar polling
             │
             └─ Orden NO existe
                │
                ▼
             ┌──────────────────────────────┐
             │ Consultar buffer:            │
             │ GET /store/payment-status/   │
             │ {cart_id}                    │
             └────────────┬─────────────────┘
                          │
                          ├─ Hay resultado exitoso
                          │  │
                          │  ▼
                          │  ┌──────────────────────────────┐
                          │  │ Llamar placeOrder()          │
                          │  │                              │
                          │  │ Backend al crear orden:      │
                          │  │ 1. Verificar buffer          │
                          │  │ 2. Si hay resultado:        │
                          │  │    - Capturar pago           │
                          │  │    - Limpiar buffer          │
                          │  │ 3. Retornar orden            │
                          │  └────────┬─────────────────────┘
                          │            │
                          │            ▼
                          │  Redirigir a:
                          │  /order/confirmed/{order_id}
                          │  Mensaje: "Pago exitoso"
                          │
                          └─ No hay resultado
                             │
                             ▼
                          Ir a Escenario B
```

#### A.2. Pago Rechazado

```
┌─────────────────┐
│  Webhook llega  │
│  (pago rechazado)│
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│ Backend: Buscar orden       │
│ por cart_id                 │
└────────┬────────────────────┘
         │
         ├─ Orden NO existe
         │  │
         │  ▼
         │  ┌──────────────────────────────┐
         │  │ Guardar en metadata del      │
         │  │ carrito:                      │
         │  │ {                             │
         │  │   "payment_error": {          │
         │  │     "status": "rejected",    │
         │  │     "provider": "wompi",     │
         │  │     "message": "...",        │
         │  │     "transaction_id": "...",  │
         │  │     "timestamp": "..."        │
         │  │   }                           │
         │  │ }                             │
         │  └──────────────────────────────┘
         │
         └─ Orden SÍ existe
            │
            ▼
         ┌──────────────────────────────┐
         │ Actualizar orden:             │
         │ - payment_status: failed      │
         │ - metadata con error          │
         └──────────────────────────────┘
```

**Frontend en checkout:**

```
┌─────────────────────────────┐
│ Usuario en checkout         │
└────────────┬────────────────┘
             │
             ▼
┌──────────────────────────────┐
│ Al cargar componente Review:  │
│ Leer cart.metadata.payment_  │
│ error                         │
└────────────┬─────────────────┘
             │
             ├─ Existe error
             │  │
             │  ▼
             │  ┌──────────────────────────────┐
             │  │ Mostrar error en sección     │
             │  │ de pagos:                    │
             │  │ - Mensaje de rechazo         │
             │  │ - Bloquear "Completar orden" │
             │  │ - Botón "Intentar otro método"│
             │  │ - Botón "Contactar WhatsApp" │
             │  └──────────────────────────────┘
             │
             └─ No hay error
                │
                ▼
             Flujo normal
```

---

### Escenario B: Webhook AÚN NO Llega

```
┌─────────────────────────────┐
│ Usuario vuelve de pasarela  │
└────────────┬────────────────┘
             │
             ▼
┌──────────────────────────────┐
│ 1. Esperar 2 segundos        │
│    (dar tiempo al webhook)   │
└────────────┬─────────────────┘
             │
             ▼
┌──────────────────────────────┐
│ 2. Consultar buffer:         │
│ GET /store/payment-status/   │
│ {cart_id}                    │
└────────────┬─────────────────┘
             │
             ├─ Hay resultado
             │  │
             │  ▼
             │  Ir a Escenario A.1
             │
             └─ No hay resultado
                │
                ▼ 
┌──────────────────────────────┐
│ 3. Esperar adicional 5-8s   │
│    (polling cada 2s)         │
└────────────┬─────────────────┘
             │
             ├─ Llegó resultado
             │  │
             │  ▼
             │  Ir a Escenario A.1
             │
             └─ No llegó después de timeout
                │
                ▼
┌──────────────────────────────┐
│ 4. Crear orden con estado:   │
│    "awaiting_payment"        │
└────────────┬─────────────────┘
             │
             ▼
┌──────────────────────────────┐
│ 5. Redirigir a:              │
│ /order/confirmed/{order_id}  │
│ ?status=processing_payment    │
└────────────┬─────────────────┘
             │
             ▼
┌──────────────────────────────┐
│ 6. Mostrar mensaje:          │
│ "Orden creada. Procesando    │
│  tu pago, esto puede tardar  │
│  unos minutos"               │
└────────────┬─────────────────┘
             │
             ▼
┌──────────────────────────────┐
│ 7. Iniciar polling cada 3s:  │
│    - GET /store/order/{id}    │
│    - Verificar payment_status │
│    - Si captured: actualizar │
│    - Si >5min: mostrar ayuda │
└──────────────────────────────┘
```

---

## 🔧 Especificación Técnica Backend

### 1. Buffer Temporal de Resultados

#### Estructura de Datos

**Opción A: Redis (Recomendado)**
```json
{
  "key": "payment_result:cart_01XXX",
  "value": {
    "cart_id": "cart_01XXX",
    "status": "approved" | "rejected" | "failed",
    "transaction_id": "txn_123456",
    "provider": "wompi" | "bold" | "addi",
    "amount": 100000,
    "currency": "COP",
    "metadata": {},
    "timestamp": "2024-01-01T00:00:00Z",
    "webhook_received_at": "2024-01-01T00:00:00Z"
  },
  "ttl": 1800 // 30 minutos en segundos
}
```

**Opción B: Tabla SQL**
```sql
CREATE TABLE pending_payment_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) NOT NULL, -- 'approved', 'rejected', 'failed'
  transaction_id VARCHAR(255) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  amount INTEGER,
  currency VARCHAR(10),
  metadata JSONB,
  webhook_received_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  INDEX idx_cart_id (cart_id),
  INDEX idx_expires_at (expires_at)
);
```

#### Operaciones del Buffer

**Guardar Resultado**
```typescript
async function savePaymentResult(cartId: string, result: PaymentResult) {
  const key = `payment_result:${cartId}`
  const data = {
    ...result,
    webhook_received_at: new Date().toISOString()
  }
  
  // Redis
  await redis.setex(key, 1800, JSON.stringify(data))
  
  // O SQL
  await db.query(`
    INSERT INTO pending_payment_results 
    (cart_id, status, transaction_id, provider, amount, currency, metadata, webhook_received_at, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '30 minutes')
    ON CONFLICT (cart_id) DO UPDATE SET
      status = EXCLUDED.status,
      transaction_id = EXCLUDED.transaction_id,
      webhook_received_at = EXCLUDED.webhook_received_at,
      expires_at = NOW() + INTERVAL '30 minutes'
  `, [cartId, result.status, result.transaction_id, ...])
}
```

**Consultar Resultado**
```typescript
async function getPaymentResult(cartId: string): Promise<PaymentResult | null> {
  // Redis
  const data = await redis.get(`payment_result:${cartId}`)
  return data ? JSON.parse(data) : null
  
  // O SQL
  const result = await db.query(`
    SELECT * FROM pending_payment_results 
    WHERE cart_id = $1 AND expires_at > NOW()
  `, [cartId])
  
  return result.rows[0] || null
}
```

**Limpiar Resultado**
```typescript
async function clearPaymentResult(cartId: string) {
  // Redis
  await redis.del(`payment_result:${cartId}`)
  
  // O SQL
  await db.query(`
    UPDATE pending_payment_results 
    SET processed_at = NOW() 
    WHERE cart_id = $1
  `, [cartId])
}
```

---

### 2. Endpoints Backend

#### 2.1. GET /store/cart/{cart_id}/order

**Propósito:** Consultar si un carrito tiene una orden asociada

**Request:**
```
GET /store/cart/cart_01XXX/order
Headers:
  x-publishable-api-key: pk_xxx
```

**Response (200 OK):**
```json
{
  "order": {
    "id": "order_01XXX",
    "display_id": 12345,
    "payment_status": "captured" | "pending" | "authorized",
    "status": "pending",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

**Response (404 Not Found):**
```json
{
  "message": "No order found for this cart"
}
```

**Implementación:**
```typescript
// En Medusa Backend
router.get("/store/cart/:id/order", async (req, res) => {
  const { id: cart_id } = req.params
  
  try {
    // Buscar orden por cart_id
    // En Medusa, el order.id generalmente se deriva del cart_id
    // O puedes tener una relación cart_id -> order_id en metadata
    
    const order = await orderService.retrieveByCartId(cart_id)
    
    if (!order) {
      return res.status(404).json({
        message: "No order found for this cart"
      })
    }
    
    return res.json({
      order: {
        id: order.id,
        display_id: order.display_id,
        payment_status: order.payment_status,
        status: order.status,
        created_at: order.created_at
      }
    })
  } catch (error) {
    return res.status(500).json({
      message: "Error retrieving order"
    })
  }
})
```

---

#### 2.2. GET /store/payment-status/{cart_id}

**Propósito:** Consultar resultado de pago pendiente en el buffer

**Request:**
```
GET /store/payment-status/cart_01XXX
Headers:
  x-publishable-api-key: pk_xxx
```

**Response (200 OK):**
```json
{
  "has_payment_result": true,
  "payment_result": {
    "status": "approved",
    "transaction_id": "txn_123456",
    "provider": "wompi",
    "amount": 100000,
    "currency": "COP",
    "webhook_received_at": "2024-01-01T00:00:00Z"
  }
}
```

**Response (404 Not Found):**
```json
{
  "has_payment_result": false,
  "message": "No pending payment result found"
}
```

**Implementación:**
```typescript
router.get("/store/payment-status/:id", async (req, res) => {
  const { id: cart_id } = req.params
  
  try {
    const result = await getPaymentResult(cart_id)
    
    if (!result) {
      return res.status(404).json({
        has_payment_result: false,
        message: "No pending payment result found"
      })
    }
    
    return res.json({
      has_payment_result: true,
      payment_result: {
        status: result.status,
        transaction_id: result.transaction_id,
        provider: result.provider,
        amount: result.amount,
        currency: result.currency,
        webhook_received_at: result.webhook_received_at
      }
    })
  } catch (error) {
    return res.status(500).json({
      message: "Error retrieving payment status"
    })
  }
})
```

---

#### 2.3. POST /store/webhook/payment/{provider} (Modificado)

**Propósito:** Recibir webhooks de pasarelas de pago con lógica mejorada

**Request:**
```
POST /store/webhook/payment/wompi
Headers:
  Content-Type: application/json
Body: (depende del provider)
```

**Lógica del Handler:**

```typescript
router.post("/store/webhook/payment/:provider", async (req, res) => {
  const { provider } = req.params
  const webhookData = req.body
  
  try {
    // 1. Validar y parsear webhook según provider
    const paymentResult = parseWebhook(provider, webhookData)
    
    // 2. Extraer cart_id del webhook
    const cartId = extractCartId(webhookData, provider)
    
    if (!cartId) {
      console.warn(`Webhook sin cart_id: ${JSON.stringify(webhookData)}`)
      return res.status(400).json({ message: "Missing cart_id" })
    }
    
    // 3. Buscar orden asociada al cart_id
    const order = await orderService.retrieveByCartId(cartId)
    
    if (order) {
      // CASO 1: Orden ya existe
      if (paymentResult.status === "approved") {
        // Capturar pago directamente
        await capturePayment(order.id, paymentResult)
        await orderService.update(order.id, {
          payment_status: "captured"
        })
      } else {
        // Pago rechazado/failed
        await orderService.update(order.id, {
          payment_status: "failed",
          metadata: {
            ...order.metadata,
            payment_error: {
              status: paymentResult.status,
              provider: provider,
              message: paymentResult.message,
              transaction_id: paymentResult.transaction_id,
              timestamp: new Date().toISOString()
            }
          }
        })
      }
      
      return res.status(200).json({ 
        message: "Payment processed",
        order_id: order.id 
      })
    } else {
      // CASO 2: Orden NO existe aún
      if (paymentResult.status === "approved") {
        // Guardar en buffer para cuando se cree la orden
        await savePaymentResult(cartId, {
          ...paymentResult,
          provider: provider
        })
        
        return res.status(200).json({ 
          message: "Payment result saved, waiting for order creation",
          cart_id: cartId
        })
      } else {
        // Pago rechazado: guardar en metadata del carrito
        await cartService.update(cartId, {
          metadata: {
            payment_error: {
              status: paymentResult.status,
              provider: provider,
              message: paymentResult.message,
              transaction_id: paymentResult.transaction_id,
              timestamp: new Date().toISOString()
            }
          }
        })
        
        return res.status(200).json({ 
          message: "Payment error saved to cart",
          cart_id: cartId
        })
      }
    }
  } catch (error) {
    console.error(`Error processing webhook from ${provider}:`, error)
    return res.status(500).json({ 
      message: "Error processing webhook" 
    })
  }
})
```

---

#### 2.4. Modificar placeOrder() / cart.complete()

**Propósito:** Al crear la orden, verificar buffer y capturar pago si existe resultado

**Lógica:**

```typescript
async function completeCart(cartId: string) {
  // 1. Verificar que el carrito esté completo
  const cart = await cartService.retrieve(cartId)
  validateCartForOrder(cart)
  
  // 2. Crear la orden
  const order = await orderService.createFromCart(cartId)
  
  // 3. Verificar si hay resultado de pago en buffer
  const paymentResult = await getPaymentResult(cartId)
  
  if (paymentResult && paymentResult.status === "approved") {
    // 4. Capturar pago inmediatamente
    try {
      await capturePayment(order.id, paymentResult)
      await orderService.update(order.id, {
        payment_status: "captured"
      })
      
      // 5. Limpiar buffer
      await clearPaymentResult(cartId)
      
      console.log(`Order ${order.id} created with payment captured from buffer`)
    } catch (error) {
      console.error(`Error capturing payment for order ${order.id}:`, error)
      // La orden se crea igual, el webhook reintentará
    }
  }
  
  // 6. Limpiar metadata de error de pago si existe
  if (cart.metadata?.payment_error) {
    await cartService.update(cartId, {
      metadata: {
        ...cart.metadata,
        payment_error: undefined
      }
    })
  }
  
  return order
}
```

---

### 3. Job de Limpieza (Opcional pero Recomendado)

**Propósito:** Limpiar resultados de buffer expirados y cancelar órdenes huérfanas

```typescript
// Ejecutar cada hora
async function cleanupPaymentResults() {
  // 1. Limpiar resultados expirados del buffer
  await db.query(`
    DELETE FROM pending_payment_results 
    WHERE expires_at < NOW() AND processed_at IS NULL
  `)
  
  // 2. Buscar órdenes con awaiting_payment > 24 horas
  const staleOrders = await orderService.list({
    payment_status: "awaiting_payment",
    created_at: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
  })
  
  // 3. Cancelar o notificar
  for (const order of staleOrders) {
    await orderService.update(order.id, {
      status: "canceled",
      metadata: {
        ...order.metadata,
        cancellation_reason: "Payment timeout - no webhook received after 24h"
      }
    })
    
    // Notificar al admin o al usuario
    await notifyAdmin(`Order ${order.id} canceled due to payment timeout`)
  }
}
```

---

## 💻 Especificación Técnica Frontend

### 1. Función para Consultar Orden por Cart ID

**Archivo:** `src/lib/data/cart.ts`

```typescript
/**
 * Consulta si el carrito tiene una orden asociada
 * @param cartId - ID del carrito
 * @returns Orden asociada o null
 */
export async function getOrderByCartId(cartId: string) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
    const response = await fetch(`${baseUrl}/store/cart/${cartId}/order`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || "",
        ...getAuthHeaders(),
      },
    })

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    return data.order
  } catch (error) {
    console.error("Error fetching order by cart ID:", error)
    return null
  }
}
```

---

### 2. Función para Consultar Estado de Pago Pendiente

**Archivo:** `src/lib/data/payment.ts` (ya existe, mejorar)

```typescript
/**
 * Consulta el resultado de pago pendiente en el buffer
 * @param cartId - ID del carrito
 * @returns Resultado de pago pendiente o null
 */
export async function getPendingPaymentStatus(cartId: string) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
    const response = await fetch(`${baseUrl}/store/payment-status/${cartId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || "",
        ...getAuthHeaders(),
      },
      signal: AbortSignal.timeout(5000), // 5 segundos timeout
    })

    if (response.status === 404) {
      return {
        hasPaymentResult: false,
        paymentResult: null
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    return data
  } catch (error: any) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return {
        hasPaymentResult: false,
        paymentResult: null,
        timeout: true
      }
    }
    
    console.error("Error fetching pending payment status:", error)
    return {
      hasPaymentResult: false,
      paymentResult: null,
      error: error.message
    }
  }
}
```

---

### 3. Lógica Mejorada en Review Component

**Archivo:** `src/modules/checkout/components/review/index.tsx`

#### 3.1. Función Principal de Manejo al Volver de Pasarela

```typescript
/**
 * Maneja el flujo cuando el usuario vuelve de la pasarela de pagos
 */
const handlePaymentReturn = async () => {
  const cartId = cart?.id
  if (!cartId) {
    console.error("No cart ID available")
    return
  }

  setIsProcessingOrder(true)

  try {
    // PASO 1: Consultar si el carrito tiene orden asociada
    const existingOrder = await getOrderByCartId(cartId)

    if (existingOrder) {
      // Orden ya existe
      if (existingOrder.payment_status === "captured") {
        // Pago ya capturado - redirigir a confirmación
        router.push(`/${countryCode}/order/confirmed/${existingOrder.id}`)
        return
      } else {
        // Pago pendiente - redirigir y hacer polling
        router.push(`/${countryCode}/order/confirmed/${existingOrder.id}?status=processing_payment`)
        return
      }
    }

    // PASO 2: Orden NO existe - consultar buffer
    // Esperar 2 segundos para dar tiempo al webhook
    await new Promise(resolve => setTimeout(resolve, 2000))

    const paymentStatus = await getPendingPaymentStatus(cartId)

    if (paymentStatus.hasPaymentResult && paymentStatus.paymentResult?.status === "approved") {
      // Hay resultado exitoso en buffer - completar carrito
      // El backend capturará el pago automáticamente
      const result = await placeOrder()
      
      if (result?.id) {
        router.push(`/${countryCode}/order/confirmed/${result.id}`)
        return
      }
    }

    // PASO 3: No hay resultado aún - hacer polling por 5-8 segundos
    let attempts = 0
    const maxAttempts = 4 // 4 intentos cada 2 segundos = 8 segundos total
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      const status = await getPendingPaymentStatus(cartId)
      
      if (status.hasPaymentResult && status.paymentResult?.status === "approved") {
        // Llegó el resultado - completar carrito
        const result = await placeOrder()
        
        if (result?.id) {
          router.push(`/${countryCode}/order/confirmed/${result.id}`)
          return
        }
      }
      
      attempts++
    }

    // PASO 4: No llegó resultado después de timeout
    // Crear orden con estado awaiting_payment
    const result = await placeOrder()
    
    if (result?.id) {
      router.push(`/${countryCode}/order/confirmed/${result.id}?status=processing_payment`)
    }

  } catch (error: any) {
    console.error("Error handling payment return:", error)
    setError("Error procesando el pago. Por favor intenta nuevamente.")
  } finally {
    setIsProcessingOrder(false)
  }
}
```

#### 3.2. Verificar Errores de Pago en Metadata

```typescript
/**
 * Verifica si hay errores de pago previos en el carrito
 */
useEffect(() => {
  if (!cart?.metadata) return

  const paymentError = cart.metadata.payment_error

  if (paymentError) {
    // Mostrar error en la sección de pagos
    const errorMessage = paymentError.message || 
      `El pago fue ${paymentError.status}. Por favor intenta con otro método.`
    
    // Actualizar estado según el provider
    if (paymentError.provider === "wompi") {
      setWompiError(errorMessage)
    } else if (paymentError.provider === "bold") {
      setBoldError(errorMessage)
    } else if (paymentError.provider === "addi") {
      setAddiError(errorMessage)
    }

    // Bloquear botón de completar orden
    setIsPaymentBlocked(true)
  }
}, [cart?.metadata])
```

---

### 4. Lógica en Página de Confirmación de Orden

**Archivo:** `src/app/[countryCode]/(main)/order/confirmed/[id]/page.tsx`

#### 4.1. Polling para Órdenes con Pago Pendiente

```typescript
"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { trackOrderById } from "@lib/data/orders"

export default function OrderConfirmedPage({ params, searchParams }: Props) {
  const [order, setOrder] = useState(initialOrder)
  const [isPolling, setIsPolling] = useState(false)
  const searchParamsResolved = useSearchParams()
  const status = searchParamsResolved?.get("status")

  useEffect(() => {
    // Si la orden viene con status=processing_payment, iniciar polling
    if (status === "processing_payment" && order.payment_status !== "captured") {
      setIsPolling(true)
      startPaymentPolling(order.id)
    }
  }, [status, order.id])

  const startPaymentPolling = async (orderId: string) => {
    let attempts = 0
    const maxAttempts = 100 // 100 intentos * 3 segundos = 5 minutos máximo
    const pollInterval = 3000 // 3 segundos

    const poll = async () => {
      try {
        const updatedOrder = await trackOrderById(orderId)

        if (updatedOrder.payment_status === "captured") {
          // Pago capturado - actualizar UI y parar polling
          setOrder(updatedOrder)
          setIsPolling(false)
          return
        }

        attempts++

        if (attempts >= maxAttempts) {
          // Timeout después de 5 minutos
          setIsPolling(false)
          // Mostrar mensaje de ayuda
          return
        }

        // Continuar polling
        setTimeout(poll, pollInterval)
      } catch (error) {
        console.error("Error polling order status:", error)
        // Continuar intentando
        setTimeout(poll, pollInterval)
      }
    }

    // Iniciar polling
    setTimeout(poll, pollInterval)
  }

  // Renderizar mensaje según estado
  const getStatusMessage = () => {
    if (status === "processing_payment" && isPolling) {
      return "Orden creada. Procesando tu pago, esto puede tardar unos minutos..."
    }
    
    if (order.payment_status === "captured") {
      return "¡Pago exitoso! Tu orden ha sido confirmada."
    }

    return "Tu orden ha sido creada."
  }

  // ... resto del componente
}
```

---

### 5. Manejo de Errores de Pago en Checkout

**Archivo:** `src/modules/checkout/components/review/index.tsx`

```typescript
/**
 * Componente para mostrar errores de pago previos
 */
const PaymentErrorDisplay = ({ cart }: { cart: any }) => {
  const paymentError = cart?.metadata?.payment_error

  if (!paymentError) return null

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
      <div className="flex items-start">
        <svg className="w-5 h-5 text-red-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-red-800">
            Problema con el pago anterior
          </h3>
          <p className="mt-1 text-sm text-red-700">
            {paymentError.message || `El pago fue ${paymentError.status}.`}
          </p>
          <div className="mt-3 flex space-x-3">
            <button
              onClick={() => {
                // Limpiar error y permitir nuevo intento
                // Esto debería llamar a un endpoint que limpie el metadata
              }}
              className="text-sm font-medium text-red-800 hover:text-red-900"
            >
              Intentar con otro método
            </button>
            <a
              href={LEGAL_INFO.whatsapp.getAdviceUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-red-800 hover:text-red-900"
            >
              Contactar soporte
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
```

---

## 🧪 Casos de Prueba

### Test 1: Webhook Llega Antes - Pago Exitoso
1. Usuario inicia pago
2. Webhook llega con `approved` antes de crear orden
3. Webhook guarda resultado en buffer
4. Usuario vuelve de pasarela
5. Frontend consulta orden → No existe
6. Frontend consulta buffer → Existe resultado
7. Frontend llama `placeOrder()`
8. Backend crea orden y captura pago desde buffer
9. Usuario ve orden confirmada con pago exitoso

**Resultado esperado:** ✅ Orden creada con pago capturado inmediatamente

---

### Test 2: Webhook Llega Después - Pago Exitoso
1. Usuario inicia pago
2. Usuario vuelve de pasarela
3. Frontend consulta orden → No existe
4. Frontend consulta buffer → No existe
5. Frontend espera 5-10 segundos con polling
6. Webhook llega durante la espera
7. Frontend detecta resultado en buffer
8. Frontend llama `placeOrder()`
9. Backend crea orden y captura pago
10. Usuario ve orden confirmada

**Resultado esperado:** ✅ Orden creada con pago capturado después de espera corta

---

### Test 3: Webhook No Llega a Tiempo
1. Usuario inicia pago
2. Usuario vuelve de pasarela
3. Frontend consulta orden → No existe
4. Frontend consulta buffer → No existe
5. Frontend espera 5-10 segundos con polling
6. Webhook NO llega durante la espera
7. Frontend crea orden con estado `awaiting_payment`
8. Usuario ve mensaje "Procesando pago"
9. Frontend inicia polling en página de confirmación
10. Webhook llega después (reintento)
11. Backend captura pago
12. Frontend detecta cambio en polling
13. Usuario ve "Pago confirmado"

**Resultado esperado:** ✅ Orden creada, pago capturado cuando llega webhook

---

### Test 4: Pago Rechazado
1. Usuario inicia pago
2. Webhook llega con `rejected`
3. Backend guarda error en `cart.metadata.payment_error`
4. Usuario vuelve de pasarela
5. Frontend carga checkout
6. Frontend detecta error en metadata
7. Frontend muestra error en sección de pagos
8. Frontend bloquea botón "Completar orden"
9. Usuario puede intentar con otro método

**Resultado esperado:** ✅ Error mostrado, usuario puede reintentar

---

### Test 5: Múltiples Webhooks Simultáneos
1. Usuario inicia pago
2. Webhook 1 llega con `approved` → Guarda en buffer
3. Webhook 2 llega con `approved` (reintento) → Actualiza buffer
4. Usuario vuelve de pasarela
5. Frontend consulta buffer → Obtiene resultado más reciente
6. Frontend crea orden
7. Webhook 3 llega → Detecta orden existente, captura pago

**Resultado esperado:** ✅ Sin duplicados, pago procesado correctamente

---

### Test 6: Orden Creada Antes del Webhook
1. Usuario inicia pago
2. Usuario vuelve de pasarela rápidamente
3. Frontend crea orden antes de que llegue webhook
4. Webhook llega después
5. Backend detecta orden existente
6. Backend captura pago directamente

**Resultado esperado:** ✅ Pago capturado cuando llega webhook

---

## 📊 Métricas y Monitoreo

### Métricas a Implementar

1. **Tiempo entre webhook y creación de orden**
   - Objetivo: < 10 segundos en 90% de casos

2. **Tasa de aprovechamiento del primer webhook**
   - Objetivo: > 80% de webhooks procesados en primer intento

3. **Tasa de órdenes con pago pendiente**
   - Objetivo: < 5% de órdenes quedan en `awaiting_payment`

4. **Tiempo promedio de captura de pago**
   - Objetivo: < 30 segundos desde creación de orden

### Logging Recomendado

```typescript
// En webhook handler
logger.info("Webhook received", {
  provider,
  cart_id,
  transaction_id,
  status,
  has_order: !!order,
  action: order ? "captured_directly" : "saved_to_buffer"
})

// En placeOrder
logger.info("Order created", {
  order_id,
  cart_id,
  had_payment_result: !!paymentResult,
  payment_captured: paymentResult?.status === "approved"
})

// En frontend
console.log("Payment return flow", {
  cart_id,
  has_order: !!existingOrder,
  has_buffer_result: !!paymentStatus.hasPaymentResult,
  action_taken: "created_order" | "redirected_to_order" | "polling"
})
```

---

## 🔒 Consideraciones de Seguridad

1. **Validación de Webhooks**
   - Verificar firma/autenticación del webhook según provider
   - Validar que el webhook viene de la pasarela oficial

2. **Idempotencia**
   - Usar `transaction_id` como clave única
   - Evitar procesar el mismo webhook múltiples veces

3. **Rate Limiting**
   - Limitar consultas al buffer desde frontend
   - Implementar rate limiting en endpoints de webhook

4. **TTL del Buffer**
   - Limpiar resultados después de 30 minutos
   - Evitar acumulación de datos obsoletos

---

## 📝 Checklist de Implementación

### Backend
- [ ] Implementar buffer temporal (Redis o SQL)
- [ ] Crear endpoint `GET /store/cart/{cart_id}/order`
- [ ] Crear endpoint `GET /store/payment-status/{cart_id}`
- [ ] Modificar handler de webhooks con nueva lógica
- [ ] Modificar `placeOrder()` para verificar buffer
- [ ] Implementar función de captura de pago
- [ ] Agregar logging y métricas
- [ ] Implementar job de limpieza (opcional)
- [ ] Agregar tests unitarios
- [ ] Agregar tests de integración

### Frontend
- [ ] Crear función `getOrderByCartId()`
- [ ] Mejorar función `getPendingPaymentStatus()`
- [ ] Implementar `handlePaymentReturn()` en Review
- [ ] Agregar polling en página de confirmación
- [ ] Implementar `PaymentErrorDisplay` component
- [ ] Agregar manejo de estados de pago pendiente
- [ ] Agregar tests de componentes
- [ ] Agregar tests E2E

### Testing
- [ ] Test: Webhook antes de orden
- [ ] Test: Webhook después de orden
- [ ] Test: Webhook rechazado
- [ ] Test: Múltiples webhooks
- [ ] Test: Timeout de webhook
- [ ] Test: Errores de red
- [ ] Test: Concurrencia

### Documentación
- [ ] Documentar nuevos endpoints
- [ ] Actualizar documentación de flujo de checkout
- [ ] Documentar estructura del buffer
- [ ] Crear guía de troubleshooting

---

## 🚀 Plan de Despliegue

### Fase 1: Backend (Semana 1)
1. Implementar buffer temporal
2. Crear nuevos endpoints
3. Modificar webhook handler
4. Testing en desarrollo

### Fase 2: Frontend (Semana 2)
1. Implementar funciones de consulta
2. Modificar componente Review
3. Agregar polling en confirmación
4. Testing en desarrollo

### Fase 3: Integración (Semana 3)
1. Testing end-to-end completo
2. Testing de carga
3. Ajustes y optimizaciones
4. Documentación

### Fase 4: Producción (Semana 4)
1. Deploy a staging
2. Testing en staging
3. Deploy gradual a producción
4. Monitoreo post-deploy

---

## 🐛 Troubleshooting

### Problema: Webhook no se procesa
**Causas posibles:**
- Buffer lleno o Redis caído
- Error en validación del webhook
- Cart_id no encontrado en webhook

**Solución:**
- Verificar logs del webhook handler
- Verificar conectividad con Redis/DB
- Validar formato del webhook

### Problema: Orden creada pero pago no capturado
**Causas posibles:**
- Buffer no consultado al crear orden
- Error al capturar pago
- Webhook llegó después de crear orden

**Solución:**
- Verificar logs de `placeOrder()`
- Verificar que se consulta buffer
- Verificar polling en frontend

### Problema: Múltiples órdenes creadas
**Causas posibles:**
- Race condition en frontend
- Múltiples clicks en botón

**Solución:**
- Agregar debounce en botón
- Verificar orden antes de crear
- Agregar validación en backend

---

## 📚 Referencias

- [Medusa.js Documentation](https://docs.medusajs.com/)
- [Medusa Payment Providers](https://docs.medusajs.com/resources/commerce-modules/payment)
- [Webhook Best Practices](https://stripe.com/docs/webhooks/best-practices)

---

## 📞 Contacto y Soporte

Para dudas sobre la implementación, contactar al equipo de desarrollo o crear un issue en el repositorio.

---

**Última actualización:** 2024-01-01
**Versión:** 1.0.0

