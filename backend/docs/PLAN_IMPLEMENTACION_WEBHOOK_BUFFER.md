# Plan de Implementación: Buffer de Webhooks de Pago

## 📋 Resumen Ejecutivo

Este documento detalla el plan paso a paso para implementar un sistema de buffer temporal que almacene resultados de webhooks de pago cuando la orden aún no existe, permitiendo aprovechar el primer callback de las pasarelas de pago.

---

## 🎯 Objetivo

Implementar un sistema que:
1. Almacene resultados de webhooks cuando no existe orden aún
2. Permita consultar el estado de pago pendiente desde el frontend
3. Capture automáticamente el pago al crear la orden si hay resultado en buffer
4. Maneje errores de pago guardándolos en metadata del carrito

---

## 🏗️ Arquitectura de la Solución

### Componentes a Implementar

1. **Servicio de Buffer de Pagos** (`src/lib/payment-buffer-service.ts`)
   - Guardar resultados de webhooks
   - Consultar resultados por cart_id
   - Limpiar resultados procesados
   - Usar Redis (preferido) o PostgreSQL como almacenamiento

2. **Endpoints Backend Nuevos**
   - `GET /store/cart/{cart_id}/order` - Consultar orden por cart_id
   - `GET /store/payment-status/{cart_id}` - Consultar resultado pendiente

3. **Modificaciones a Webhooks Existentes**
   - `/hooks/wompi/payment/route.ts`
   - `/hooks/bold/payment/route.ts`
   - `/hooks/addi/payment/route.ts`

4. **Modificación al Flujo de Creación de Orden**
   - Interceptar creación de orden desde carrito
   - Verificar buffer antes de finalizar
   - Capturar pago si existe resultado

---

## 📝 Plan de Implementación Detallado

### FASE 1: Infraestructura del Buffer (Backend)

#### Paso 1.1: Crear Servicio de Buffer de Pagos

**Archivo:** `src/lib/payment-buffer-service.ts`

**Funcionalidades:**
- `savePaymentResult(cartId, result)` - Guardar resultado en buffer
- `getPaymentResult(cartId)` - Obtener resultado del buffer
- `clearPaymentResult(cartId)` - Limpiar resultado procesado
- `savePaymentError(cartId, error)` - Guardar error en metadata del carrito

**Estrategia de Almacenamiento:**
- **Opción A (Recomendada):** Redis con TTL de 30 minutos
  - Clave: `payment_result:cart_01XXX`
  - Valor: JSON con resultado del webhook
  - TTL: 1800 segundos (30 minutos)
  
- **Opción B (Fallback):** PostgreSQL con tabla `pending_payment_results`
  - Campos: cart_id, status, transaction_id, provider, metadata, created_at, expires_at
  - Índice en cart_id y expires_at

**Decisión:** Usar Redis si está disponible, sino PostgreSQL.

---

#### Paso 1.2: Crear Endpoint para Consultar Orden por Cart ID

**Archivo:** `src/api/store/cart/[cart_id]/order/route.ts`

**Funcionalidad:**
- Buscar orden asociada al cart_id usando `order_cart` table
- Retornar información básica de la orden (id, display_id, payment_status, status)
- Retornar 404 si no existe

**Request:**
```
GET /store/cart/cart_01XXX/order
Headers:
  x-publishable-api-key: pk_xxx
```

**Response (200):**
```json
{
  "order": {
    "id": "order_01XXX",
    "display_id": 12345,
    "payment_status": "captured",
    "status": "pending",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

**Response (404):**
```json
{
  "message": "No order found for this cart"
}
```

---

#### Paso 1.3: Crear Endpoint para Consultar Estado de Pago Pendiente

**Archivo:** `src/api/store/payment-status/[cart_id]/route.ts`

**Funcionalidad:**
- Consultar buffer de resultados de pago
- Retornar resultado si existe y no ha expirado
- Retornar 404 si no existe

**Request:**
```
GET /store/payment-status/cart_01XXX
Headers:
  x-publishable-api-key: pk_xxx
```

**Response (200):**
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

**Response (404):**
```json
{
  "has_payment_result": false,
  "message": "No pending payment result found"
}
```

---

### FASE 2: Modificar Webhooks Existentes

#### Paso 2.1: Modificar Webhook de Wompi

**Archivo:** `src/api/hooks/wompi/payment/route.ts`

**Cambios:**
1. Después de validar el webhook, buscar orden por cart_id
2. **Si orden existe:**
   - Procesar normalmente (capturar pago)
   - Retornar 200
3. **Si orden NO existe:**
   - Si status es "APPROVED": Guardar en buffer usando `savePaymentResult()`
   - Si status es "DECLINED"/"ERROR": Guardar error en metadata del carrito usando `savePaymentError()`
   - Retornar 200 (importante para evitar reintentos)

**Lógica:**
```typescript
// Después de extraer cartId y validar webhook...

const { data: orderCarts } = await query.graph({
  entity: "order_cart",
  fields: ["order_id"],
  filters: { cart_id: cartId },
});

if (orderCarts?.length) {
  // Orden existe - procesar normalmente
  // ... código existente ...
} else {
  // Orden NO existe - guardar en buffer
  if (transaction.status === "APPROVED") {
    await savePaymentResult(cartId, {
      status: "approved",
      transaction_id: transaction.id,
      provider: "wompi",
      amount: transaction.amount_in_cents / 100,
      currency: transaction.currency,
      metadata: { ...transaction }
    });
  } else {
    await savePaymentError(cartId, {
      status: "rejected",
      provider: "wompi",
      message: `Pago rechazado: ${transaction.status}`,
      transaction_id: transaction.id
    });
  }
  return res.status(200).json({ message: "Payment result saved, waiting for order" });
}
```

---

#### Paso 2.2: Modificar Webhook de Bold

**Archivo:** `src/api/hooks/bold/payment/route.ts`

**Cambios:**
1. Similar a Wompi, pero manejar tipos de evento:
   - `SALE_APPROVED` → Guardar en buffer si no hay orden
   - `SALE_REJECTED` → Guardar error en metadata
   - `VOID_APPROVED` → Guardar error en metadata

**Lógica:**
```typescript
// Después de validar y extraer cartId...

const { data: orderCarts } = await query.graph({
  entity: "order_cart",
  fields: ["order_id"],
  filters: { cart_id: cartId },
});

if (!orderCarts?.length) {
  // Orden NO existe
  if (type === "SALE_APPROVED") {
    await savePaymentResult(cartId, {
      status: "approved",
      transaction_id: data.payment_id,
      provider: "bold",
      amount: data.amount.total,
      currency: data.amount.currency,
      metadata: { ...data }
    });
  } else {
    await savePaymentError(cartId, {
      status: "rejected",
      provider: "bold",
      message: `Pago ${type}`,
      transaction_id: data.payment_id
    });
  }
  return res.status(200).json({ status: "received" });
}

// Orden existe - continuar con lógica existente...
```

---

#### Paso 2.3: Modificar Webhook de ADDI

**Archivo:** `src/api/hooks/addi/payment/route.ts`

**Cambios:**
1. Similar a los anteriores, pero manejar estados de ADDI:
   - `APPROVED` → Guardar en buffer si no hay orden
   - `REJECTED`, `ABANDONED`, `DECLINED`, `INTERNAL_ERROR` → Guardar error en metadata

**Lógica:**
```typescript
// Después de validar y extraer cartId...

const { data: orderCarts } = await query.graph({
  entity: "order_cart",
  fields: ["order_id"],
  filters: { cart_id: cartId },
});

if (!orderCarts?.length) {
  // Orden NO existe
  if (webhookData.status === "APPROVED") {
    await savePaymentResult(cartId, {
      status: "approved",
      transaction_id: webhookData.applicationId,
      provider: "addi",
      amount: parseFloat(webhookData.approvedAmount),
      currency: webhookData.currency,
      metadata: { ...webhookData }
    });
  } else {
    await savePaymentError(cartId, {
      status: webhookData.status.toLowerCase(),
      provider: "addi",
      message: getStatusMessage(webhookData.status),
      transaction_id: webhookData.applicationId
    });
  }
  return res.status(200).json(webhookData);
}

// Orden existe - continuar con lógica existente...
```

---

### FASE 3: Modificar Flujo de Creación de Orden

#### Paso 3.1: Crear Hook/Subscriber para Interceptar Creación de Orden

**Opción A: Usar Workflow de Medusa (Recomendado)**

**Archivo:** `src/workflows/complete-cart-with-payment-buffer.ts`

**Funcionalidad:**
- Interceptar el workflow de completar carrito
- Después de crear la orden, verificar buffer
- Si hay resultado aprobado, capturar pago inmediatamente
- Limpiar buffer y metadata de errores

**Lógica:**
```typescript
import { createWorkflow, transform } from "@medusajs/framework/workflows-sdk";
import { completeCartWorkflow } from "@medusajs/framework/core-flows";

export const completeCartWithPaymentBufferWorkflow = createWorkflow(
  "complete-cart-with-payment-buffer",
  function (input: { cart_id: string }) {
    // 1. Completar carrito (crear orden)
    const { order } = completeCartWorkflow.runAsStep({ input: { id: input.cart_id } });
    
    // 2. Verificar buffer de pago
    const paymentResult = getPaymentResultStep.runAsStep({ 
      input: { cart_id: input.cart_id } 
    });
    
    // 3. Si hay resultado aprobado, capturar pago
    const captured = capturePaymentIfApprovedStep.runAsStep({
      input: {
        order_id: order.id,
        payment_result: paymentResult
      }
    });
    
    // 4. Limpiar buffer
    clearPaymentResultStep.runAsStep({ input: { cart_id: input.cart_id } });
    
    return { order, payment_captured: captured };
  }
);
```

**Opción B: Usar Subscriber (Más Simple)**

**Archivo:** `src/subscribers/order-created-payment-buffer.ts`

**Funcionalidad:**
- Escuchar evento `order.created`
- Verificar buffer de pago
- Capturar pago si existe resultado
- Limpiar buffer

**Lógica:**
```typescript
export default async function orderCreatedPaymentBufferHandler({
  event: { data },
  container,
}: SubscriberArgs<any>) {
  const order = data;
  const cartId = order.cart_id; // O buscar en order_cart table
  
  // Verificar buffer
  const paymentResult = await getPaymentResult(cartId);
  
  if (paymentResult && paymentResult.status === "approved") {
    // Capturar pago
    const paymentModule = container.resolve(Modules.PAYMENT);
    // ... lógica de captura ...
    
    // Limpiar buffer
    await clearPaymentResult(cartId);
  }
}
```

**Decisión:** Usar Subscriber por simplicidad inicial, migrar a Workflow si es necesario.

---

#### Paso 3.2: Modificar Endpoint de Completar Carrito (si existe)

**Archivo:** Buscar endpoint que completa carrito (puede estar en Medusa core)

**Funcionalidad:**
- Si existe endpoint custom, agregar verificación de buffer después de crear orden
- Si no existe, el subscriber se encargará

---

### FASE 4: Testing y Validación

#### Paso 4.1: Tests Unitarios

**Archivos:**
- `src/lib/__tests__/payment-buffer-service.test.ts`
- `src/api/store/__tests__/cart-order.test.ts`
- `src/api/store/__tests__/payment-status.test.ts`

**Casos de Prueba:**
1. Guardar resultado en buffer
2. Consultar resultado del buffer
3. Limpiar resultado del buffer
4. Expiración automática (TTL)
5. Guardar error en metadata del carrito

---

#### Paso 4.2: Tests de Integración

**Archivos:**
- `src/api/hooks/__tests__/wompi-webhook-buffer.test.ts`
- `src/api/hooks/__tests__/bold-webhook-buffer.test.ts`
- `src/api/hooks/__tests__/addi-webhook-buffer.test.ts`

**Casos de Prueba:**
1. Webhook llega antes de crear orden → Se guarda en buffer
2. Webhook llega después de crear orden → Se procesa normalmente
3. Orden creada con resultado en buffer → Pago capturado automáticamente
4. Webhook rechazado → Error guardado en metadata

---

#### Paso 4.3: Tests End-to-End

**Escenarios:**
1. **Escenario A:** Webhook antes de orden
   - Usuario inicia pago
   - Webhook llega con `approved`
   - Webhook guarda en buffer
   - Usuario vuelve y crea orden
   - Orden se crea con pago capturado

2. **Escenario B:** Webhook después de orden
   - Usuario crea orden
   - Webhook llega después
   - Webhook procesa normalmente

3. **Escenario C:** Pago rechazado
   - Webhook llega con `rejected`
   - Error guardado en metadata
   - Frontend muestra error

---

### FASE 5: Frontend (Opcional - Para Implementación Completa)

#### Paso 5.1: Función para Consultar Orden por Cart ID

**Archivo:** `frontend/src/lib/data/cart.ts` (ajustar ruta según estructura)

**Funcionalidad:**
```typescript
export async function getOrderByCartId(cartId: string) {
  // Llamar a GET /store/cart/{cart_id}/order
}
```

---

#### Paso 5.2: Función para Consultar Estado de Pago Pendiente

**Archivo:** `frontend/src/lib/data/payment.ts` (ajustar ruta según estructura)

**Funcionalidad:**
```typescript
export async function getPendingPaymentStatus(cartId: string) {
  // Llamar a GET /store/payment-status/{cart_id}
}
```

---

#### Paso 5.3: Modificar Componente de Checkout

**Archivo:** `frontend/src/modules/checkout/components/review/index.tsx` (ajustar ruta)

**Funcionalidad:**
- Al volver de pasarela, consultar orden
- Si no existe, consultar buffer
- Si hay resultado, crear orden (el backend capturará automáticamente)
- Si no hay resultado, hacer polling corto antes de crear orden

---

## 🔧 Consideraciones Técnicas

### Almacenamiento del Buffer

**Redis (Preferido):**
- Ventajas: TTL automático, rápido, no requiere migraciones
- Desventajas: Requiere Redis disponible
- Implementación: Usar cliente Redis con `SETEX` para TTL

**PostgreSQL (Fallback):**
- Ventajas: Siempre disponible, persistente
- Desventajas: Requiere migración, limpieza manual
- Implementación: Tabla `pending_payment_results` con job de limpieza

### TTL y Limpieza

- **TTL:** 30 minutos (1800 segundos)
- **Limpieza:** Automática con Redis TTL, o job cada hora para PostgreSQL

### Idempotencia

- Usar `transaction_id` como clave única cuando sea posible
- Evitar procesar el mismo webhook múltiples veces

### Logging

- Loggear todos los eventos importantes:
  - Webhook recibido sin orden → Guardado en buffer
  - Orden creada con resultado en buffer → Pago capturado
  - Buffer consultado desde frontend

---

## 📊 Métricas a Monitorear

1. **Tasa de webhooks guardados en buffer** (objetivo: < 20%)
2. **Tiempo promedio entre webhook y creación de orden** (objetivo: < 10s)
3. **Tasa de aprovechamiento del primer webhook** (objetivo: > 80%)
4. **Tasa de órdenes con pago capturado desde buffer** (objetivo: > 70%)

---

## 🚀 Orden de Implementación Recomendado

1. **FASE 1** - Infraestructura del Buffer (Paso 1.1, 1.2, 1.3)
2. **FASE 2** - Modificar Webhooks (Paso 2.1, 2.2, 2.3)
3. **FASE 3** - Modificar Flujo de Orden (Paso 3.1, 3.2)
4. **FASE 4** - Testing (Paso 4.1, 4.2, 4.3)
5. **FASE 5** - Frontend (Opcional, si se requiere)

---

## ⚠️ Riesgos y Mitigaciones

### Riesgo 1: Buffer lleno o Redis caído
**Mitigación:** Fallback a PostgreSQL, alertas de monitoreo

### Riesgo 2: Race condition entre webhook y creación de orden
**Mitigación:** Usar locks o verificar orden antes de guardar en buffer

### Riesgo 3: Múltiples webhooks para el mismo cart_id
**Mitigación:** Usar `transaction_id` como clave única, actualizar en lugar de crear

### Riesgo 4: Buffer no consultado al crear orden
**Mitigación:** Testing exhaustivo, logging detallado

---

## 📝 Checklist de Implementación

### Backend
- [ ] Crear servicio de buffer de pagos
- [ ] Crear endpoint `GET /store/cart/{cart_id}/order`
- [ ] Crear endpoint `GET /store/payment-status/{cart_id}`
- [ ] Modificar webhook de Wompi
- [ ] Modificar webhook de Bold
- [ ] Modificar webhook de ADDI
- [ ] Crear subscriber para capturar pago desde buffer
- [ ] Agregar logging y métricas
- [ ] Tests unitarios
- [ ] Tests de integración

### Frontend (Opcional)
- [ ] Función `getOrderByCartId()`
- [ ] Función `getPendingPaymentStatus()`
- [ ] Modificar componente de checkout
- [ ] Agregar polling inteligente
- [ ] Manejo de errores de pago en UI

---

## 📚 Referencias

- Documento original: `docs/SOLUCION_WEBHOOK_CHECKOUT.md`
- Webhooks actuales: `src/api/hooks/{provider}/payment/route.ts`
- Configuración Redis: `medusa-config.js`

---

**Última actualización:** 2024-01-01
**Versión:** 1.0.0


