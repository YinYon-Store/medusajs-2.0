# Plan de Implementación: Sistema de Caché para `/store/products`

## 📋 Resumen Ejecutivo

Implementar un sistema de caché para el endpoint `/store/products` que:
- Mejore significativamente el tiempo de respuesta (objetivo: < 200ms)
- Se invalide automáticamente cuando se crea/modifica/elimina un producto
- Sea compatible con Medusa JS 2.0
- Soporte diferentes combinaciones de parámetros de query

---

## 🎯 Objetivos

1. **Rendimiento**: Reducir el tiempo de respuesta de ~2.4s a < 200ms
2. **Consistencia**: Invalidar caché automáticamente cuando cambian los productos
3. **Escalabilidad**: Soportar múltiples instancias del servidor (caché compartido)
4. **Mantenibilidad**: Código limpio y fácil de mantener

---

## 🏗️ Arquitectura de la Solución

### Componentes Principales

```
┌─────────────────────────────────────────────────────────────┐
│                    API Endpoint                              │
│              /store/products (route.ts)                      │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              Product Cache Service                           │
│         (lib/cache/product-cache-service.ts)                 │
│  - Genera keys de caché basadas en query params              │
│  - Obtiene/almacena datos en Redis                           │
│  - Maneja TTL y invalidación                                 │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Redis Cache                               │
│              (Ya instalado en el proyecto)                   │
│  - Almacena respuestas JSON serializadas                     │
│  - Keys: "products:cache:{hash}"                             │
│  - TTL: 24 horas (fallback)                                  │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              Product Cache Subscribers                       │
│     (subscribers/product-cache-invalidation.ts)              │
│  - Escucha eventos: product.created                          │
│  - Escucha eventos: product.updated                          │
│  - Escucha eventos: product.deleted                          │
│  - Invalida toda la caché cuando ocurren estos eventos       │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 Estructura de Archivos

```
src/
├── lib/
│   └── cache/
│       ├── product-cache-service.ts      # Servicio principal de caché
│       └── cache-keys.ts                 # Utilidades para generar keys
├── subscribers/
│   └── product-cache-invalidation.ts     # Subscriber para invalidar caché
└── api/
    └── store/
        └── products/
            └── route.ts                  # Endpoint (modificado)
```

---

## 🔑 Estrategia de Keys de Caché

### Generación de Keys

Las keys se generan basándose en los parámetros de query que afectan el resultado:

**Parámetros que afectan la caché:**
- `limit`
- `offset`
- `order` (incluyendo `order_price`)
- `region_id`
- `status`
- `collection_id`
- `type_id`
- `categories` (array)
- `tags` (array)
- `q` (query de búsqueda)
- `title`
- `handle`

**Parámetros que NO afectan la caché:**
- `fields` (se aplica después de obtener datos)

**Formato de Key:**
```
products:cache:{hash}
```

Donde `{hash}` es un hash MD5/SHA256 de los parámetros ordenados y serializados.

### Ejemplo de Generación:

```typescript
// Query params:
{
  limit: 15,
  offset: 0,
  order: 'order_price',
  region_id: 'reg_123'
}

// Key generada:
products:cache:a1b2c3d4e5f6...
```

---

## 🚀 Fases de Implementación

### Fase 1: Servicio de Caché Base

**Archivo:** `src/lib/cache/product-cache-service.ts`

**Funcionalidades:**
1. Conexión a Redis
2. Generar keys basadas en query params
3. Métodos `get()`, `set()`, `delete()`, `clearAll()`
4. **Método `invalidateByProductId()`**: Invalidación selectiva
5. **Sistema de indexación**: Mantener sets de keys por producto
6. Serialización/deserialización JSON
7. Manejo de errores (fallback si Redis falla)

**TTL por defecto:** 24 horas (como fallback si no se invalida manualmente)

**Métodos del Servicio:**
```typescript
// Obtener de caché
async get(cacheKey: string): Promise<any | null>

// Almacenar en caché (con indexación automática)
async set(cacheKey: string, data: any, productIds: string[], ttl?: number): Promise<void>

// Invalidar por producto específico
async invalidateByProductId(productId: string): Promise<number> // retorna cantidad de keys invalidadas

// Invalidar key específica
async delete(cacheKey: string): Promise<void>

// Limpiar toda la caché (útil para debugging)
async clearAll(): Promise<void>
```

**Implementación del método `set()` con indexación:**
```typescript
async set(cacheKey: string, data: any, productIds: string[], ttl: number = 86400): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return

  try {
    // 1. Almacenar la respuesta en caché
    await redis.setEx(cacheKey, ttl, JSON.stringify(data))
    
    // 2. Para cada producto, agregar esta key a su índice
    for (const productId of productIds) {
      const indexKey = `products:index:${productId}`
      await redis.sAdd(indexKey, cacheKey)
      await redis.expire(indexKey, ttl) // Mismo TTL que la respuesta
    }
  } catch (error) {
    console.error('[ProductCache] Error setting cache:', error)
    // No lanzar - fallback silencioso
  }
}
```

**Implementación del método `invalidateByProductId()`:**
```typescript
async invalidateByProductId(productId: string): Promise<number> {
  const redis = await getRedisClient()
  if (!redis) return 0

  try {
    const indexKey = `products:index:${productId}`
    
    // 1. Obtener todas las keys de caché que contienen este producto
    const cacheKeys = await redis.sMembers(indexKey)
    
    if (cacheKeys.length === 0) {
      return 0 // No hay nada que invalidar
    }
    
    // 2. Eliminar cada key de caché
    if (cacheKeys.length > 0) {
      await redis.del(...cacheKeys)
    }
    
    // 3. Eliminar el índice
    await redis.del(indexKey)
    
    return cacheKeys.length
  } catch (error) {
    console.error('[ProductCache] Error invalidating by product:', error)
    return 0
  }
}
```

**Consideraciones:**
- Si Redis falla, el endpoint debe seguir funcionando normalmente (sin caché)
- Logs de errores para debugging
- Métricas de hit/miss rate (opcional)

---

### Fase 2: Integración en el Endpoint

**Archivo:** `src/api/store/products/route.ts`

**Modificaciones:**
1. Al inicio del handler `GET`:
   - Generar key de caché basada en query params
   - Intentar obtener respuesta de caché
   - Si existe, retornar inmediatamente (bypass completo)

2. Al final del handler (antes de `res.json()`):
   - Extraer IDs de productos de la respuesta
   - Almacenar respuesta en caché con indexación: `cacheService.set(key, data, productIds)`
   - Manejar errores silenciosamente (no bloquear respuesta)

**Flujo:**
```
Request → Check Cache → Hit? → Return Cached
                          ↓ No
                      Process Query → Store in Cache → Return
```

**Consideraciones:**
- No cachear respuestas de error (status != 200)
- No cachear si Redis está desconectado (continuar normal)
- Validar que la respuesta sea válida antes de cachear

---

### Fase 3: Invalidación Automática Selectiva

**Archivo:** `src/subscribers/product-cache-invalidation.ts`

**Eventos a escuchar:**
- `product.created`
- `product.updated`
- `product.deleted`

**Estrategia de Invalidación: Invalidación Selectiva (Optimizada)**

En lugar de invalidar toda la caché, solo invalidamos las keys que contienen el producto afectado.

**Sistema de Indexación:**

Usaremos **Redis Sets** para mantener un índice inverso:
- Para cada producto: `products:index:{product_id}` → Set de cache keys que contienen ese producto
- Cuando se cachea una respuesta, agregamos la key a los sets de todos los productos incluidos
- Cuando se invalida, solo eliminamos las keys del set de ese producto

**Estructura en Redis:**
```
products:cache:{hash} → JSON response
products:index:{product_id} → Set de cache keys que contienen este producto
```

**Flujo de Cacheo:**
1. Generar respuesta de productos
2. Extraer IDs de productos de la respuesta
3. Almacenar respuesta en `products:cache:{hash}`
4. Para cada producto en la respuesta:
   - Agregar `products:cache:{hash}` al set `products:index:{product_id}`
   - Establecer TTL en el set (mismo que la respuesta)

**Flujo de Invalidación:**
1. Evento: `product.updated` con `product_id`
2. Obtener todas las keys del set `products:index:{product_id}`
3. Eliminar cada key de caché encontrada
4. Eliminar el set `products:index:{product_id}`

**Ventajas:**
- ✅ Solo invalida lo necesario
- ✅ Mantiene caché de otros productos intacta
- ✅ Eficiente en memoria (solo índices de productos activos)
- ✅ Escalable

**Consideraciones:**
- Si un producto está en muchas queries, puede tener muchas keys en su set
- El tamaño del set es proporcional a cuántas queries diferentes incluyen ese producto
- En la práctica, esto es aceptable porque los productos populares se cachean más

**Implementación:**
```typescript
export default async function productCacheInvalidationHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const productCacheService = container.resolve('productCacheService')
  
  try {
    const productId = data.id
    
    // Invalidar solo las keys que contienen este producto
    const invalidatedCount = await productCacheService.invalidateByProductId(productId)
    
    console.log(`[Cache] Invalidated ${invalidatedCount} cache keys for product ${productId}`)
  } catch (error) {
    console.error('[Cache] Error invalidating cache:', error)
    // No lanzar error - no debe bloquear el flujo principal
  }
}

export const config: SubscriberConfig = {
  event: ['product.created', 'product.updated', 'product.deleted']
}
```

---

### Fase 4: Configuración y Optimización

**Archivo:** `src/lib/cache/config.ts` o `src/lib/constants.ts`

**Variables de configuración:**
- `CACHE_TTL_SECONDS`: TTL por defecto (86400 = 24 horas)
- `CACHE_ENABLED`: Flag para habilitar/deshabilitar caché (para debugging)
- `REDIS_URL`: URL de conexión a Redis (usar variable de entorno)

**Optimizaciones:**
- Compresión de respuestas grandes (opcional)
- Versionado de caché para cambios de esquema (futuro)
- Métricas y monitoreo (opcional)

---

## 🔧 Detalles Técnicos

### Conexión a Redis

**Ya existe en el proyecto:**
- Package: `redis: ^5.10.0`
- Configuración: `REDIS_URL` desde `src/lib/constants.ts`
- Patrón Singleton: Ya implementado en `payment-buffer-service.ts` y `rate-limit-service.ts`

**Código de conexión (usar patrón existente):**
```typescript
import { createClient, RedisClientType } from 'redis'
import { REDIS_URL } from '../constants'

let redisClient: RedisClientType | null = null
let redisConnected = false

async function getRedisClient(): Promise<RedisClientType | null> {
  if (!REDIS_URL) {
    return null
  }

  if (redisClient && redisConnected) {
    return redisClient
  }

  try {
    const client = createClient({ url: REDIS_URL })
    
    client.on('error', (err) => {
      console.error('[ProductCache] Redis error:', err)
      redisConnected = false
    })

    client.on('connect', () => {
      redisConnected = true
    })

    await client.connect()
    redisClient = client as RedisClientType
    redisConnected = true
    return redisClient
  } catch (error) {
    console.warn('[ProductCache] Redis unavailable, cache disabled')
    redisConnected = false
    return null
  }
}
```

**Referencias de código existente:**
- `src/lib/payment-buffer-service.ts` (líneas 89-127)
- `src/lib/rate-limit-service.ts` (líneas 47-80)

### Serialización

**Formato:** JSON
- Ventaja: Fácil de debuggear
- Desventaja: Puede ser más lento que MessagePack (pero suficiente para MVP)

### Manejo de Errores

**Principio:** "Cache failures should never break the application"

- Si Redis falla → Continuar sin caché
- Si deserialización falla → Eliminar key corrupta, continuar sin caché
- Logs de errores pero no lanzar excepciones

---

## 📊 Casos de Uso y Flujos

### Caso 1: Request con Caché Hit

```
1. Cliente → GET /store/products?limit=15&offset=0&order=order_price
2. Endpoint → Genera key: products:cache:abc123
3. Endpoint → Consulta Redis: GET products:cache:abc123
4. Redis → Retorna JSON serializado
5. Endpoint → Deserializa y retorna
   Tiempo total: ~10-50ms
```

### Caso 2: Request con Caché Miss

```
1. Cliente → GET /store/products?limit=15&offset=0&order=order_price
2. Endpoint → Genera key: products:cache:abc123
3. Endpoint → Consulta Redis: GET products:cache:abc123
4. Redis → NULL (no existe)
5. Endpoint → Procesa query normal (SQL, relaciones, precios)
6. Endpoint → Almacena resultado en caché: SET products:cache:abc123
7. Endpoint → Retorna respuesta
   Tiempo total: ~2.4s (primera vez), luego ~10-50ms
```

### Caso 3: Producto Modificado (Invalidación Selectiva)

```
1. Admin → Actualiza producto (precio, título, etc.)
2. Medusa → Emite evento: product.updated con product_id
3. Subscriber → Se ejecuta productCacheInvalidationHandler
4. Subscriber → cacheService.invalidateByProductId(product_id)
5. Redis → 
   - Lee set: products:index:{product_id}
   - Encuentra keys: ["products:cache:abc123", "products:cache:def456"]
   - Elimina solo esas keys
   - Elimina el set de índice
6. Próxima request que incluía ese producto → Caché miss, regenera datos frescos
7. Próxima request que NO incluía ese producto → Caché hit, respuesta rápida
```

**Ejemplo Práctico:**
- Tienes 20 productos en total
- Request A: `/store/products?limit=15&offset=0` → Cachea productos 1-15
- Request B: `/store/products?limit=15&offset=15` → Cachea productos 16-20
- Modificas producto #3
- Solo se invalida Request A (que contenía producto #3)
- Request B sigue en caché (productos 16-20 no cambiaron)

---

## 🧪 Testing

### Tests Recomendados

1. **Test de Hit Rate**
   - Realizar mismo request 2 veces
   - Verificar que segunda respuesta viene de caché (log de timing)

2. **Test de Invalidación**
   - Cachear un request
   - Modificar un producto
   - Verificar que próxima request regenera caché

3. **Test de Fallback**
   - Desconectar Redis
   - Verificar que endpoint sigue funcionando

4. **Test de Parámetros**
   - Verificar que diferentes query params generan keys diferentes
   - Verificar que mismo query params generan misma key

---

## 📈 Métricas y Monitoreo (Opcional)

### Métricas Útiles

1. **Hit Rate**: % de requests servidos desde caché
2. **Cache Size**: Tamaño total de caché en Redis
3. **TTL Distribution**: Distribución de TTLs de keys
4. **Invalidation Frequency**: Frecuencia de invalidaciones

### Logs Recomendados

```typescript
// En product-cache-service.ts
console.log('[Cache] Hit:', key)
console.log('[Cache] Miss:', key)
console.log('[Cache] Set:', key, 'TTL:', ttl)
console.log('[Cache] Clear all')
console.error('[Cache] Error:', error)
```

---

## 🚨 Consideraciones Importantes

### 1. Consistencia de Datos

- **Invalidación selectiva garantiza consistencia** solo donde es necesario
- Los productos que no cambiaron mantienen su caché intacta
- La inconsistencia temporal es mínima (solo afecta al producto modificado)

### 2. Memoria Redis

- Monitorear uso de memoria
- Considerar compresión si las respuestas son muy grandes (>1MB)
- Configurar `maxmemory` y `maxmemory-policy` en Redis

### 3. Escalabilidad

- Redis compartido permite que múltiples instancias compartan caché
- Considerar Redis Cluster si se escala horizontalmente

### 4. Debugging

- Agregar header `X-Cache-Status: HIT|MISS` en respuestas (opcional)
- Logs detallados en desarrollo
- Comando CLI para limpiar caché manualmente (futuro)

---

## 🎯 Resultados Esperados

### Antes de Caché
- Tiempo de respuesta: ~2.4s
- Consultas a BD: 3-5 por request
- CPU: Alta (procesamiento de relaciones)

### Después de Caché
- Tiempo de respuesta: < 200ms (en caché hits)
- Consultas a BD: 0 por request (en caché hits)
- CPU: Mínima (solo deserialización JSON)
- Hit rate esperado: > 80% (depende del tráfico)

---

## 📝 Checklist de Implementación

- [ ] **Fase 1**: Crear `product-cache-service.ts`
  - [ ] Conexión a Redis
  - [ ] Métodos get/set/delete/clearAll
  - [ ] Método invalidateByProductId() con indexación
  - [ ] Sistema de indexación con Redis Sets
  - [ ] Generación de keys basada en query params
  - [ ] Extracción de product IDs de respuestas
  - [ ] Manejo de errores

- [ ] **Fase 2**: Modificar `route.ts`
  - [ ] Check cache al inicio
  - [ ] Extraer product IDs de la respuesta
  - [ ] Store cache al final con indexación (pasar productIds)
  - [ ] Testing de hit/miss

- [ ] **Fase 3**: Crear subscriber
  - [ ] Escuchar eventos de productos
  - [ ] Invalidar caché en eventos
  - [ ] Testing de invalidación

- [ ] **Fase 4**: Configuración
  - [ ] Variables de entorno
  - [ ] Documentación
  - [ ] Testing end-to-end

---

## 🔮 Mejoras Futuras (Post-MVP)

1. ~~**Invalidación Selectiva**: Solo invalidar keys que contienen el producto afectado~~ ✅ **Implementado**
2. **Invalidación por Relaciones**: Invalidar también cuando cambian colecciones, categorías o tags relacionados
3. **Compresión**: Comprimir respuestas grandes con gzip
3. **Versionado**: Sistema de versiones para cambios de esquema
4. **Métricas Avanzadas**: Dashboard de métricas de caché
5. **Cache Warming**: Pre-cachear queries comunes en startup
6. **Distributed Cache Tags**: Sistema de tags para invalidación más granular

---

## 📚 Referencias

- Redis Node.js Client: https://github.com/redis/node-redis
- Medusa 2.0 Subscribers: Ya documentado en `src/subscribers/README.md`
- Patrón Cache-Aside: https://docs.microsoft.com/en-us/azure/architecture/patterns/cache-aside

---

## ⚠️ Notas Finales

1. **Invalidación Selectiva desde el inicio**: Más eficiente y no agrega complejidad significativa
2. **Fail Gracefully**: El sistema debe funcionar sin caché si Redis falla
3. **Monitor**: Observar hit rates y tiempos de respuesta después de implementar
4. **Iterate**: Ajustar TTL y estrategia de invalidación basado en datos reales
5. **Limpieza de Índices**: Considerar un job periódico para limpiar índices huérfanos (si una key expira pero el índice no)
