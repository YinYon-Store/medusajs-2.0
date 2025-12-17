# Sistema de Búsqueda Seguro con Meilisearch

## 📋 Índice

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Arquitectura](#arquitectura)
3. [Backend: Implementación](#backend-implementación)
4. [Frontend: Implementación](#frontend-implementación)
5. [API Endpoints](#api-endpoints)
6. [Ejemplos y Pruebas](#ejemplos-y-pruebas)

---

## Resumen Ejecutivo

### Problema

La búsqueda se comunicaba directamente con Meilisearch desde el cliente, exponiendo credenciales y sin control del backend.

### Solución

Implementar un endpoint en Medusa backend que actúe como proxy seguro, manteniendo las credenciales en el servidor y agregando validación y control.

### Arquitectura Objetivo

```
Cliente (Frontend) → Medusa Backend (/store/search) → Meilisearch
```

---

## Arquitectura

### Flujo Actual (Inseguro) ❌

```
┌─────────┐
│ Cliente │
│(Browser)│
└────┬────┘
     │
     │ Conexión directa
     │ (Credenciales expuestas)
     ▼
┌─────────────┐
│ Meilisearch │
└─────────────┘
```

### Flujo Objetivo (Seguro) ✅

```
┌─────────┐
│ Cliente │
│(Browser)│
└────┬────┘
     │
     │ POST /store/search
     │ (Solo query, sin credenciales)
     ▼
┌─────────────────┐
│ Medusa Backend  │
│ /store/search   │
│                 │
│ - Validación    │
│ - Rate Limit    │
│ - Logging       │
└────┬────────────┘
     │
     │ Conexión segura
     │ (Credenciales privadas)
     ▼
┌─────────────┐
│ Meilisearch │
└─────────────┘
```

---

## Backend: Implementación

### Ubicación

```
src/api/store/search/route.ts
```

### Características

- ✅ **Seguridad**: Credenciales de Meilisearch protegidas en el servidor
- ✅ **Validación**: Validación de queries de entrada
- ✅ **Rate Limiting**: 30 requests por minuto por IP
- ✅ **Logging**: Registro de búsquedas para auditoría
- ✅ **Doble endpoint**: POST y GET para compatibilidad

### Variables de Entorno

```bash
# Meilisearch Configuration (Backend only - NO exponer al frontend)
MEILISEARCH_HOST=http://localhost:7700
MEILISEARCH_API_KEY=your_secure_api_key_here
MEILISEARCH_INDEX_NAME=products
```

### Validación

- Longitud máxima de query: 200 caracteres
- Validación de caracteres peligrosos
- Validación de tipos de datos
- Límite máximo de resultados: 100 por request

### Rate Limiting

- **Límite:** 30 requests por minuto por IP
- **Headers de respuesta:**
  - `X-RateLimit-Remaining`: Requests restantes
  - `X-RateLimit-Reset`: Timestamp ISO del reseteo

---

## Frontend: Implementación

### Opción 1: Cliente de Búsqueda Simple (Server Actions)

Para uso en Server Components o Server Actions de Next.js:

**Archivo:** `src/lib/search-client-secure.ts`

```typescript
"use server"

const BACKEND_URL = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"

export interface SearchHit {
  objectID?: string
  id?: string
  title?: string
  description?: string
  handle?: string
  thumbnail?: string
  [key: string]: any
}

export interface SearchResponse {
  hits: SearchHit[]
  query: string
  processingTimeMs: number
  limit: number
  offset: number
  estimatedTotalHits: number
}

export async function secureSearch(
  query: string,
  options?: {
    limit?: number
    offset?: number
  }
): Promise<SearchResponse> {
  if (!query || typeof query !== "string") {
    throw new Error("Query is required and must be a string")
  }

  try {
    const response = await fetch(`${BACKEND_URL}/store/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || "",
      },
      body: JSON.stringify({
        query: query.trim(),
        limit: options?.limit || 20,
        offset: options?.offset || 0,
      }),
    })

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Too many requests. Please try again later.")
      }
      if (response.status === 400) {
        const error = await response.json()
        throw new Error(error.message || "Invalid search query")
      }
      throw new Error(`Search failed: ${response.status}`)
    }

    const data: SearchResponse = await response.json()
    return data
  } catch (error: any) {
    console.error("[Search Error]", error)
    throw error
  }
}

export async function searchHits(
  query: string,
  options?: { limit?: number; offset?: number }
): Promise<SearchHit[]> {
  const response = await secureSearch(query, options)
  return response.hits
}
```

---

### Opción 2: Hook para Client Components (React)

**Archivo:** `src/hooks/use-search.ts`

```typescript
"use client"

import { useState, useCallback } from "react"

const BACKEND_URL = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"

export interface UseSearchReturn {
  results: SearchHit[]
  isLoading: boolean
  error: string | null
  search: (query: string, options?: { limit?: number; offset?: number }) => Promise<void>
  totalHits: number
}

export function useSearch(): UseSearchReturn {
  const [results, setResults] = useState<SearchHit[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalHits, setTotalHits] = useState(0)

  const search = useCallback(async (
    query: string,
    options?: { limit?: number; offset?: number }
  ) => {
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      setResults([])
      setTotalHits(0)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`${BACKEND_URL}/store/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || "",
        },
        body: JSON.stringify({
          query: query.trim(),
          limit: options?.limit || 20,
          offset: options?.offset || 0,
        }),
      })

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Too many requests. Please try again later.")
        }
        if (response.status === 400) {
          const errorData = await response.json()
          throw new Error(errorData.message || "Invalid search query")
        }
        throw new Error(`Search failed: ${response.status}`)
      }

      const data: SearchResponse = await response.json()
      setResults(data.hits)
      setTotalHits(data.estimatedTotalHits)
    } catch (err: any) {
      console.error("[Search Error]", err)
      setError(err.message || "An error occurred while searching")
      setResults([])
      setTotalHits(0)
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    results,
    isLoading,
    error,
    search,
    totalHits,
  }
}
```

---

### Opción 3: Cliente para InstantSearch (React InstantSearch Hooks)

**Archivo:** `src/lib/search-client-instant.ts`

```typescript
"use client"

const BACKEND_URL = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"

export function createSecureSearchClient() {
  return {
    search: async (requests: Array<{ indexName: string; params: { query: string } }>) => {
      const results = await Promise.all(
        requests.map(async (request) => {
          try {
            const response = await fetch(`${BACKEND_URL}/store/search`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || "",
              },
              body: JSON.stringify({
                query: request.params.query || "",
                limit: 20,
                offset: 0,
              }),
            })

            if (!response.ok) {
              throw new Error(`Search failed: ${response.status}`)
            }

            const data = await response.json()

            return {
              index: request.indexName,
              hits: data.hits,
              nbHits: data.estimatedTotalHits,
              page: 0,
              nbPages: Math.ceil(data.estimatedTotalHits / 20),
              hitsPerPage: 20,
              processingTimeMS: data.processingTimeMs,
              query: data.query,
              params: request.params.query,
            }
          } catch (error) {
            console.error("[InstantSearch Error]", error)
            return {
              index: request.indexName,
              hits: [],
              nbHits: 0,
              page: 0,
              nbPages: 0,
              hitsPerPage: 20,
              processingTimeMS: 0,
              query: request.params.query || "",
              params: request.params.query,
            }
          }
        })
      )

      return {
        results,
      }
    },
  }
}
```

---

## API Endpoints

### POST /store/search

Endpoint principal para realizar búsquedas.

**Headers:**
```
Content-Type: application/json
x-publishable-api-key: pk_xxx (opcional, si está configurado)
```

**Body:**
```json
{
  "query": "perfume",
  "limit": 20,
  "offset": 0
}
```

**Parámetros:**
- `query` (string, requerido): Término de búsqueda
- `limit` (number, opcional): Número máximo de resultados (default: 20, máximo: 100)
- `offset` (number, opcional): Desplazamiento para paginación (default: 0)

**Response Exitoso (200 OK):**
```json
{
  "hits": [
    {
      "id": "prod_xxx",
      "title": "Perfume Ejemplo",
      "description": "Descripción del producto",
      "handle": "perfume-ejemplo",
      "thumbnail": "https://..."
    }
  ],
  "query": "perfume",
  "processingTimeMs": 15,
  "limit": 20,
  "offset": 0,
  "estimatedTotalHits": 45
}
```

**Headers de respuesta:**
- `X-RateLimit-Remaining`: Número de requests restantes
- `X-RateLimit-Reset`: Timestamp ISO del reseteo del rate limit

**Errores:**

**400 Bad Request** - Query inválida:
```json
{
  "message": "Query is required and must be a string"
}
```

**429 Too Many Requests** - Rate limit excedido:
```json
{
  "message": "Too many requests. Please try again later."
}
```

**500 Internal Server Error:**
```json
{
  "message": "An error occurred while searching. Please try again later."
}
```

---

### GET /store/search

Endpoint alternativo para búsquedas con query parameters.

**Request:**
```
GET /store/search?q=perfume&limit=20&offset=0
```

**Query Parameters:**
- `q` (string, requerido): Término de búsqueda
- `limit` (number, opcional): Número máximo de resultados (default: 20)
- `offset` (number, opcional): Desplazamiento para paginación (default: 0)

**Response:** Mismo formato que el endpoint POST.

---

## Ejemplos y Pruebas

### cURL - POST Request

```bash
curl -X POST http://localhost:9000/store/search \
  -H "Content-Type: application/json" \
  -H "x-publishable-api-key: pk_xxx" \
  -d '{
    "query": "perfume",
    "limit": 10,
    "offset": 0
  }'
```

### cURL - GET Request

```bash
curl "http://localhost:9000/store/search?q=perfume&limit=10&offset=0" \
  -H "x-publishable-api-key: pk_xxx"
```

### JavaScript Fetch

```javascript
async function searchProducts(query, limit = 20) {
  try {
    const response = await fetch("http://localhost:9000/store/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-publishable-api-key": "pk_xxx",
      },
      body: JSON.stringify({
        query: query,
        limit: limit,
        offset: 0,
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    console.log("Results:", data.hits)
    console.log("Total:", data.estimatedTotalHits)
    return data
  } catch (error) {
    console.error("Search error:", error)
    throw error
  }
}

// Uso
searchProducts("perfume", 10)
```

---

## Consideraciones de Seguridad

1. **Credenciales Protegidas**: Las credenciales de Meilisearch (`MEILISEARCH_ADMIN_KEY`) nunca se exponen al cliente.

2. **Validación de Input**: 
   - Longitud máxima de query: 200 caracteres
   - Validación de caracteres peligrosos
   - Validación de tipos de datos

3. **Rate Limiting**: 
   - 30 requests por minuto por IP
   - Headers `X-RateLimit-Remaining` y `X-RateLimit-Reset` en respuesta

4. **Manejo de Errores**: 
   - No se exponen detalles internos al cliente
   - Mensajes de error genéricos para el cliente

---

## Variables de Entorno

### Backend
```bash
MEILISEARCH_HOST=http://localhost:7700
MEILISEARCH_API_KEY=your_secure_api_key_here
MEILISEARCH_INDEX_NAME=products
```

### Frontend
```bash
NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_xxx
NEXT_PUBLIC_INDEX_NAME=products
```

**⚠️ IMPORTANTE:** Las credenciales de Meilisearch NO deben estar en el frontend.

---

## Notas Importantes

- El endpoint usa el índice `"products"` configurado en el plugin de Meilisearch
- Los campos buscables son: `title`, `description` (según configuración del plugin)
- Los campos retornados incluyen: `id`, `handle`, `title`, `description`, `thumbnail`
- El rate limiting es simple (en memoria). Para producción, considera usar Redis
- El límite máximo de resultados es 100 por request

---

## Próximos Pasos

1. **Migrar Frontend**: Reemplazar conexiones directas a Meilisearch por llamadas a este endpoint
2. **Rate Limiting Avanzado**: Implementar rate limiting con Redis para producción
3. **Caching**: Considerar agregar caché para queries frecuentes
4. **Métricas**: Implementar tracking de búsquedas para análisis

---

**Última actualización:** 2025-01-12
**Versión:** 1.0.0

