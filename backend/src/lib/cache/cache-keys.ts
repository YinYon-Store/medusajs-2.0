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
    'category_main',
    'category_ids',
    'category_id', // Formato del frontend
    'tags',
    'q',
    'title',
    'handle',
    'id', // Lista de IDs (p. ej. id[0], id[1] desde resultados de búsqueda); orden afecta la respuesta
  ]
  
  // Solo incluir parámetros relevantes
  for (const key of relevantKeys) {
    if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
      relevantParams[key] = queryParams[key]
    }
  }

  // Incluir lista ordenada de IDs cuando viene como id[0], id[1], ... (p. ej. resultados de búsqueda)
  const idBracketKeys = Object.keys(queryParams).filter((k) => /^id\[\d+\]$/.test(k))
  if (idBracketKeys.length > 0) {
    idBracketKeys.sort((a, b) => {
      const i = parseInt(a.replace(/^id\[(\d+)\]$/, '$1'), 10)
      const j = parseInt(b.replace(/^id\[(\d+)\]$/, '$1'), 10)
      return i - j
    })
    relevantParams.id = idBracketKeys.map((k) => queryParams[k])
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
