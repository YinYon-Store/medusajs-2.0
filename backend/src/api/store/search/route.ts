import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import MeiliSearch from "meilisearch"
import { MEILISEARCH_HOST, MEILISEARCH_ADMIN_KEY } from "../../../lib/constants"
import { reportError, ErrorCategory, logSearchEvent, AnalyticsEvent } from "../../../lib/firebase-service"
import { IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

// Nombre del índice (según configuración del plugin en medusa-config.js)
const MEILISEARCH_INDEX_NAME = "products"

// Cliente de Meilisearch (solo en servidor)
// Usamos la misma configuración que el plugin para mantener consistencia
let meilisearchClient: MeiliSearch | null = null

function getMeilisearchClient(): MeiliSearch {
  if (!meilisearchClient) {
    if (!MEILISEARCH_HOST || !MEILISEARCH_ADMIN_KEY) {
      throw new Error(
        "Meilisearch configuration is missing. Please set MEILISEARCH_HOST and MEILISEARCH_ADMIN_KEY environment variables."
      )
    }

    meilisearchClient = new MeiliSearch({
      host: MEILISEARCH_HOST,
      apiKey: MEILISEARCH_ADMIN_KEY, // Usamos la admin key del plugin (privada, no expuesta)
    })
  }
  return meilisearchClient
}

// Helper function to retry a Meilisearch operation with exponential backoff
async function retryMeilisearchOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on validation errors or client errors (4xx)
      if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
        throw error;
      }
      
      // If it's the last attempt, throw the error
      if (attempt === maxRetries - 1) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// Validación de query
function validateSearchQuery(query: string): { valid: boolean; error?: string } {
  if (!query || typeof query !== "string") {
    return { valid: false, error: "Query is required and must be a string" }
  }

  // Limitar longitud
  if (query.length > 200) {
    return { valid: false, error: "Query too long (max 200 characters)" }
  }

  // Validar caracteres peligrosos (opcional, ajustar según necesidades)
  const dangerousPatterns = /[<>{}[\]\\]/g
  if (dangerousPatterns.test(query)) {
    return { valid: false, error: "Query contains invalid characters" }
  }

  return { valid: true }
}

// Función para ordenar categorías por jerarquía (de más general a más específica)
function sortCategoriesByHierarchy(categories: any[]): any[] {
  if (!categories || categories.length === 0) {
    return []
  }

  // Crear un mapa de categorías por ID para acceso rápido
  const categoryMap = new Map<string, any>()
  categories.forEach(cat => {
    categoryMap.set(cat.id, cat)
  })

  // Función auxiliar para calcular la profundidad relativa de una categoría
  // (profundidad dentro del conjunto de categorías disponibles)
  const getRelativeDepth = (category: any): number => {
    if (!category.parent_category_id) {
      return 0 // Categoría raíz (sin padre)
    }
    const parent = categoryMap.get(category.parent_category_id)
    if (!parent) {
      // Si el padre no está en la lista, tratar como raíz (profundidad 0)
      return 0
    }
    return 1 + getRelativeDepth(parent)
  }

  // Ordenar por profundidad relativa (menor profundidad primero = más general primero)
  // Si tienen la misma profundidad, mantener el orden original
  return [...categories].sort((a, b) => {
    const depthA = getRelativeDepth(a)
    const depthB = getRelativeDepth(b)
    if (depthA !== depthB) {
      return depthA - depthB
    }
    // Si tienen la misma profundidad, ordenar por nombre para consistencia
    return (a.name || '').localeCompare(b.name || '')
  })
}

// Función para transformar un hit de Meilisearch con datos del producto completo
function transformHit(hit: any, product: any): any {
  // Obtener categorías ordenadas por jerarquía
  const sortedCategories = product.categories
    ? sortCategoriesByHierarchy(product.categories).map((category: any) => ({
        id: category.id,
        handle: category.handle,
        name: category.name,
      }))
    : []

  // Construir el hit transformado
  return {
    ...hit,
    handle: product.handle, // ⚠️ Usar el handle real del producto (NO el ID)
    categories: sortedCategories,
    collection_handle: product.collection?.handle || null,
    collection_id: product.collection?.id || null,
  }
}

// Rate limiting ahora se maneja por middleware centralizado en src/api/middlewares.ts

// Handler para OPTIONS (CORS preflight)
export const OPTIONS = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  res.status(200).end()
}

interface SearchRequestBody {
  query: string
  limit?: number
  offset?: number
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  // Declarar query fuera del try para usarlo en el catch
  let query: string | undefined;
  
  try {
    // Rate limiting ahora se maneja por middleware centralizado
    // Los headers X-RateLimit-* se agregan automáticamente por el middleware

    // Parsear y obtener query del body
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as SearchRequestBody
    query = body.query;
    const { limit = 20, offset = 0 } = body

    // Validar query
    const validation = validateSearchQuery(query)
    if (!validation.valid) {
      res.status(400).json({
        message: validation.error,
      })
      return
    }

    // Obtener cliente de Meilisearch
    const client = getMeilisearchClient()
    const index = client.index(MEILISEARCH_INDEX_NAME)

    // Realizar búsqueda con retry logic
    const searchResults = await retryMeilisearchOperation(
      () => index.search(query, {
        limit: Math.min(Number(limit), 100), // Máximo 100 resultados
        offset: Math.max(Number(offset), 0),
      }),
      3, // 3 retries
      1000 // 1 second base delay
    )

    console.log(`[Search] Query: "${query}", Results: ${searchResults.hits.length}`)

    // Obtener ProductModuleService para enriquecer los hits con datos completos
    const productModuleService: IProductModuleService = req.scope.resolve(Modules.PRODUCT)

    // Extraer IDs de productos de los hits
    const productIds = searchResults.hits
      .map((hit: any) => hit.id)
      .filter((id: any) => id != null)

    // Obtener productos completos con relaciones desde la base de datos
    let productsMap = new Map<string, any>()
    if (productIds.length > 0) {
      const products = await productModuleService.listProducts(
        { id: productIds },
        {
          relations: ["categories", "collection"],
        }
      )

      // Crear mapa de productos por ID para acceso rápido
      products.forEach(product => {
        productsMap.set(product.id, product)
      })
    }

    // Transformar hits con datos completos del producto
    const transformedHits = searchResults.hits.map((hit: any) => {
      const product = productsMap.get(hit.id)
      if (product) {
        return transformHit(hit, product)
      }
      // Si no se encuentra el producto, devolver el hit original pero con categorías vacías
      return {
        ...hit,
        categories: [],
        collection_handle: null,
        collection_id: null,
      }
    })

    // Log evento de búsqueda exitosa
    await logSearchEvent(
      AnalyticsEvent.SEARCH_PERFORMED,
      query,
      searchResults.hits.length,
      searchResults.processingTimeMs,
      {
        limit: searchResults.limit,
        offset: searchResults.offset,
        estimated_total: searchResults.estimatedTotalHits,
        client_ip: clientIp,
      }
    )

    // Headers de rate limit se agregan automáticamente por el middleware

    // Retornar resultados transformados
    res.status(200).json({
      hits: transformedHits,
      query: searchResults.query,
      processingTimeMs: searchResults.processingTimeMs,
      limit: searchResults.limit,
      offset: searchResults.offset,
      estimatedTotalHits: searchResults.estimatedTotalHits,
    })
  } catch (error: any) {
    // Determine error type and provide better diagnostics
    const isNetworkError = 
      error?.name === 'MeiliSearchCommunicationError' ||
      error?.message?.includes('fetch failed') ||
      error?.message?.includes('ECONNREFUSED') ||
      error?.message?.includes('ETIMEDOUT') ||
      error?.code === 'ECONNREFUSED' ||
      error?.code === 'ETIMEDOUT';

    if (isNetworkError) {
      console.error("[Search] Network Error:", error.message);
    } else {
      console.error("[Search] Error:", error.message);
    }

    // Reportar error a Crashlytics
    await reportError(
      error instanceof Error ? error : new Error(String(error)),
      ErrorCategory.SEARCH,
      {
        query: query,
        endpoint: req.url,
        method: req.method,
        isNetworkError: isNetworkError,
        errorCode: error?.code,
        errorName: error?.name,
      }
    )

    // Log evento de búsqueda fallida
    await logSearchEvent(
      AnalyticsEvent.SEARCH_FAILED,
      query || 'unknown',
      undefined,
      undefined,
      {
        error: error instanceof Error ? error.message : String(error),
        errorType: isNetworkError ? 'network' : 'other',
      }
    )

    // Provide more specific error message for network errors
    const errorMessage = isNetworkError
      ? "Search service is temporarily unavailable. Please try again in a moment."
      : "An error occurred while searching. Please try again later.";

    res.status(500).json({
      message: errorMessage,
    })
  }
}

// Endpoint GET para compatibilidad (opcional)
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  try {
    const query = req.query.q as string

    if (!query) {
      res.status(400).json({
        message: "Query parameter 'q' is required",
      })
      return
    }

    // Convertir query params a body para reutilizar lógica POST
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : 20
    const offset = req.query.offset
      ? parseInt(req.query.offset as string, 10)
      : 0

    // Llamar a POST handler con body construido
    req.body = { query, limit, offset }
    return POST(req, res)
  } catch (error: any) {
    console.error("[Search GET Error]", error)
    
    // Reportar error a Crashlytics
    await reportError(
      error instanceof Error ? error : new Error(String(error)),
      ErrorCategory.SEARCH,
      {
        query: req.query.q as string,
        endpoint: req.url,
        method: req.method,
      }
    )

    res.status(500).json({
      message: "An error occurred while searching. Please try again later.",
    })
  }
}

