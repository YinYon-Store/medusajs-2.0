import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import MeiliSearch from "meilisearch"
import { MEILISEARCH_HOST, MEILISEARCH_ADMIN_KEY } from "../../../lib/constants"

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

// Rate limiting simple (usar Redis o similar en producción)
const requestCounts = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minuto
const RATE_LIMIT_MAX_REQUESTS = 30 // 30 requests por minuto

function checkRateLimit(ip: string): { allowed: boolean; remaining?: number } {
  const now = Date.now()
  const userLimit = requestCounts.get(ip)

  if (!userLimit || now > userLimit.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 }
  }

  if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false }
  }

  userLimit.count++
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - userLimit.count }
}

// Handler para OPTIONS (CORS preflight)
export const OPTIONS = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  res.status(200).end()
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  try {
    // Rate limiting
    const clientIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      "unknown"
    const rateLimit = checkRateLimit(clientIp)

    if (!rateLimit.allowed) {
      res.status(429).json({
        message: "Too many requests. Please try again later.",
      })
      return
    }

    // Obtener query del body
    const { query, limit = 20, offset = 0 } = req.body

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
    console.log(
      `[Search] Query: "${query}", IP: ${clientIp}, Results: ${searchResults.hits.length}`
    )

    // Agregar headers de rate limit
    if (rateLimit.remaining !== undefined) {
      res.setHeader("X-RateLimit-Remaining", rateLimit.remaining.toString())
      const userLimit = requestCounts.get(clientIp)
      res.setHeader(
        "X-RateLimit-Reset",
        new Date(userLimit?.resetAt || Date.now()).toISOString()
      )
    }

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
    res.status(500).json({
      message: "An error occurred while searching. Please try again later.",
    })
  }
}

