# Estrategia de Notificaciones WhatsApp

## 📋 Resumen

Este documento explica dónde y cuándo se envían las notificaciones de WhatsApp para eventos de pago en el sistema.

---

## 🎯 Estrategia de Notificaciones

### Principio General

**Las notificaciones de WhatsApp se envían cuando se captura un pago, sin importar si viene del webhook o del buffer.**

---

## 📍 Dónde se Envían las Notificaciones

### 1. **Webhooks de Proveedores de Pago** (Flujo Normal)

**Cuándo:** Cuando el webhook llega **después** de que se crea la orden.

**Archivos:**
- `src/api/hooks/wompi/payment/route.ts` - ❌ **NO tiene notificaciones actualmente**
- `src/api/hooks/bold/payment/route.ts` - ✅ Envía notificación
- `src/api/hooks/addi/payment/route.ts` - ✅ Envía notificación

**Flujo:**
1. Webhook llega con pago aprobado
2. Se busca la orden por `cart_id`
3. **Si orden existe:**
   - Se captura el pago
   - Se llama `notifyPaymentCaptured()` ✅
   - Se envía notificación WhatsApp
4. **Si orden NO existe:**
   - Se guarda en buffer
   - **NO se envía notificación** (no hay orden aún)

**Código ejemplo (Bold):**
```typescript
// En webhook, después de capturar pago
if (order) {
  await notifyPaymentCaptured(order, type, amount, reference, 'bold', time);
}
```

---

### 2. **Subscriber de Orden Creada** (Flujo con Buffer)

**Cuándo:** Cuando se crea una orden y hay un resultado de pago en el buffer.

**Archivo:**
- `src/subscribers/order-created-payment-buffer.ts`

**Flujo:**
1. Se crea una orden (evento `order.created`)
2. El subscriber se ejecuta
3. Busca `cart_id` asociado a la orden
4. Consulta el buffer de resultados de pago
5. **Si hay resultado aprobado:**
   - Se captura el pago automáticamente
   - Se llama `notifyPaymentCaptured()` ✅
   - Se envía notificación WhatsApp
   - Se limpia el buffer

**Código:**
```typescript
// En subscriber, después de capturar desde buffer
await notifyPaymentCaptured(
  order,
  status,
  paymentResult.amount,
  paymentResult.transaction_id,
  provider,
  paymentResult.webhook_received_at
);
```

---

## 🔄 Flujos Completos

### Escenario A: Webhook Llega DESPUÉS de Crear Orden

```
1. Usuario crea orden
2. Webhook llega con pago aprobado
3. Webhook busca orden → ✅ Existe
4. Webhook captura pago
5. Webhook llama notifyPaymentCaptured() → ✅ Notificación enviada
```

**Notificación enviada por:** Webhook del proveedor

---

### Escenario B: Webhook Llega ANTES de Crear Orden

```
1. Webhook llega con pago aprobado
2. Webhook busca orden → ❌ No existe
3. Webhook guarda resultado en buffer
4. Usuario crea orden (evento order.created)
5. Subscriber se ejecuta
6. Subscriber consulta buffer → ✅ Hay resultado
7. Subscriber captura pago
8. Subscriber llama notifyPaymentCaptured() → ✅ Notificación enviada
9. Subscriber limpia buffer
```

**Notificación enviada por:** Subscriber `order-created-payment-buffer`

---

### Escenario C: Webhook Llega DESPUÉS, pero Orden ya Tiene Pago Capturado

```
1. Usuario crea orden
2. Subscriber captura pago desde buffer
3. Subscriber envía notificación → ✅ Notificación enviada
4. Webhook llega después (reintento)
5. Webhook busca orden → ✅ Existe
6. Webhook intenta capturar → ❌ Ya capturado
7. Webhook NO envía notificación (evita duplicados)
```

**Notificación enviada por:** Subscriber (solo una vez)

---

## 📊 Tabla de Responsabilidades

| Evento | Quién Envía Notificación | Cuándo |
|--------|-------------------------|--------|
| **Pago capturado desde webhook** | Webhook del proveedor | Cuando webhook procesa pago y orden existe |
| **Pago capturado desde buffer** | Subscriber `order-created-payment-buffer` | Cuando se crea orden con resultado en buffer |
| **Pago rechazado** | Webhook del proveedor | Cuando webhook procesa rechazo y orden existe |
| **Orden creada** | Subscriber `order-placed` | Cuando se crea cualquier orden (sin pago) |

---

## ⚠️ Consideraciones Importantes

### 1. Evitar Duplicados

- Los webhooks verifican si el pago ya está capturado antes de enviar notificación
- El subscriber solo se ejecuta una vez por orden creada
- El buffer se limpia después de procesar

### 2. Wompi

- **Actual:** Wompi NO envía notificaciones de pago capturado
- **Con buffer:** El subscriber enviará notificación cuando capture desde buffer
- **Recomendación:** Agregar notificaciones en webhook de Wompi también

### 3. Errores de Notificación

- Si falla la notificación, **NO se bloquea** el flujo de captura de pago
- Los errores se loguean pero no detienen el proceso
- Se puede reintentar manualmente desde el admin

---

## 🔧 Funciones de Notificación

### `notifyPaymentCaptured()`

**Ubicación:** `src/lib/notification-service.ts`

**Parámetros:**
- `order`: Objeto de orden
- `status`: Estado del pago (APPROVED, SALE_APPROVED, etc.)
- `amount`: Monto del pago
- `reference`: ID de transacción
- `provider`: Proveedor ('bold', 'addi', 'wompi')
- `time`: Timestamp del evento (opcional)

**Uso:**
```typescript
await notifyPaymentCaptured(
  order,
  "APPROVED",
  100000,
  "txn_123456",
  "wompi",
  "2024-01-01T00:00:00Z"
);
```

---

## 📝 Checklist de Implementación

### Webhooks
- [x] Bold: Envía notificación cuando captura pago
- [x] ADDI: Envía notificación cuando captura pago
- [ ] Wompi: **PENDIENTE** - Agregar notificación cuando capture pago

### Subscriber
- [x] `order-created-payment-buffer`: Envía notificación cuando captura desde buffer
- [x] Soporta todos los proveedores (bold, addi, wompi)

### Servicio de Notificaciones
- [x] `notifyPaymentCaptured()` actualizado para soportar 'wompi'
- [x] Manejo de errores sin bloquear flujo

---

## 🚀 Próximos Pasos

1. **Agregar notificaciones en webhook de Wompi** (cuando procese pagos normalmente)
2. **Monitorear logs** para verificar que no haya duplicados
3. **Agregar métricas** de notificaciones enviadas por cada flujo

---

**Última actualización:** 2024-01-01
**Versión:** 1.0.0

