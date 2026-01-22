import { createClient, RedisClientType } from 'redis'
import { REDIS_URL, PRODUCT_CACHE_ENABLED, PRODUCT_CACHE_TTL_SECONDS } from '../constants'
import { generateCacheKey } from './cache-keys'

/**
 * TTL por defecto: 24 horas (86400 segundos)
 * Puede ser configurado via PRODUCT_CACHE_TTL_SECONDS
 */
const DEFAULT_TTL_SECONDS = PRODUCT_CACHE_TTL_SECONDS

/**
 * Cliente Redis singleton
 */
let redisClient: RedisClientType | null = null
let redisConnected = false

/**
 * Inicializa el cliente Redis si está disponible
 * Optimizado para mejor rendimiento
 */
async function getRedisClient(): Promise<RedisClientType | null> {
  if (!REDIS_URL) {
    return null
  }

  if (redisClient && redisConnected) {
    return redisClient
  }

  try {
    const client = createClient({
      url: REDIS_URL,
      socket: {
        // Optimizaciones de conexión
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            return new Error('Max reconnection attempts reached')
          }
          return Math.min(retries * 100, 3000)
        },
        // Timeouts más agresivos para mejor rendimiento
        connectTimeout: 5000,
        commandTimeout: 3000,
      },
      // Deshabilitar comandos lentos que no necesitamos
      disableClientInfo: true,
    })

    client.on('error', (err) => {
      console.error('[ProductCache] Redis error:', err)
      redisConnected = false
    })

    client.on('connect', () => {
      console.log('[ProductCache] Redis connected')
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

/**
 * Extrae los IDs de productos de una respuesta
 */
function extractProductIds(response: any): string[] {
  try {
    if (response?.products && Array.isArray(response.products)) {
      return response.products
        .map((product: any) => product?.id)
        .filter((id: any): id is string => typeof id === 'string' && id.length > 0)
    }
    if (response?.product?.id) {
      return [response.product.id]
    }
    if (Array.isArray(response)) {
      return response
        .map((product: any) => product?.id)
        .filter((id: any): id is string => typeof id === 'string' && id.length > 0)
    }
    return []
  } catch (error) {
    console.error('[ProductCache] Error extracting product IDs:', error)
    return []
  }
}

/**
 * Servicio de caché para productos
 */
export class ProductCacheService {
  /**
   * Obtiene una respuesta de caché
   * Primero intenta obtener la respuesta exacta, luego intenta construirla desde productos individuales cacheados
   */
  async get(cacheKey: string, queryParams?: Record<string, any>): Promise<any | null> {
    if (!PRODUCT_CACHE_ENABLED) {
      return null
    }

    const redis = await getRedisClient()
    if (!redis) {
      return null
    }

    try {
      // 1. Intentar obtener respuesta exacta
      // Usar pipeline para mejor rendimiento si necesitamos múltiples operaciones
      const cached = await redis.get(cacheKey)
      if (cached) {
        // Optimización: parsear JSON de forma más eficiente
        // Para respuestas grandes, considerar compresión en el futuro
        try {
          const parsed = JSON.parse(cached)
          return parsed
        } catch (parseError) {
          // Si el JSON está corrupto, eliminar la key
          await redis.del(cacheKey).catch(() => {})
          return null
        }
      }

      // 2. Si no hay respuesta exacta y tenemos query params, intentar construir desde productos individuales
      // NOTA: Esta funcionalidad está deshabilitada por defecto porque puede ser lenta con muchos productos
      // Solo se usa si BUILD_FROM_INDIVIDUAL_PRODUCTS está habilitado
      const BUILD_FROM_INDIVIDUAL = process.env.PRODUCT_CACHE_BUILD_FROM_INDIVIDUAL === 'true'
      
      if (BUILD_FROM_INDIVIDUAL && queryParams && this.canBuildFromIndividualProducts(queryParams)) {
        const builtResponse = await this.buildResponseFromIndividualProducts(queryParams, redis)
        if (builtResponse) {
          console.log(`[ProductCache] Built response from individual products for ${cacheKey}`)
          return builtResponse
        }
      }

      return null
    } catch (error) {
      console.error('[ProductCache] Error getting cache:', error)
      // Si la key está corrupta, eliminarla
      try {
        await redis.del(cacheKey)
      } catch (delError) {
        // Ignorar error de eliminación
      }
      return null
    }
  }

  /**
   * Verifica si podemos construir una respuesta desde productos individuales cacheados
   * Solo funciona para queries simples sin filtros complejos
   * 
   * IMPORTANTE: No podemos construir desde productos individuales si hay region_id diferente
   * porque los precios y calculated_price dependen del region_id
   */
  private canBuildFromIndividualProducts(queryParams: Record<string, any>): boolean {
    // Solo construir desde productos individuales si:
    // - No hay filtros complejos (q, title, handle, categories, tags)
    // - Solo hay limit, offset, order, status, collection_id, type_id
    // - NOTA: region_id se maneja en el cacheo individual, pero requiere que los productos
    //   hayan sido cacheados con el mismo region_id
    const complexFilters = ['q', 'title', 'handle', 'categories', 'tags']
    return !complexFilters.some(filter => queryParams[filter] !== undefined && queryParams[filter] !== null && queryParams[filter] !== '')
  }

  /**
   * Construye una respuesta paginada desde productos individuales cacheados
   * 
   * IMPORTANTE: Los productos individuales deben haber sido cacheados con el mismo region_id
   * para que los precios sean correctos. Si el region_id es diferente, no podemos construir
   * la respuesta desde productos individuales.
   * 
   * OPTIMIZACIÓN: Usa un set de product IDs en lugar de redis.keys() que es muy lento
   */
  private async buildResponseFromIndividualProducts(
    queryParams: Record<string, any>,
    redis: RedisClientType
  ): Promise<any | null> {
    try {
      // Obtener el set de todos los product IDs cacheados (mucho más rápido que keys())
      const cachedProductIds = await redis.sMembers('products:cached_ids')
      
      if (cachedProductIds.length === 0) {
        return null
      }

      // Si hay demasiados productos, no intentar construir desde individuales (muy lento)
      // Límite razonable: 1000 productos
      if (cachedProductIds.length > 1000) {
        console.log(`[ProductCache] Too many cached products (${cachedProductIds.length}), skipping individual build`)
        return null
      }

      // Construir las keys de productos
      const productKeys = cachedProductIds.map((id: string) => `products:item:${id}`)

      // Obtener todos los productos usando pipeline (más eficiente)
      const products: any[] = []
      const pipeline = redis.multi()
      
      for (const key of productKeys) {
        pipeline.get(key)
      }

      const results = await pipeline.exec()
      
      if (results) {
        for (const result of results) {
          if (result && result[1] && typeof result[1] === 'string') {
            try {
              const product = JSON.parse(result[1])
              products.push(product)
            } catch (error) {
              // Ignorar productos corruptos
            }
          }
        }
      }

      if (products.length === 0) {
        return null
      }

      // Aplicar filtros básicos
      let filteredProducts = products

      if (queryParams.status) {
        filteredProducts = filteredProducts.filter((p: any) => p.status === queryParams.status)
      }
      if (queryParams.collection_id) {
        filteredProducts = filteredProducts.filter((p: any) => p.collection_id === queryParams.collection_id)
      }
      if (queryParams.type_id) {
        filteredProducts = filteredProducts.filter((p: any) => p.type_id === queryParams.type_id)
      }

      // Aplicar ordenamiento
      const orderParam = queryParams.order as string | undefined
      if (orderParam) {
        const isDesc = orderParam.startsWith('-')
        const orderField = isDesc ? orderParam.substring(1) : orderParam

        filteredProducts.sort((a: any, b: any) => {
          let aVal = a[orderField]
          let bVal = b[orderField]

          // Manejar order_price
          if (orderField === 'order_price') {
            aVal = a.order_price ?? 0
            bVal = b.order_price ?? 0
          } else if (orderField === 'created_at' || orderField === 'updated_at') {
            aVal = new Date(aVal).getTime()
            bVal = new Date(bVal).getTime()
          }

          if (aVal < bVal) return isDesc ? 1 : -1
          if (aVal > bVal) return isDesc ? -1 : 1
          return 0
        })
      } else {
        // Ordenamiento por defecto: por created_at descendente
        filteredProducts.sort((a: any, b: any) => {
          const aTime = new Date(a.created_at).getTime()
          const bTime = new Date(b.created_at).getTime()
          return bTime - aTime
        })
      }

      // Aplicar paginación
      const limit = parseInt(queryParams.limit as string || '100', 10)
      const offset = parseInt(queryParams.offset as string || '0', 10)
      const totalCount = filteredProducts.length
      const paginatedProducts = filteredProducts.slice(offset, offset + limit)

      // Solo retornar si tenemos suficientes productos para la paginación solicitada
      // o si estamos en la primera página
      if (paginatedProducts.length === 0 && offset > 0) {
        return null // No tenemos suficientes productos cacheados
      }

      return {
        products: paginatedProducts,
        count: totalCount,
        offset: offset,
        limit: limit,
      }
    } catch (error) {
      console.error('[ProductCache] Error building from individual products:', error)
      return null
    }
  }

  /**
   * Almacena una respuesta en caché con indexación automática
   * También cachea productos individuales para construcción de respuestas
   * @param cacheKey - Key de caché
   * @param data - Datos a cachear
   * @param productIds - IDs de productos en la respuesta (opcional, se extraen automáticamente si no se proporcionan)
   * @param ttl - TTL en segundos (opcional, default: 24 horas)
   */
  async set(
    cacheKey: string,
    data: any,
    productIds?: string[],
    ttl: number = DEFAULT_TTL_SECONDS
  ): Promise<void> {
    if (!PRODUCT_CACHE_ENABLED) {
      return
    }

    const redis = await getRedisClient()
    if (!redis) {
      return
    }

    try {
      // 1. Serializar JSON una sola vez (optimización)
      const serializedData = JSON.stringify(data)

      // 2. Extraer product IDs si no se proporcionaron
      const ids = productIds || extractProductIds(data)

      // 3. Usar pipeline para todas las operaciones de Redis (más eficiente)
      const pipeline = redis.multi()

      // 3.1. Almacenar la respuesta completa en caché
      pipeline.setEx(cacheKey, ttl, serializedData)

      // 3.2. Cachear productos individuales para construcción de respuestas (solo si está habilitado)
      const BUILD_FROM_INDIVIDUAL = process.env.PRODUCT_CACHE_BUILD_FROM_INDIVIDUAL === 'true'
      
      if (BUILD_FROM_INDIVIDUAL && ids.length > 0) {
        const products = data?.products || (Array.isArray(data) ? data : [])
        
        for (const product of products) {
          if (product?.id) {
            const itemKey = `products:item:${product.id}`
            pipeline.setEx(itemKey, ttl, JSON.stringify(product))
            // Agregar al set de IDs cacheados
            pipeline.sAdd('products:cached_ids', product.id)
          }
        }
        
        // Establecer TTL en el set de IDs
        pipeline.expire('products:cached_ids', ttl)
      }

      // 3.3. Para cada producto, agregar esta key a su índice (en batch)
      if (ids.length > 0) {
        for (const productId of ids) {
          const indexKey = `products:index:${productId}`
          pipeline.sAdd(indexKey, cacheKey)
          pipeline.expire(indexKey, ttl) // Mismo TTL que la respuesta
        }
      }

      // 4. Ejecutar todas las operaciones en una sola transacción
      await pipeline.exec()

      if (ids.length > 0) {
        console.log(`[ProductCache] Cached ${cacheKey} with ${ids.length} products indexed`)
      }
    } catch (error) {
      console.error('[ProductCache] Error setting cache:', error)
      // No lanzar error - fallback silencioso
    }
  }

  /**
   * Invalida todas las cache keys que contienen un producto específico
   * También elimina el producto individual cacheado
   * @param productId - ID del producto
   * @returns Número de keys invalidadas
   */
  async invalidateByProductId(productId: string): Promise<number> {
    const redis = await getRedisClient()
    if (!redis) {
      return 0
    }

    try {
      const indexKey = `products:index:${productId}`
      const itemKey = `products:item:${productId}`

      // 1. Obtener todas las keys de caché que contienen este producto
      const cacheKeys = await redis.sMembers(indexKey)

      let invalidatedCount = 0

      // 2. Eliminar cada key de caché
      if (cacheKeys.length > 0) {
        await redis.del(...cacheKeys)
        invalidatedCount = cacheKeys.length
      }

      // 3. Eliminar el producto individual cacheado (si existe)
      const BUILD_FROM_INDIVIDUAL = process.env.PRODUCT_CACHE_BUILD_FROM_INDIVIDUAL === 'true'
      
      if (BUILD_FROM_INDIVIDUAL) {
        await redis.del(itemKey)
        // Remover del set de IDs cacheados
        await redis.sRem('products:cached_ids', productId)
      }

      // 5. Eliminar el índice
      await redis.del(indexKey)

      console.log(`[ProductCache] Invalidated ${invalidatedCount} cache keys and individual item for product ${productId}`)
      return invalidatedCount
    } catch (error) {
      console.error('[ProductCache] Error invalidating by product:', error)
      return 0
    }
  }

  /**
   * Elimina una key de caché específica
   */
  async delete(cacheKey: string): Promise<void> {
    const redis = await getRedisClient()
    if (!redis) {
      return
    }

    try {
      await redis.del(cacheKey)
    } catch (error) {
      console.error('[ProductCache] Error deleting cache:', error)
    }
  }

  /**
   * Limpia toda la caché de productos (útil para debugging)
   */
  async clearAll(): Promise<void> {
    const redis = await getRedisClient()
    if (!redis) {
      return
    }

    try {
      // Buscar todas las keys de productos
      // NOTA: redis.keys() es lento, pero para clearAll() está bien
      const cacheKeys = await redis.keys('products:cache:*')
      const indexKeys = await redis.keys('products:index:*')
      const itemKeys = await redis.keys('products:item:*')

      if (cacheKeys.length > 0) {
        await redis.del(...cacheKeys)
      }
      if (indexKeys.length > 0) {
        await redis.del(...indexKeys)
      }
      if (itemKeys.length > 0) {
        await redis.del(...itemKeys)
      }
      
      // Eliminar el set de IDs cacheados
      await redis.del('products:cached_ids')

      console.log(
        `[ProductCache] Cleared ${cacheKeys.length} cache keys, ${indexKeys.length} index keys, and ${itemKeys.length} item keys`
      )
    } catch (error) {
      console.error('[ProductCache] Error clearing cache:', error)
    }
  }

  /**
   * Genera una key de caché basada en query params
   */
  generateKey(queryParams: Record<string, any>): string {
    return generateCacheKey(queryParams)
  }
}

// Exportar instancia singleton
export const productCacheService = new ProductCacheService()
