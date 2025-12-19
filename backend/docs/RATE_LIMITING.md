# Rate Limiting y Seguridad - Documentación Completa

## 📋 Resumen

Sistema completo de rate limiting distribuido con Redis, protección de endpoints críticos, y límites de payload y tiempo de respuesta. Todos los límites están configurados mediante **variables de entorno**.

---

## 🎯 Características Implementadas

- ✅ Rate limiting distribuido con Redis
- ✅ Fallback a memoria si Redis no está disponible
- ✅ Protección de endpoints críticos (webhooks, admin, store)
- ✅ Límites de tamaño de payload
- ✅ Request timeouts
- ✅ Headers estándar de rate limit (X-RateLimit-*)
- ✅ Configuración mediante variables de entorno

---

## 🔒 Estrategias de Identificación

**IMPORTANTE:** Los límites de "req por minuto" dependen de la estrategia de identificación:

| Tipo de Endpoint | Identificación | Ejemplo | Ventajas | Desventajas |
|-----------------|----------------|---------|----------|-------------|
| **Store** (`/store/*`) | **POR IP** | 100 req/min por IP | Funciona sin autenticación | Usuarios detrás de NAT comparten límite |
| **Admin** (`/admin/*`) | **POR USUARIO** | 60 req/min por usuario | Límite individual preciso | Requiere JWT válido |
| **Webhooks** (`/hooks/*`) | **POR IP** | 10 req/min por IP | Limita por origen del webhook | Ya tienen autenticación adicional |
| **Search** (`/store/search`) | **POR IP** | 30 req/min por IP | Funciona sin autenticación | Usuarios detrás de NAT comparten límite |

**Ejemplo práctico:**
- Si un endpoint tiene límite de **100 req/min POR IP**, y 10 usuarios están detrás de la misma IP (NAT corporativo), todos comparten ese límite de 100.
- Si un endpoint tiene límite de **60 req/min POR USUARIO**, cada admin autenticado tiene su propio límite independiente.

---

## 📦 Componentes Implementados

### 1. Servicio de Rate Limiting
**Archivo:** `src/lib/rate-limit-service.ts`

- Rate limiting distribuido con Redis
- Fallback a memoria si Redis no está disponible
- Soporte para Fixed Window y Sliding Window
- Múltiples estrategias de identificación (IP, User, API Key)
- Operaciones atómicas de Redis para consistencia

### 2. Middlewares
**Archivos:** `src/lib/middlewares/*.ts`

- **Rate Limit Middleware:** Aplica rate limiting, agrega headers, retorna 429
- **Payload Size Middleware:** Valida tamaño máximo, retorna 413
- **Request Timeout Middleware:** Establece timeout, retorna 504

### 3. Configuración
**Archivo:** `src/api/middlewares.ts`

Aplica middlewares a rutas específicas:
- **Webhooks** (`/hooks/*/payment`): 10 req/min por IP, 50KB, 5s timeout
- **Admin** (`/admin/*`): 60 req/min por usuario, 1MB, 30s timeout
- **Search** (`/store/search`): 30 req/min por IP, 10KB, 3s timeout
- **Store** (`/store/*`): 100 req/min por IP, 500KB, 10s timeout

---

## 🔧 Variables de Entorno

### Todas las variables son opcionales (tienen valores por defecto)

### Rate Limiting

```bash
# Habilitación
RATE_LIMIT_ENABLED=true

# Webhooks (por IP) - 10 req/min por defecto
RATE_LIMIT_WEBHOOK_WINDOW_MS=60000
RATE_LIMIT_WEBHOOK_MAX_REQUESTS=10

# Admin (por usuario) - 60 req/min por defecto
RATE_LIMIT_ADMIN_WINDOW_MS=60000
RATE_LIMIT_ADMIN_MAX_REQUESTS=60

# Store (por IP) - 100 req/min por defecto
RATE_LIMIT_STORE_WINDOW_MS=60000
RATE_LIMIT_STORE_MAX_REQUESTS=100

# Search (por IP) - 30 req/min por defecto
RATE_LIMIT_SEARCH_WINDOW_MS=60000
RATE_LIMIT_SEARCH_MAX_REQUESTS=30
```

### Tamaño de Payload (en bytes)

```bash
PAYLOAD_MAX_SIZE_WEBHOOK=51200      # 50KB (por defecto)
PAYLOAD_MAX_SIZE_ADMIN=1048576      # 1MB (por defecto)
PAYLOAD_MAX_SIZE_STORE=512000       # 500KB (por defecto)
PAYLOAD_MAX_SIZE_SEARCH=10240       # 10KB (por defecto)
```

### Request Timeouts (en milisegundos)

```bash
REQUEST_TIMEOUT_WEBHOOK=5000        # 5 segundos (por defecto)
REQUEST_TIMEOUT_ADMIN=30000         # 30 segundos (por defecto)
REQUEST_TIMEOUT_STORE=10000         # 10 segundos (por defecto)
REQUEST_TIMEOUT_SEARCH=3000         # 3 segundos (por defecto)
```

### Ejemplo Completo para .env

```bash
# ============================================================================
# RATE LIMITING CONFIGURATION
# ============================================================================

RATE_LIMIT_ENABLED=true

RATE_LIMIT_WEBHOOK_WINDOW_MS=60000
RATE_LIMIT_WEBHOOK_MAX_REQUESTS=10

RATE_LIMIT_ADMIN_WINDOW_MS=60000
RATE_LIMIT_ADMIN_MAX_REQUESTS=60

RATE_LIMIT_STORE_WINDOW_MS=60000
RATE_LIMIT_STORE_MAX_REQUESTS=100

RATE_LIMIT_SEARCH_WINDOW_MS=60000
RATE_LIMIT_SEARCH_MAX_REQUESTS=30

PAYLOAD_MAX_SIZE_WEBHOOK=51200
PAYLOAD_MAX_SIZE_ADMIN=1048576
PAYLOAD_MAX_SIZE_STORE=512000
PAYLOAD_MAX_SIZE_SEARCH=10240

REQUEST_TIMEOUT_WEBHOOK=5000
REQUEST_TIMEOUT_ADMIN=30000
REQUEST_TIMEOUT_STORE=10000
REQUEST_TIMEOUT_SEARCH=3000
```

---

## 📊 Razonamiento de Tamaños de Payload

### Webhooks: 50KB
- **Análisis:** Payloads reales de ADDI (~200-500 bytes), Wompi (~800-1500 bytes), Bold (~1-2KB)
- **Razonamiento:** Webhooks de pago son pequeños; 50KB es margen de seguridad 10x mayor
- **Protección:** Previene payloads maliciosos sin afectar operaciones legítimas

### Admin: 1MB
- **Análisis:** Endpoints actuales usan ~200 bytes, pero futuras operaciones pueden incluir importación, actualizaciones masivas
- **Razonamiento:** Permite operaciones administrativas complejas sin ser excesivo
- **Estándar:** APIs administrativas típicamente permiten 1-10MB

### Store: 500KB
- **Análisis:** Carrito típico ~10-50KB; carrito grande (100 items) ~100-200KB
- **Razonamiento:** Permite carritos grandes legítimos (hasta ~200 items) sin ser excesivo
- **Protección:** Previene carritos con miles de items maliciosos

### Search: 10KB
- **Análisis:** Query típica ~50-200 bytes; ya hay validación de 200 caracteres
- **Razonamiento:** 10KB es margen 20x mayor que cualquier query legítima
- **Estándar:** APIs de búsqueda típicamente limitan a 1-10KB

---

## 🚀 Uso

### Configuración Mínima

**No necesitas agregar ninguna variable** - el sistema funciona con valores por defecto.

### Personalización

Solo agrega variables si quieres cambiar límites específicos:

```bash
# Ejemplo: Aumentar límite de webhooks a 20 req/min
RATE_LIMIT_WEBHOOK_MAX_REQUESTS=20

# Ejemplo: Permitir payloads de 2MB en admin
PAYLOAD_MAX_SIZE_ADMIN=2097152

# Ejemplo: Aumentar timeout de admin a 60 segundos
REQUEST_TIMEOUT_ADMIN=60000
```

### Deshabilitar Rate Limiting

```bash
RATE_LIMIT_ENABLED=false
```

---

## 📈 Headers de Respuesta

El middleware agrega automáticamente:

- `X-RateLimit-Limit`: Límite máximo de requests
- `X-RateLimit-Remaining`: Requests restantes
- `X-RateLimit-Reset`: Timestamp ISO del reseteo

**Ejemplo:**
```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 25
X-RateLimit-Reset: 2024-01-15T10:30:00.000Z
```

---

## ⚠️ Códigos de Error

- **429 Too Many Requests**: Se excedió el límite de rate limiting
- **413 Payload Too Large**: El payload excede el tamaño máximo
- **504 Gateway Timeout**: El request excedió el timeout

---

## 🔄 Fallback

Si Redis no está disponible:
- El sistema automáticamente usa un store en memoria
- Se registra un warning en los logs
- El rate limiting sigue funcionando (pero no es distribuido)

---

## 🧪 Testing

```bash
# Probar rate limiting en search
for i in {1..35}; do
  curl -X POST http://localhost:9000/store/search \
    -H "Content-Type: application/json" \
    -d '{"query":"test"}'
done

# Deberías recibir 429 después de 30 requests
```

---

## 📁 Archivos Creados/Modificados

### Nuevos Archivos
- `src/lib/rate-limit-service.ts`
- `src/lib/middlewares/rate-limit-middleware.ts`
- `src/lib/middlewares/payload-size-middleware.ts`
- `src/lib/middlewares/request-timeout-middleware.ts`
- `src/lib/middlewares/index.ts`
- `src/api/middlewares.ts`

### Archivos Modificados
- `src/lib/constants.ts` - Agregadas constantes de rate limiting
- `src/api/store/search/route.ts` - Removido rate limiting en memoria

---

## ✅ Estado de Implementación

- ✅ Rate limiting distribuido con Redis
- ✅ Middleware centralizado
- ✅ Protección de endpoints críticos
- ✅ Límites de payload
- ✅ Request timeouts
- ✅ Variables de entorno configurables
- ✅ Fallback a memoria si Redis falla
- ✅ Headers estándar de rate limit
- ✅ Migración de rate limiting existente

**¡Implementación completa!** 🎉



