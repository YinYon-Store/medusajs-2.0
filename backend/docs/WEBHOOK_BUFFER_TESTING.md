# Guía de Pruebas: Sistema de Buffer de Webhooks

## 📋 Índice

1. [Inicio Rápido](#inicio-rápido)
2. [Pruebas Rápidas](#pruebas-rápidas)
3. [Escenarios de Prueba Completos](#escenarios-de-prueba-completos)
4. [Scripts de Prueba](#scripts-de-prueba)
5. [Troubleshooting](#troubleshooting)

---

## Inicio Rápido

### 1. Verificar que el servidor esté corriendo

```bash
# En desarrollo
pnpm dev

# O en producción
pnpm start:server
```

### 2. Verificar variables de entorno

```bash
# Verificar que estas variables estén configuradas
echo $REDIS_URL          # Opcional, pero recomendado
echo $DATABASE_URL       # Requerido
echo $NOTIFICATION_API_KEY  # Para notificaciones WhatsApp
echo $STORE_PUBLISHABLE_API_KEY  # Para endpoints de store
```

---

## Pruebas Rápidas

### Prueba 1: Verificar Endpoints

```bash
# 1. Consultar orden (debe retornar 404 si no existe)
curl -X GET http://localhost:9000/store/cart/cart_test_123/order \
  -H "x-publishable-api-key: $STORE_PUBLISHABLE_API_KEY"

# 2. Consultar buffer (debe retornar 404 si no existe)
curl -X GET http://localhost:9000/store/payment-status/cart_test_123 \
  -H "x-publishable-api-key: $STORE_PUBLISHABLE_API_KEY"
```

### Prueba 2: Simular Webhook (Sin Orden)

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

### Prueba 3: Verificar Buffer

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

### Usar el Script de Pruebas

```bash
# Instalar dependencias si es necesario (fetch está en Node 18+)
# Si usas Node < 18, instalar: pnpm add node-fetch

# Ejecutar test 1: Webhook antes de orden
node scripts/test-webhook-buffer.js 1

# Ejecutar test 2: Consultar buffer
node scripts/test-webhook-buffer.js 2

# Ejecutar test 3: Consultar orden
node scripts/test-webhook-buffer.js 3 cart_01XXX

# Ejecutar test 4: Webhook con rechazo
node scripts/test-webhook-buffer.js 4
```

---

## Escenarios de Prueba Completos

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

## Scripts de Prueba

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

## Verificar Logs

### Logs del Buffer

Buscar en los logs del servidor:
```
✅ Payment result saved to Redis buffer for cart: cart_XXX
✅ Payment result saved to PostgreSQL buffer for cart: cart_XXX
```

### Logs del Subscriber

Buscar en los logs:
```
📦 Order created payment buffer subscriber triggered - Order ID: order_XXX
✅ Pago capturado exitosamente desde buffer para orden order_XXX
```

### Logs de Notificaciones

Buscar en los logs:
```
📱 Enviando notificación de pago capturado para orden order_XXX
✅ Notificación de pago capturado enviada exitosamente
```

---

## Verificar Base de Datos

### PostgreSQL

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

### Redis

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

## Troubleshooting

### Problema: Endpoint retorna 500

**Verificar:**
1. Servidor está corriendo
2. Base de datos está conectada
3. Ver logs del servidor para errores específicos

### Problema: Buffer no guarda

**Verificar:**
1. Redis está disponible (si se usa)
2. Tabla `pending_payment_results` existe en PostgreSQL
3. Ver logs: `Error saving payment result`

### Problema: Subscriber no se ejecuta

**Verificar:**
1. Evento `order.created` se está disparando
2. Subscriber está registrado (ver logs al iniciar)
3. Ver logs: `Order created payment buffer subscriber triggered`

### Problema: Notificaciones no se envían

**Verificar:**
1. `NOTIFICATION_API_KEY` configurado
2. Servicio de notificaciones está disponible
3. Logs de `notifyPaymentCaptured()`

---

## Checklist de Verificación

Antes de probar, verificar:

- [ ] Servidor está corriendo
- [ ] Base de datos está conectada
- [ ] Redis está disponible (opcional pero recomendado)
- [ ] Variables de entorno configuradas
- [ ] Endpoints responden (health check)
- [ ] Logs están visibles

---

## Checklist de Pruebas

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

**Última actualización:** 2025-01-12
**Versión:** 1.0.0

