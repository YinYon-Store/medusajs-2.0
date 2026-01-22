# Optimizaciones de Caché de Productos

## Problema
Tiempos de respuesta por encima de 400ms incluso con caché HIT.

## Optimizaciones Implementadas

### 1. Pipeline de Redis (Batch Operations)
**Antes:**
```typescript
await redis.setEx(cacheKey, ttl, JSON.stringify(data))
for (const productId of ids) {
  await redis.sAdd(indexKey, cacheKey)
  await redis.expire(indexKey, ttl)
}
```

**Después:**
```typescript
const pipeline = redis.multi()
pipeline.setEx(cacheKey, ttl, serializedData)
for (const productId of ids) {
  pipeline.sAdd(indexKey, cacheKey)
  pipeline.expire(indexKey, ttl)
}
await pipeline.exec()
```

**Beneficio:** Reduce round-trips a Redis de N+1 a 1, mejorando latencia significativamente.

### 2. Serialización Optimizada
**Antes:**
```typescript
await redis.setEx(cacheKey, ttl, JSON.stringify(data))
// ... más operaciones que serializan de nuevo
```

**Después:**
```typescript
const serializedData = JSON.stringify(data) // Una sola vez
pipeline.setEx(cacheKey, ttl, serializedData)
```

**Beneficio:** Evita múltiples serializaciones JSON innecesarias.

### 3. Cacheo Asíncrono (Non-blocking)
**Antes:**
```typescript
await productCacheService.set(cacheKey, response, productIds)
res.json(response) // Espera a que termine el cacheo
```

**Después:**
```typescript
setImmediate(async () => {
  await productCacheService.set(cacheKey, response, productIds)
})
res.json(response) // No espera el cacheo
```

**Beneficio:** La respuesta se envía inmediatamente, el cacheo ocurre en background.

### 4. Timeouts de Redis Optimizados
**Antes:**
```typescript
const client = createClient({ url: REDIS_URL })
```

**Después:**
```typescript
const client = createClient({
  url: REDIS_URL,
  socket: {
    connectTimeout: 5000,
    commandTimeout: 3000,
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
  },
  disableClientInfo: true
})
```

**Beneficio:** Reduce latencia de conexión y comandos lentos.

### 5. Manejo de Errores Mejorado
**Antes:**
```typescript
const parsed = JSON.parse(cached)
return parsed
```

**Después:**
```typescript
try {
  const parsed = JSON.parse(cached)
  return parsed
} catch (parseError) {
  await redis.del(cacheKey).catch(() => {})
  return null
}
```

**Beneficio:** Evita reintentos innecesarios con datos corruptos.

## Métricas Esperadas

### Antes de Optimizaciones
- Cache HIT: ~400-600ms
- Cache MISS: ~2400ms
- Redis round-trips: 1 + N (donde N = número de productos)

### Después de Optimizaciones
- Cache HIT: ~50-150ms (objetivo)
- Cache MISS: ~2400ms (sin cambios, pero cacheo no bloquea)
- Redis round-trips: 1 (siempre)

## Monitoreo

Para verificar las mejoras, revisa los logs:

```
[ProductsRoute] Cache HIT: products:cache:abc123 (45ms)
[ProductsRoute] Cache MISS: products:cache:def456 (2ms)
```

El tiempo entre paréntesis indica el tiempo de consulta a Redis.

## Optimizaciones Futuras (si aún es necesario)

### 1. Compresión de Respuestas Grandes
Si las respuestas son >100KB, considerar compresión:
```typescript
import { gzip, gunzip } from 'zlib'
import { promisify } from 'util'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

// Al guardar
const compressed = await gzipAsync(JSON.stringify(data))
await redis.setEx(cacheKey, ttl, compressed.toString('base64'))

// Al leer
const compressed = await redis.get(cacheKey)
const decompressed = await gunzipAsync(Buffer.from(compressed, 'base64'))
const parsed = JSON.parse(decompressed.toString())
```

### 2. Cacheo de Productos Individuales Selectivo
Solo cachear productos individuales si realmente se necesitan:
```typescript
// Solo si BUILD_FROM_INDIVIDUAL está habilitado Y hay pocos productos
if (BUILD_FROM_INDIVIDUAL && products.length < 100) {
  // cachear individuales
}
```

### 3. Connection Pooling
Si Redis está en red remota, considerar connection pooling:
```typescript
import { createPool } from 'generic-pool'

const pool = createPool({
  create: () => createClient({ url: REDIS_URL }),
  destroy: (client) => client.quit(),
  max: 10,
  min: 2
})
```

### 4. Redis Cluster
Para alta disponibilidad y mejor distribución:
```typescript
import { createCluster } from 'redis'

const cluster = createCluster({
  rootNodes: [
    { host: 'redis1', port: 6379 },
    { host: 'redis2', port: 6379 }
  ]
})
```

## Debugging

Para identificar cuellos de botella:

1. **Medir tiempo de Redis:**
```typescript
const start = Date.now()
const cached = await redis.get(cacheKey)
const redisTime = Date.now() - start
console.log(`Redis GET: ${redisTime}ms`)
```

2. **Medir tiempo de serialización:**
```typescript
const start = Date.now()
const serialized = JSON.stringify(data)
const serializeTime = Date.now() - start
console.log(`JSON.stringify: ${serializeTime}ms`)
```

3. **Medir tiempo de deserialización:**
```typescript
const start = Date.now()
const parsed = JSON.parse(cached)
const parseTime = Date.now() - start
console.log(`JSON.parse: ${parseTime}ms`)
```

## Checklist de Verificación

- [x] Pipeline de Redis implementado
- [x] Serialización optimizada (una sola vez)
- [x] Cacheo asíncrono (non-blocking)
- [x] Timeouts de Redis configurados
- [x] Manejo de errores mejorado
- [ ] Compresión (si es necesario)
- [ ] Connection pooling (si es necesario)
- [ ] Métricas de monitoreo implementadas
