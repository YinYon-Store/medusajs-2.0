import crypto from 'crypto'

/**
 * Genera una key de caché basada en los parámetros de query
 * Solo incluye parámetros que afectan el resultado
 */
export function generateCacheKey(queryParams: Record<string, any>): string {
  // Parámetros que afectan la caché
  const relevantParams: Record<string, any> = {}
  
  // Lista de parámetros que afectan el resultado
  const relevantKeys = [
    'limit',
    'offset',
    'order',
    'region_id',
    'status',
    'collection_id',
    'type_id',
    'categories',
    'tags',
    'q',
    'title',
    'handle',
  ]
  
  // Solo incluir parámetros relevantes
  for (const key of relevantKeys) {
    if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
      relevantParams[key] = queryParams[key]
    }
  }
  
  // Ordenar keys para consistencia
  const sortedKeys = Object.keys(relevantParams).sort()
  const sortedParams: Record<string, any> = {}
  for (const key of sortedKeys) {
    sortedParams[key] = relevantParams[key]
  }
  
  // Serializar y generar hash
  const serialized = JSON.stringify(sortedParams)
  const hash = crypto.createHash('sha256').update(serialized).digest('hex').substring(0, 16)
  
  return `products:cache:${hash}`
}
