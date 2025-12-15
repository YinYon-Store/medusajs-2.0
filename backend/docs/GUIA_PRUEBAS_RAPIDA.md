# Guía Rápida de Pruebas - Sistema de Buffer de Webhooks

## 🚀 Inicio Rápido

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

## 🧪 Pruebas Rápidas

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

---

## 📝 Usar el Script de Pruebas

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

## 🔍 Verificar Logs

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

## 🐛 Troubleshooting Rápido

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

---

## 📊 Verificar Base de Datos

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

## ✅ Checklist de Verificación

Antes de probar, verificar:

- [ ] Servidor está corriendo
- [ ] Base de datos está conectada
- [ ] Redis está disponible (opcional pero recomendado)
- [ ] Variables de entorno configuradas
- [ ] Endpoints responden (health check)
- [ ] Logs están visibles

---

**Última actualización:** 2024-01-01


