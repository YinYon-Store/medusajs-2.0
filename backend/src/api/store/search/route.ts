import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import MeiliSearch from "meilisearch"
import { MEILISEARCH_HOST, MEILISEARCH_ADMIN_KEY } from "../../../lib/constants"
import { reportError, ErrorCategory, logSearchEvent, AnalyticsEvent } from "../../../lib/firebase-service"

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
  try {
    // Rate limiting ahora se maneja por middleware centralizado
    // Los headers X-RateLimit-* se agregan automáticamente por el middleware

    // Parsear y obtener query del body
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as SearchRequestBody
    const { query, limit = 20, offset = 0 } = body

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

    // Realizar búsqueda
    const searchResults = await index.search(query, {
      limit: Math.min(Number(limit), 100), // Máximo 100 resultados
      offset: Math.max(Number(offset), 0),
    })

    // Logging (opcional, para auditoría)
    const clientIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      "unknown"
    console.log(
      `[Search] Query: "${query}", IP: ${clientIp}, Results: ${searchResults.hits.length}`
    )

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

    // Retornar resultados
    res.status(200).json({
      hits: searchResults.hits,
      query: searchResults.query,
      processingTimeMs: searchResults.processingTimeMs,
      limit: searchResults.limit,
      offset: searchResults.offset,
      estimatedTotalHits: searchResults.estimatedTotalHits,
    })
  } catch (error: any) {
    console.error("[Search Error]", error)

    // Reportar error a Crashlytics
    await reportError(
      error instanceof Error ? error : new Error(String(error)),
      ErrorCategory.SEARCH,
      {
        query: query,
        endpoint: req.url,
        method: req.method,
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
      }
    )

    // No exponer detalles internos al cliente
    res.status(500).json({
      message: "An error occurred while searching. Please try again later.",
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

