# Sistema de Buffer de Webhooks de Pago

## 📋 Índice

1. [Problema y Solución](#problema-y-solución)
2. [Arquitectura](#arquitectura)
3. [Estado de Implementación](#estado-de-implementación)
4. [Especificación Técnica](#especificación-técnica)
5. [Endpoints Backend](#endpoints-backend)
6. [Flujos Detallados](#flujos-detallados)
7. [Implementación Frontend](#implementación-frontend)
8. [Guía de Pruebas](#guía-de-pruebas)

---

## Problema y Solución

### Contexto del Problema

**Flujo Actual:**
1. Usuario crea carrito y procede al checkout
2. Usuario lanza pasarela de pagos
3. Usuario vuelve de pasarela con status `approved` o `failed`
4. Se crea la orden
5. Backend recibe callback de la pasarela de pagos
6. La orden pasa a estado "pago capturado" si el pago fue exitoso

**Problema Identificado:**
El callback de la pasarela de pagos puede llegar **antes** de que se cree la orden, ignorando el primer intento de notificación. La pasarela realizará reintentos durante 24 horas, pero queremos aprovechar el primer callback para obtener el resultado lo antes posible.

### Objetivo

Aprovechar el primer callback de la pasarela de pagos para obtener el resultado de la transacción lo antes posible, mejorando la experiencia del usuario y reduciendo la latencia en la confirmación de pagos.

---

## Arquitectura

### Componentes Principales

1. **Buffer Temporal de Resultados de Pago**
   - Almacena resultados de webhooks cuando no existe orden aún
   - Clave: `cart_id`
   - TTL: 30 minutos
   - Almacenamiento: Redis (preferido) o PostgreSQL (fallback)

2. **Endpoints Backend**
   - `GET /store/cart/{cart_id}/order` - Consultar orden por cart_id
   - `GET /store/payment-status/{cart_id}` - Consultar resultado pendiente

3. **Webhooks Modificados**
   - `/hooks/wompi/payment/route.ts`
   - `/hooks/bold/payment/route.ts`
   - `/hooks/addi/payment/route.ts`

4. **Subscriber Automático**
   - `src/subscribers/order-created-payment-buffer.ts`
   - Escucha evento `order.created`
   - Captura pago automáticamente si hay resultado en buffer

---

## Estado de Implementación

**Última actualización:** 2025-01-12

### ✅ FASE 1: Infraestructura del Buffer - COMPLETADA

**Implementado:**
- ✅ Servicio de buffer de pagos (`src/lib/payment-buffer-service.ts`)
  - Soporte Redis (preferido) y PostgreSQL (fallback)
  - TTL de 30 minutos
  - Creación automática de tabla si no existe
  
- ✅ Endpoint `GET /store/cart/{cart_id}/order`
  - Consulta si existe orden asociada al carrito
  - Retorna información básica de la orden
  
- ✅ Endpoint `GET /store/payment-status/{cart_id}`
  - Consulta resultado de pago pendiente en buffer
  - Retorna resultado si existe y no ha expirado

**Estado:** ✅ Completado y probado

---

### ✅ FASE 2: Modificar Webhooks Existentes - COMPLETADA

**Implementado:**
- ✅ Webhook de Wompi modificado
  - Guarda en buffer si no existe orden
  - Guarda errores en metadata del carrito
  - Modo de prueba en desarrollo (TEST_CHECKSUM)
  
- ✅ Webhook de Bold modificado
  - Guarda en buffer si no existe orden
  - Maneja diferentes tipos de eventos (SALE_APPROVED, SALE_REJECTED, etc.)
  
- ✅ Webhook de ADDI modificado
  - Guarda en buffer si no existe orden
  - Maneja estados de ADDI (APPROVED, REJECTED, etc.)
  - Modo de prueba local (ADDI_TESTING_LOCAL=true)

**Estado:** ✅ Completado y probado

---

### ✅ FASE 3: Modificar Flujo de Creación de Orden - COMPLETADA

**Implementado:**
- ✅ Subscriber `order-created-payment-buffer.ts`
  - Escucha evento `order.created`
  - Consulta buffer de resultados de pago
  - Captura pago automáticamente si hay resultado aprobado
  - Actualiza metadata de la orden
  - Envía notificación WhatsApp
  - Limpia buffer después de procesar

- ✅ Notificaciones WhatsApp
  - Webhooks envían notificación cuando procesan pagos normalmente
  - Subscriber envía notificación cuando captura desde buffer
  - Soporte para Wompi, Bold y ADDI

**Estado:** ✅ Completado

---

### 🟡 FASE 4: Testing y Validación - EN PROGRESO

**Completado:**
- ✅ Script de pruebas manuales (`scripts/test-webhook-buffer.js`)
- ✅ Documentación de pruebas

**Pendiente:**
- ⏳ Tests unitarios del servicio de buffer
- ⏳ Tests de integración de webhooks
- ⏳ Tests end-to-end completos

**Estado:** 🟡 En progreso (pruebas manuales funcionando)

---

### ⏳ FASE 5: Frontend (Opcional) - PENDIENTE

**Estado:** ⏳ Pendiente (requiere acceso al frontend)

Ver sección [Implementación Frontend](#implementación-frontend) para detalles.

---

## Especificación Técnica

### Buffer Temporal de Resultados

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
  "ttl": 1800
}
```

**Opción B: Tabla SQL (Fallback)**
```sql
CREATE TABLE pending_payment_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) NOT NULL,
  transaction_id VARCHAR(255) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  amount INTEGER,
  currency VARCHAR(10),
  metadata JSONB,
  webhook_received_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);
```

### Servicio de Buffer

**Archivo:** `src/lib/payment-buffer-service.ts`

**Funciones principales:**
- `savePaymentResult(cartId, result)` - Guardar resultado en buffer
- `getPaymentResult(cartId)` - Obtener resultado del buffer
- `clearPaymentResult(cartId)` - Limpiar resultado procesado
- `savePaymentError(cartId, error)` - Guardar error en metadata del carrito

---

## Endpoints Backend

### 1. GET /store/cart/{cart_id}/order

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

---

### 2. GET /store/payment-status/{cart_id}

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

---

## Flujos Detallados

### Escenario A: Webhook Llega ANTES de Crear Orden - Pago Exitoso

```
1. Webhook llega con pago aprobado
2. Backend busca orden por cart_id → NO existe
3. Backend guarda resultado en buffer
4. Usuario vuelve de pasarela
5. Frontend consulta orden → No existe
6. Frontend consulta buffer → Existe resultado
7. Frontend llama placeOrder()
8. Backend crea orden
9. Subscriber detecta resultado en buffer
10. Subscriber captura pago automáticamente
11. Subscriber envía notificación WhatsApp
12. Subscriber limpia buffer
```

**Resultado:** ✅ Orden creada con pago capturado inmediatamente

---

### Escenario B: Webhook Llega DESPUÉS de Crear Orden - Pago Exitoso

```
1. Usuario crea orden
2. Webhook llega con pago aprobado
3. Webhook busca orden → Existe
4. Webhook captura pago directamente
5. Webhook envía notificación WhatsApp
```

**Resultado:** ✅ Pago capturado y notificación enviada

---

### Escenario C: Pago Rechazado

```
1. Webhook llega con rechazo
2. Backend busca orden por cart_id
3. Si orden NO existe:
   - Guarda error en cart.metadata.payment_error
4. Si orden existe:
   - Actualiza orden con payment_status: failed
   - Guarda error en metadata
5. Frontend muestra error en checkout
```

**Resultado:** ✅ Error guardado, usuario puede reintentar

---

## Implementación Frontend

### 📋 Resumen de lo Implementado en Backend

#### ✅ Infraestructura Completada

1. **Servicio de Buffer de Pagos**
   - **Archivo:** `src/lib/payment-buffer-service.ts`
   - **Funcionalidad:** Almacena resultados de webhooks cuando no existe orden aún
   - **Almacenamiento:** Redis (preferido) o PostgreSQL (fallback)
   - **TTL:** 30 minutos

2. **Endpoints Backend Disponibles**

   **GET `/store/cart/{cart_id}/order`**
   - Consulta si un carrito tiene una orden asociada
   - **Response 200:** `{ order: { id, display_id, payment_status, status, created_at } }`
   - **Response 404:** `{ message: "No order found for this cart" }`

   **GET `/store/payment-status/{cart_id}`**
   - Consulta resultado de pago pendiente en el buffer
   - **Response 200:** `{ has_payment_result: true, payment_result: { status, transaction_id, provider, amount, currency, webhook_received_at } }`
   - **Response 404:** `{ has_payment_result: false, message: "No pending payment result found" }`

3. **Webhooks Modificados**
   - **Wompi, Bold, ADDI:** Ahora guardan resultados en buffer si no existe orden
   - Guardan errores en `cart.metadata.payment_error` si el pago es rechazado

4. **Subscriber Automático**
   - **Archivo:** `src/subscribers/order-created-payment-buffer.ts`
   - Escucha evento `order.created`
   - Si hay resultado en buffer, captura el pago automáticamente
   - Envía notificación WhatsApp automáticamente
   - Limpia el buffer después de procesar

---

### 🎯 Objetivo del Frontend

Mejorar la experiencia del usuario al volver de la pasarela de pagos:
1. Consultar si ya existe una orden antes de crear una nueva
2. Consultar el buffer de resultados de pago
3. Si hay resultado exitoso, crear la orden (el backend capturará automáticamente)
4. Si no hay resultado, hacer polling corto antes de crear orden
5. Mostrar errores de pago previos en el checkout

---

### 📝 Paso a Paso: Implementación Frontend

#### PASO 1: Crear Función para Consultar Orden por Cart ID

**Archivo:** `src/lib/data/cart.ts` (o donde tengas las funciones de cart)

**Código:**
```typescript
/**
 * Consulta si un carrito tiene una orden asociada
 * @param cartId - ID del carrito
 * @returns Orden asociada o null si no existe
 */
export async function getOrderByCartId(cartId: string) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL
    const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
    
    if (!baseUrl || !publishableKey) {
      console.error("Backend URL o Publishable Key no configurados")
      return null
    }

    const response = await fetch(`${baseUrl}/store/cart/${cartId}/order`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-publishable-api-key": publishableKey,
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

#### PASO 2: Crear Función para Consultar Estado de Pago Pendiente

**Archivo:** `src/lib/data/payment.ts` (o crear si no existe)

**Código:**
```typescript
/**
 * Consulta el resultado de pago pendiente en el buffer
 * @param cartId - ID del carrito
 * @returns Resultado de pago pendiente o null
 */
export async function getPendingPaymentStatus(cartId: string) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL
    const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
    
    if (!baseUrl || !publishableKey) {
      console.error("Backend URL o Publishable Key no configurados")
      return {
        hasPaymentResult: false,
        paymentResult: null,
      }
    }

    const response = await fetch(`${baseUrl}/store/payment-status/${cartId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-publishable-api-key": publishableKey,
      },
      signal: AbortSignal.timeout(5000), // 5 segundos timeout
    })

    if (response.status === 404) {
      return {
        hasPaymentResult: false,
        paymentResult: null,
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    return {
      hasPaymentResult: data.has_payment_result,
      paymentResult: data.payment_result || null,
    }
  } catch (error: any) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return {
        hasPaymentResult: false,
        paymentResult: null,
        timeout: true,
      }
    }
    
    console.error("Error fetching pending payment status:", error)
    return {
      hasPaymentResult: false,
      paymentResult: null,
      error: error.message,
    }
  }
}
```

---

#### PASO 3: Modificar Componente de Checkout (Review)

**Archivo:** `src/modules/checkout/components/review/index.tsx` (ajustar ruta según tu estructura)

**Funcionalidad a agregar:**

##### 3.1. Función para Manejar el Retorno de la Pasarela

```typescript
import { getOrderByCartId } from "@lib/data/cart"
import { getPendingPaymentStatus } from "@lib/data/payment"
import { useRouter } from "next/navigation"

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

##### 3.2. Llamar esta función cuando el usuario vuelve de la pasarela

**Opciones:**
- Si tienes un parámetro en la URL (ej: `?payment_return=true`), detectarlo en `useEffect`
- Si tienes un evento específico, llamarlo ahí
- Si el componente se monta después de volver de la pasarela, llamarlo en `useEffect` con dependencias apropiadas

**Ejemplo:**
```typescript
useEffect(() => {
  const searchParams = new URLSearchParams(window.location.search)
  const paymentReturn = searchParams.get('payment_return')
  
  if (paymentReturn === 'true' && cart?.id) {
    handlePaymentReturn()
  }
}, [cart?.id])
```

---

#### PASO 4: Verificar Errores de Pago en Metadata del Carrito

**En el mismo componente Review:**

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

#### PASO 5: Componente para Mostrar Errores de Pago

**Crear componente:** `src/modules/checkout/components/payment-error-display.tsx`

```typescript
import { Cart } from "@medusajs/medusa"

interface PaymentErrorDisplayProps {
  cart: Cart
  onClearError?: () => void
}

export const PaymentErrorDisplay = ({ cart, onClearError }: PaymentErrorDisplayProps) => {
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
                if (onClearError) {
                  onClearError()
                } else {
                  window.location.reload()
                }
              }}
              className="text-sm font-medium text-red-800 hover:text-red-900 underline"
            >
              Intentar con otro método
            </button>
            <a
              href="https://wa.me/573001234567" // Reemplazar con tu número de WhatsApp
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-red-800 hover:text-red-900 underline"
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

**Usar en Review:**
```typescript
import { PaymentErrorDisplay } from "../payment-error-display"

// En el render:
<PaymentErrorDisplay cart={cart} />
```

---

#### PASO 6: Agregar Polling en Página de Confirmación de Orden

**Archivo:** `src/app/[countryCode]/(main)/order/confirmed/[id]/page.tsx` (ajustar ruta)

**Funcionalidad:**

```typescript
"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { trackOrderById } from "@lib/data/orders" // Ajustar según tu estructura

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

### 🔄 Flujo Completo del Frontend

#### Escenario A: Usuario Vuelve de Pasarela con Pago Exitoso

```
1. Usuario vuelve de pasarela → URL: /checkout?payment_return=true
2. Componente Review detecta payment_return
3. Llama handlePaymentReturn():
   a. Consulta orden → No existe
   b. Espera 2 segundos
   c. Consulta buffer → Hay resultado aprobado
   d. Llama placeOrder()
   e. Backend crea orden y captura pago automáticamente
   f. Redirige a /order/confirmed/{order_id}
4. Página de confirmación muestra "Pago exitoso"
```

#### Escenario B: Usuario Vuelve pero Webhook Aún No Llega

```
1. Usuario vuelve de pasarela
2. handlePaymentReturn():
   a. Consulta orden → No existe
   b. Consulta buffer → No hay resultado
   c. Hace polling cada 2s por 8 segundos
   d. Si llega resultado → placeOrder() y redirige
   e. Si no llega → placeOrder() con status=processing_payment
3. Redirige a /order/confirmed/{order_id}?status=processing_payment
4. Página de confirmación inicia polling cada 3s
5. Cuando webhook llega, backend captura pago
6. Polling detecta cambio y actualiza UI
```

#### Escenario C: Pago Rechazado

```
1. Webhook llega con rechazo → Guarda error en cart.metadata.payment_error
2. Usuario vuelve de pasarela
3. Componente Review detecta error en metadata
4. Muestra PaymentErrorDisplay con mensaje de error
5. Bloquea botón "Completar orden"
6. Usuario puede intentar con otro método
```

---

### 📋 Checklist de Implementación Frontend

#### Funciones de Consulta
- [ ] Crear `getOrderByCartId()` en `src/lib/data/cart.ts`
- [ ] Crear `getPendingPaymentStatus()` en `src/lib/data/payment.ts`
- [ ] Verificar que las variables de entorno estén configuradas

#### Componente Review
- [ ] Agregar función `handlePaymentReturn()`
- [ ] Detectar cuando usuario vuelve de pasarela
- [ ] Implementar polling antes de crear orden
- [ ] Agregar `PaymentErrorDisplay` component
- [ ] Verificar errores en `cart.metadata.payment_error`
- [ ] Bloquear botón si hay error de pago

#### Página de Confirmación
- [ ] Detectar parámetro `status=processing_payment`
- [ ] Implementar polling para verificar `payment_status`
- [ ] Mostrar mensajes de estado apropiados
- [ ] Manejar timeout después de 5 minutos

#### Variables de Entorno Necesarias
```env
NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_xxx
```

---

## Guía de Pruebas

### Inicio Rápido

#### 1. Verificar que el servidor esté corriendo

```bash
# En desarrollo
pnpm dev

# O en producción
pnpm start:server
```

#### 2. Verificar variables de entorno

```bash
# Verificar que estas variables estén configuradas
echo $REDIS_URL          # Opcional, pero recomendado
echo $DATABASE_URL       # Requerido
echo $NOTIFICATION_API_KEY  # Para notificaciones WhatsApp
echo $STORE_PUBLISHABLE_API_KEY  # Para endpoints de store
```

---

### Pruebas Rápidas

#### Prueba 1: Verificar Endpoints

```bash
# 1. Consultar orden (debe retornar 404 si no existe)
curl -X GET http://localhost:9000/store/cart/cart_test_123/order \
  -H "x-publishable-api-key: $STORE_PUBLISHABLE_API_KEY"

# 2. Consultar buffer (debe retornar 404 si no existe)
curl -X GET http://localhost:9000/store/payment-status/cart_test_123 \
  -H "x-publishable-api-key: $STORE_PUBLISHABLE_API_KEY"
```

#### Prueba 2: Simular Webhook (Sin Orden)

```bash
# Simular webhook de Wompi con pago aprobado
# Debe guardar en buffer y retornar 200

curl -X POST http://localhost:9000/hooks/wompi/payment \
  -H "Content-Type: application/json" \
  -d '{
    "event": "transaction.updated",
    "data": {
      "transaction": {
        "id": "test_txn_123",
        "amount_in_cents": 100000,
        "reference": "cart_test_123",
        "customer_email": "test@example.com",
        "currency": "COP",
        "payment_method_type": "CARD",
        "redirect_url": "https://example.com",
        "status": "APPROVED"
      }
    },
    "environment": "sandbox",
    "signature": {
      "properties": ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
      "checksum": "TEST_CHECKSUM"
    },
    "timestamp": 1234567890,
    "sent_at": "2024-01-01T00:00:00Z"
  }'
```

**Resultado esperado:**
```json
{
  "message": "Payment result saved, waiting for order creation",
  "cart_id": "cart_test_123"
}
```

#### Prueba 3: Verificar Buffer

```bash
# Después de la Prueba 2, consultar el buffer
curl -X GET http://localhost:9000/store/payment-status/cart_test_123 \
  -H "x-publishable-api-key: $STORE_PUBLISHABLE_API_KEY"
```

**Resultado esperado:**
```json
{
  "has_payment_result": true,
  "payment_result": {
    "status": "approved",
    "transaction_id": "test_txn_123",
    "provider": "wompi",
    "amount": 1000,
    "currency": "COP",
    "webhook_received_at": "2024-01-01T00:00:00Z"
  }
}
```

---

### Escenarios de Prueba Completos

#### Test 1: Webhook Llega ANTES de Crear Orden - Pago Exitoso

**Objetivo:** Verificar que el webhook guarda en buffer y el subscriber captura automáticamente.

**Pasos:**
1. Crear un carrito con items
2. Iniciar pago con Wompi/Bold/ADDI
3. **Simular webhook ANTES de crear orden:**
   - Llamar endpoint webhook directamente con `approved`
   - Verificar que retorna 200 con mensaje "Payment result saved"
4. Verificar buffer:
   - `GET /store/payment-status/{cart_id}` debe retornar resultado
5. Crear orden desde el carrito
6. Verificar:
   - Orden creada con `payment_status: "captured"`
   - Buffer limpiado (consulta retorna 404)
   - Notificación WhatsApp enviada (ver logs)

**Resultado esperado:** ✅ Orden creada con pago capturado inmediatamente

---

#### Test 2: Webhook Llega DESPUÉS de Crear Orden - Pago Exitoso

**Objetivo:** Verificar que el webhook procesa normalmente cuando existe orden.

**Pasos:**
1. Crear un carrito con items
2. Crear orden desde el carrito
3. **Simular webhook DESPUÉS de crear orden:**
   - Llamar endpoint webhook con `approved`
   - Verificar que retorna 200 con "success"
4. Verificar:
   - Orden tiene `payment_status: "captured"`
   - Notificación WhatsApp enviada (ver logs)

**Resultado esperado:** ✅ Pago capturado y notificación enviada

---

#### Test 3: Webhook Llega ANTES - Pago Rechazado

**Objetivo:** Verificar que los errores se guardan en metadata del carrito.

**Pasos:**
1. Crear un carrito con items
2. Iniciar pago
3. **Simular webhook con rechazo:**
   - Llamar endpoint webhook con `DECLINED`/`REJECTED`
   - Verificar que retorna 200
4. Consultar carrito:
   - Verificar que `cart.metadata.payment_error` existe
   - Verificar contenido del error
5. Intentar crear orden:
   - Frontend debería mostrar error (si está implementado)

**Resultado esperado:** ✅ Error guardado en metadata, usuario puede ver error

---

#### Test 4: Múltiples Webhooks Simultáneos

**Objetivo:** Verificar idempotencia y manejo de reintentos.

**Pasos:**
1. Crear carrito
2. Enviar webhook 1 con `approved` → Guarda en buffer
3. Enviar webhook 2 con `approved` (reintento) → Actualiza buffer
4. Crear orden
5. Enviar webhook 3 con `approved` → Detecta orden existente, no duplica

**Resultado esperado:** ✅ Sin duplicados, pago procesado una sola vez

---

#### Test 5: Buffer con Redis vs PostgreSQL

**Objetivo:** Verificar que funciona con ambos almacenamientos.

**Pasos:**
1. **Con Redis disponible:**
   - Guardar resultado en buffer
   - Verificar que se guarda en Redis (usar `redis-cli`)
   - Consultar y verificar TTL
2. **Sin Redis (solo PostgreSQL):**
   - Deshabilitar Redis temporalmente
   - Guardar resultado en buffer
   - Verificar que se guarda en tabla `pending_payment_results`
   - Consultar y verificar

**Resultado esperado:** ✅ Funciona con ambos almacenamientos

---

#### Test 6: TTL y Expiración del Buffer

**Objetivo:** Verificar que los resultados expiran correctamente.

**Pasos:**
1. Guardar resultado en buffer
2. Esperar 30 minutos (o modificar TTL para prueba rápida)
3. Consultar buffer → Debe retornar 404
4. Intentar crear orden → No debe capturar desde buffer

**Resultado esperado:** ✅ Resultados expiran después de 30 minutos

---

### Scripts de Prueba

#### Script 1: Simular Webhook de Wompi

```bash
# Webhook con pago aprobado
curl -X POST http://localhost:9000/hooks/wompi/payment \
  -H "Content-Type: application/json" \
  -d '{
    "event": "transaction.updated",
    "data": {
      "transaction": {
        "id": "test_txn_123",
        "amount_in_cents": 100000,
        "reference": "cart_01XXX",
        "customer_email": "test@example.com",
        "currency": "COP",
        "payment_method_type": "CARD",
        "redirect_url": "https://example.com",
        "status": "APPROVED"
      }
    },
    "environment": "sandbox",
    "signature": {
      "properties": ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
      "checksum": "TEST_CHECKSUM"
    },
    "timestamp": 1234567890,
    "sent_at": "2024-01-01T00:00:00Z"
  }'
```

#### Script 2: Simular Webhook de Bold

```bash
# Webhook con pago aprobado
curl -X POST http://localhost:9000/hooks/bold/payment \
  -H "Content-Type: application/json" \
  -H "x-bold-signature: TEST_SIGNATURE" \
  -d '{
    "id": "test_event_123",
    "type": "SALE_APPROVED",
    "subject": "payment",
    "source": "bold",
    "spec_version": "1.0",
    "time": 1234567890,
    "data": {
      "payment_id": "test_payment_123",
      "merchant_id": "test_merchant",
      "created_at": "2024-01-01T00:00:00Z",
      "amount": {
        "currency": "COP",
        "total": 100000,
        "taxes": [],
        "tip": 0
      },
      "user_id": "test_user",
      "metadata": {
        "reference": "1234567890_cart_01XXX"
      },
      "bold_code": "TEST_CODE",
      "payer_email": "test@example.com",
      "payment_method": "CARD"
    },
    "datacontenttype": "application/json"
  }'
```

#### Script 3: Simular Webhook de ADDI

```bash
# Webhook con pago aprobado
curl -X POST http://localhost:9000/hooks/addi/payment \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic dGVzdDp0ZXN0" \
  -d '{
    "orderId": "cart_01XXX",
    "applicationId": "test_app_123",
    "approvedAmount": "100000",
    "currency": "COP",
    "status": "APPROVED",
    "statusTimestamp": "1234567890"
  }'
```

---

### Verificar Logs

#### Logs del Buffer

Buscar en los logs del servidor:
```
✅ Payment result saved to Redis buffer for cart: cart_XXX
✅ Payment result saved to PostgreSQL buffer for cart: cart_XXX
```

#### Logs del Subscriber

Buscar en los logs:
```
📦 Order created payment buffer subscriber triggered - Order ID: order_XXX
✅ Pago capturado exitosamente desde buffer para orden order_XXX
```

#### Logs de Notificaciones

Buscar en los logs:
```
📱 Enviando notificación de pago capturado para orden order_XXX
✅ Notificación de pago capturado enviada exitosamente
```

---

### Verificar Base de Datos

#### PostgreSQL

```sql
-- Ver resultados en buffer
SELECT * FROM pending_payment_results 
ORDER BY created_at DESC 
LIMIT 10;

-- Ver errores en metadata de carritos
SELECT id, metadata->'payment_error' as payment_error 
FROM cart 
WHERE metadata->'payment_error' IS NOT NULL 
LIMIT 10;
```

#### Redis

```bash
# Conectar a Redis
redis-cli

# Ver todas las claves de buffer
KEYS payment_result:*

# Ver un resultado específico
GET payment_result:cart_01XXX

# Ver TTL de una clave
TTL payment_result:cart_01XXX
```

---

### Troubleshooting

#### Problema: Endpoint retorna 500

**Verificar:**
1. Servidor está corriendo
2. Base de datos está conectada
3. Ver logs del servidor para errores específicos

#### Problema: Buffer no guarda

**Verificar:**
1. Redis está disponible (si se usa)
2. Tabla `pending_payment_results` existe en PostgreSQL
3. Ver logs: `Error saving payment result`

#### Problema: Subscriber no se ejecuta

**Verificar:**
1. Evento `order.created` se está disparando
2. Subscriber está registrado (ver logs al iniciar)
3. Ver logs: `Order created payment buffer subscriber triggered`

#### Problema: Notificaciones no se envían

**Verificar:**
1. `NOTIFICATION_API_KEY` configurado
2. Servicio de notificaciones está disponible
3. Logs de `notifyPaymentCaptured()`

---

### Checklist de Verificación

Antes de probar, verificar:

- [ ] Servidor está corriendo
- [ ] Base de datos está conectada
- [ ] Redis está disponible (opcional pero recomendado)
- [ ] Variables de entorno configuradas
- [ ] Endpoints responden (health check)
- [ ] Logs están visibles

---

### Checklist de Pruebas

#### Backend
- [ ] Test 1: Webhook antes de orden - Pago exitoso
- [ ] Test 2: Webhook después de orden - Pago exitoso
- [ ] Test 3: Webhook antes - Pago rechazado
- [ ] Test 4: Múltiples webhooks simultáneos
- [ ] Test 5: Buffer con Redis vs PostgreSQL
- [ ] Test 6: TTL y expiración del buffer
- [ ] Test 7: Endpoint GET /store/cart/{cart_id}/order
- [ ] Test 8: Endpoint GET /store/payment-status/{cart_id}

#### Integración
- [ ] Flujo completo: Webhook → Buffer → Orden → Captura
- [ ] Flujo completo: Orden → Webhook → Captura
- [ ] Notificaciones WhatsApp en ambos flujos
- [ ] Manejo de errores y edge cases

#### Performance
- [ ] Tiempo de respuesta del buffer (< 100ms)
- [ ] Tiempo de captura desde buffer (< 2s)
- [ ] Carga concurrente de webhooks

---

## Estado General

**Backend:** ✅ 95% Completado
- Infraestructura: ✅ 100%
- Webhooks: ✅ 100%
- Subscriber: ✅ 100%
- Testing: 🟡 50% (manuales funcionando, automatizados pendientes)

**Frontend:** ⏳ 0% Completado
- Funciones de consulta: ⏳ Pendiente
- Componentes UI: ⏳ Pendiente

---

## Próximos Pasos Recomendados

### Prioridad Alta
1. Verificar flujo completo end-to-end
2. Tests automatizados del servicio de buffer
3. Tests de integración de webhooks

### Prioridad Media
4. Implementar funciones en frontend
5. Mejorar UX con polling inteligente

---

## Referencias

- **Notificaciones:** Ver `NOTIFICATIONS.md` para estrategia de notificaciones
- **Firebase:** Ver `FIREBASE.md` para integración de Crashlytics y Analytics

---

**Última actualización:** 2025-01-12
**Versión:** 1.0.0



