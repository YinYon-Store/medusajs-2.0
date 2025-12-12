# Plan de Pruebas: Sistema de Buffer de Webhooks

## 📋 Objetivo

Validar que el sistema de buffer de webhooks funciona correctamente en todos los escenarios posibles.

---

## 🧪 Escenarios de Prueba

### Test 1: Webhook Llega ANTES de Crear Orden - Pago Exitoso

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

### Test 2: Webhook Llega DESPUÉS de Crear Orden - Pago Exitoso

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

### Test 3: Webhook Llega ANTES - Pago Rechazado

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

### Test 4: Múltiples Webhooks Simultáneos

**Objetivo:** Verificar idempotencia y manejo de reintentos.

**Pasos:**
1. Crear carrito
2. Enviar webhook 1 con `approved` → Guarda en buffer
3. Enviar webhook 2 con `approved` (reintento) → Actualiza buffer
4. Crear orden
5. Enviar webhook 3 con `approved` → Detecta orden existente, no duplica

**Resultado esperado:** ✅ Sin duplicados, pago procesado una sola vez

---

### Test 5: Buffer con Redis vs PostgreSQL

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

### Test 6: TTL y Expiración del Buffer

**Objetivo:** Verificar que los resultados expiran correctamente.

**Pasos:**
1. Guardar resultado en buffer
2. Esperar 30 minutos (o modificar TTL para prueba rápida)
3. Consultar buffer → Debe retornar 404
4. Intentar crear orden → No debe capturar desde buffer

**Resultado esperado:** ✅ Resultados expiran después de 30 minutos

---

### Test 7: Endpoint GET /store/cart/{cart_id}/order

**Objetivo:** Verificar que el endpoint funciona correctamente.

**Pasos:**
1. Crear carrito
2. **Sin orden:**
   - `GET /store/cart/{cart_id}/order` → 404
3. Crear orden
4. **Con orden:**
   - `GET /store/cart/{cart_id}/order` → 200 con datos de orden

**Resultado esperado:** ✅ Endpoint retorna correctamente según existencia de orden

---

### Test 8: Endpoint GET /store/payment-status/{cart_id}

**Objetivo:** Verificar que el endpoint consulta el buffer correctamente.

**Pasos:**
1. Crear carrito
2. **Sin resultado en buffer:**
   - `GET /store/payment-status/{cart_id}` → 404
3. Enviar webhook con `approved` (sin orden)
4. **Con resultado en buffer:**
   - `GET /store/payment-status/{cart_id}` → 200 con datos del resultado

**Resultado esperado:** ✅ Endpoint retorna resultado del buffer

---

## 🔧 Scripts de Prueba

### Script 1: Simular Webhook de Wompi

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

### Script 2: Simular Webhook de Bold

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

### Script 3: Simular Webhook de ADDI

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

### Script 4: Consultar Buffer

```bash
# Consultar estado de pago pendiente
curl -X GET http://localhost:9000/store/payment-status/cart_01XXX \
  -H "x-publishable-api-key: pk_test_xxx"
```

### Script 5: Consultar Orden por Cart ID

```bash
# Consultar si existe orden para un carrito
curl -X GET http://localhost:9000/store/cart/cart_01XXX/order \
  -H "x-publishable-api-key: pk_test_xxx"
```

---

## 📊 Checklist de Pruebas

### Backend
- [ ] Test 1: Webhook antes de orden - Pago exitoso
- [ ] Test 2: Webhook después de orden - Pago exitoso
- [ ] Test 3: Webhook antes - Pago rechazado
- [ ] Test 4: Múltiples webhooks simultáneos
- [ ] Test 5: Buffer con Redis vs PostgreSQL
- [ ] Test 6: TTL y expiración del buffer
- [ ] Test 7: Endpoint GET /store/cart/{cart_id}/order
- [ ] Test 8: Endpoint GET /store/payment-status/{cart_id}

### Integración
- [ ] Flujo completo: Webhook → Buffer → Orden → Captura
- [ ] Flujo completo: Orden → Webhook → Captura
- [ ] Notificaciones WhatsApp en ambos flujos
- [ ] Manejo de errores y edge cases

### Performance
- [ ] Tiempo de respuesta del buffer (< 100ms)
- [ ] Tiempo de captura desde buffer (< 2s)
- [ ] Carga concurrente de webhooks

---

## 🐛 Troubleshooting

### Problema: Buffer no guarda resultados

**Verificar:**
1. Redis está disponible o PostgreSQL tiene la tabla
2. Logs del servicio de buffer
3. Errores en consola

**Solución:**
```bash
# Verificar Redis
redis-cli ping

# Verificar tabla PostgreSQL
psql $DATABASE_URL -c "SELECT * FROM pending_payment_results LIMIT 5;"
```

### Problema: Subscriber no captura desde buffer

**Verificar:**
1. Evento `order.created` se está disparando
2. Subscriber está registrado (ver logs al iniciar)
3. Buffer tiene resultado para el cart_id

**Solución:**
```bash
# Ver logs del subscriber
# Buscar: "Order created payment buffer subscriber triggered"
```

### Problema: Notificaciones no se envían

**Verificar:**
1. `NOTIFICATION_API_KEY` configurado
2. Servicio de notificaciones está disponible
3. Logs de `notifyPaymentCaptured()`

**Solución:**
```bash
# Verificar configuración
echo $NOTIFICATION_API_KEY
echo $NOTIFICATION_SERVICE_URL
```

---

## 📝 Notas de Prueba

### Datos de Prueba

**Cart ID de ejemplo:** `cart_01HXXX`
**Order ID de ejemplo:** `order_01HXXX`
**Transaction ID de ejemplo:** `txn_test_123`

### Variables de Entorno Necesarias

```bash
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://...
NOTIFICATION_API_KEY=test_key
NOTIFICATION_SERVICE_URL=http://localhost:8080
```

---

**Última actualización:** 2024-01-01
**Versión:** 1.0.0

