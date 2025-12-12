# Implementación Frontend: Sistema de Buffer de Webhooks

## 📋 Resumen de lo Implementado en Backend

### ✅ Infraestructura Completada

#### 1. Servicio de Buffer de Pagos
- **Archivo:** `src/lib/payment-buffer-service.ts`
- **Funcionalidad:** Almacena resultados de webhooks cuando no existe orden aún
- **Almacenamiento:** Redis (preferido) o PostgreSQL (fallback)
- **TTL:** 30 minutos

#### 2. Endpoints Backend Disponibles

**GET `/store/cart/{cart_id}/order`**
- Consulta si un carrito tiene una orden asociada
- **Response 200:** `{ order: { id, display_id, payment_status, status, created_at } }`
- **Response 404:** `{ message: "No order found for this cart" }`

**GET `/store/payment-status/{cart_id}`**
- Consulta resultado de pago pendiente en el buffer
- **Response 200:** `{ has_payment_result: true, payment_result: { status, transaction_id, provider, amount, currency, webhook_received_at } }`
- **Response 404:** `{ has_payment_result: false, message: "No pending payment result found" }`

#### 3. Webhooks Modificados
- **Wompi, Bold, ADDI:** Ahora guardan resultados en buffer si no existe orden
- Guardan errores en `cart.metadata.payment_error` si el pago es rechazado

#### 4. Subscriber Automático
- **Archivo:** `src/subscribers/order-created-payment-buffer.ts`
- Escucha evento `order.created`
- Si hay resultado en buffer, captura el pago automáticamente
- Envía notificación WhatsApp automáticamente
- Limpia el buffer después de procesar

---

## 🎯 Objetivo del Frontend

Mejorar la experiencia del usuario al volver de la pasarela de pagos:
1. Consultar si ya existe una orden antes de crear una nueva
2. Consultar el buffer de resultados de pago
3. Si hay resultado exitoso, crear la orden (el backend capturará automáticamente)
4. Si no hay resultado, hacer polling corto antes de crear orden
5. Mostrar errores de pago previos en el checkout

---

## 📝 Paso a Paso: Implementación Frontend

### PASO 1: Crear Función para Consultar Orden por Cart ID

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

### PASO 2: Crear Función para Consultar Estado de Pago Pendiente

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

### PASO 3: Modificar Componente de Checkout (Review)

**Archivo:** `src/modules/checkout/components/review/index.tsx` (ajustar ruta según tu estructura)

**Funcionalidad a agregar:**

#### 3.1. Función para Manejar el Retorno de la Pasarela

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

#### 3.2. Llamar esta función cuando el usuario vuelve de la pasarela

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

### PASO 4: Verificar Errores de Pago en Metadata del Carrito

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

### PASO 5: Componente para Mostrar Errores de Pago

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
                // Esto debería llamar a un endpoint que limpie el metadata
                // O simplemente refrescar el carrito
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

### PASO 6: Agregar Polling en Página de Confirmación de Orden

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

## 🔄 Flujo Completo del Frontend

### Escenario A: Usuario Vuelve de Pasarela con Pago Exitoso

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

### Escenario B: Usuario Vuelve pero Webhook Aún No Llega

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

### Escenario C: Pago Rechazado

```
1. Webhook llega con rechazo → Guarda error en cart.metadata.payment_error
2. Usuario vuelve de pasarela
3. Componente Review detecta error en metadata
4. Muestra PaymentErrorDisplay con mensaje de error
5. Bloquea botón "Completar orden"
6. Usuario puede intentar con otro método
```

---

## 📋 Checklist de Implementación Frontend

### Funciones de Consulta
- [ ] Crear `getOrderByCartId()` en `src/lib/data/cart.ts`
- [ ] Crear `getPendingPaymentStatus()` en `src/lib/data/payment.ts`
- [ ] Verificar que las variables de entorno estén configuradas

### Componente Review
- [ ] Agregar función `handlePaymentReturn()`
- [ ] Detectar cuando usuario vuelve de pasarela
- [ ] Implementar polling antes de crear orden
- [ ] Agregar `PaymentErrorDisplay` component
- [ ] Verificar errores en `cart.metadata.payment_error`
- [ ] Bloquear botón si hay error de pago

### Página de Confirmación
- [ ] Detectar parámetro `status=processing_payment`
- [ ] Implementar polling para verificar `payment_status`
- [ ] Mostrar mensajes de estado apropiados
- [ ] Manejar timeout después de 5 minutos

### Testing
- [ ] Probar flujo completo: Webhook antes de orden
- [ ] Probar flujo: Webhook después de orden
- [ ] Probar flujo: Pago rechazado
- [ ] Probar polling y timeouts

---

## 🔗 Endpoints Backend Disponibles

### Base URL
Usar: `process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL` o `process.env.NEXT_PUBLIC_BACKEND_URL`

### Headers Requeridos
```typescript
{
  "Content-Type": "application/json",
  "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
}
```

### Endpoints

1. **GET `/store/cart/{cart_id}/order`**
   - Consulta si existe orden para un carrito
   - 200: `{ order: { id, display_id, payment_status, status, created_at } }`
   - 404: `{ message: "No order found for this cart" }`

2. **GET `/store/payment-status/{cart_id}`**
   - Consulta resultado de pago pendiente en buffer
   - 200: `{ has_payment_result: true, payment_result: {...} }`
   - 404: `{ has_payment_result: false, message: "..." }`

---

## 📝 Notas Importantes

1. **Variables de Entorno Necesarias:**
   ```env
   NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000
   NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_xxx
   ```

2. **Timing:**
   - Esperar 2 segundos antes de consultar buffer (dar tiempo al webhook)
   - Polling corto: 4 intentos cada 2 segundos = 8 segundos máximo
   - Polling largo en confirmación: cada 3 segundos, máximo 5 minutos

3. **Manejo de Errores:**
   - Siempre manejar errores de red/timeout
   - No bloquear el flujo si falla la consulta al buffer
   - Permitir crear orden aunque no haya resultado en buffer

4. **UX:**
   - Mostrar loading states durante polling
   - Mensajes claros sobre el estado del pago
   - Opciones para contactar soporte si hay problemas

---

## 🚀 Orden de Implementación Recomendado

1. **PASO 1 y 2:** Crear funciones de consulta (más simple, base para todo)
2. **PASO 4 y 5:** Agregar detección y display de errores (mejora UX inmediata)
3. **PASO 3:** Implementar `handlePaymentReturn()` (flujo principal)
4. **PASO 6:** Agregar polling en página de confirmación (completa el flujo)

---

## 📚 Referencias

- Documento original: `docs/SOLUCION_WEBHOOK_CHECKOUT.md`
- Plan de implementación: `docs/PLAN_IMPLEMENTACION_WEBHOOK_BUFFER.md`
- Estado de implementación: `docs/ESTADO_IMPLEMENTACION.md`

---

**Última actualización:** 2025-01-12
**Versión:** 1.0.0

