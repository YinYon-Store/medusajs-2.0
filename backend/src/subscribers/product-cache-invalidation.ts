import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { productCacheService } from '../lib/cache/product-cache-service'

/**
 * Subscriber que invalida la caché de productos cuando se crea, actualiza o elimina un producto
 * 
 * Estrategia: Invalidación selectiva
 * - Solo invalida las cache keys que contienen el producto afectado
 * - Mantiene intacta la caché de otros productos
 */
export default async function productCacheInvalidationHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    const productId = data?.id

    if (!productId) {
      console.warn('[ProductCache] No product ID in event data')
      return
    }

    // Invalidar solo las keys que contienen este producto
    const invalidatedCount = await productCacheService.invalidateByProductId(productId)

    if (invalidatedCount > 0) {
      console.log(
        `[ProductCache] Invalidated ${invalidatedCount} cache keys for product ${productId}`
      )
    } else {
      console.log(`[ProductCache] No cache keys found for product ${productId}`)
    }
  } catch (error) {
    console.error('[ProductCache] Error invalidating cache:', error)
    // No lanzar error - no debe bloquear el flujo principal
  }
}

export const config: SubscriberConfig = {
  event: ['product.created', 'product.updated', 'product.deleted'],
}
