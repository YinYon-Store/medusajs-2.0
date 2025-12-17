# Sistema de Buffer de Webhooks de Pago

## 📋 Índice

1. [Problema y Solución](#problema-y-solución)
2. [Arquitectura](#arquitectura)
3. [Estado de Implementación](#estado-de-implementación)
4. [Especificación Técnica](#especificación-técnica)
5. [Endpoints Backend](#endpoints-backend)
6. [Flujos Detallados](#flujos-detallados)

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

Ver documento `WEBHOOK_BUFFER_FRONTEND.md` para detalles de implementación.

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

- **Frontend:** Ver `WEBHOOK_BUFFER_FRONTEND.md` para guía de implementación
- **Testing:** Ver `WEBHOOK_BUFFER_TESTING.md` para guía de pruebas
- **Notificaciones:** Ver `NOTIFICATIONS.md` para estrategia de notificaciones

---

**Última actualización:** 2025-01-12
**Versión:** 1.0.0

