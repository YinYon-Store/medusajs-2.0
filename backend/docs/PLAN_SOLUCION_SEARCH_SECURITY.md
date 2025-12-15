# Plan de Solución: Seguridad de Búsqueda con Meilisearch

## 📋 Resumen Ejecutivo

**Problema:** La búsqueda se comunica directamente con Meilisearch desde el cliente, exponiendo credenciales y sin control del backend.

**Solución:** Implementar un endpoint en Medusa backend que actúe como proxy seguro, manteniendo las credenciales en el servidor y agregando validación y control.

**Arquitectura Objetivo:**
```
Cliente (Frontend) → Medusa Backend (/store/search) → Meilisearch
```

---

## 🎯 Objetivos

1. ✅ Eliminar exposición de credenciales de Meilisearch al cliente
2. ✅ Centralizar búsquedas a través del backend de Medusa
3. ✅ Implementar validación de queries
4. ✅ Agregar rate limiting básico
5. ✅ Mantener compatibilidad con la UI existente
6. ✅ Preservar funcionalidad de búsqueda instantánea

---

## 🏗️ Arquitectura de la Solución

### Flujo Actual (Inseguro)
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

### Flujo Objetivo (Seguro)
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

## 📦 PARTE 1: BACKEND (Medusa 2.0)

### Tarea 1.1: Verificar Plugin de Meilisearch

**Objetivo:** Confirmar si el plugin `@medusajs/medusa-plugin-meilisearch` está instalado y configurado.

**Pasos:**
1. Revisar `package.json` del backend de Medusa
2. Verificar si existe el plugin instalado
3. Si no existe, documentar la necesidad de instalarlo
4. Revisar configuración en `medusa-config.js` o `medusa-config.ts`

**Archivos a revisar:**
- `backend/package.json`
- `backend/medusa-config.js` o `backend/medusa-config.ts`
- `backend/src/loaders/` (si existe configuración de plugins)

**Resultado esperado:**
- Documentar estado actual del plugin
- Si no existe, preparar instalación

---

### Tarea 1.2: Crear Endpoint de Búsqueda en Medusa

**Objetivo:** Crear un endpoint `/store/search` en Medusa que actúe como proxy seguro.

**Ubicación:** `backend/src/api/store/search/route.ts` (o equivalente según estructura)

**Implementación:**

```typescript
import type { MedusaRequest, MedusaResponse } from "@medusajs/medusa"
import MeiliSearch from "meilisearch"

// Configuración desde variables de entorno privadas
const MEILISEARCH_HOST = process.env.MEILISEARCH_HOST || "http://localhost:7700"
const MEILISEARCH_API_KEY = process.env.MEILISEARCH_API_KEY || ""
const MEILISEARCH_INDEX_NAME = process.env.MEILISEARCH_INDEX_NAME || "products"

// Cliente de Meilisearch (solo en servidor)
let meilisearchClient: MeiliSearch | null = null

function getMeilisearchClient(): MeiliSearch {
  if (!meilisearchClient) {
    meilisearchClient = new MeiliSearch({
      host: MEILISEARCH_HOST,
      apiKey: MEILISEARCH_API_KEY,
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

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    // Rate limiting
    const clientIp = req.ip || req.headers["x-forwarded-for"] || "unknown"
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
      limit: Math.min(limit, 100), // Máximo 100 resultados
      offset: Math.max(offset, 0),
    })

    // Logging (opcional, para auditoría)
    console.log(`[Search] Query: "${query}", IP: ${clientIp}, Results: ${searchResults.hits.length}`)

    // Retornar resultados
    res.status(200).json({
      hits: searchResults.hits,
      query: searchResults.query,
      processingTimeMs: searchResults.processingTimeMs,
      limit: searchResults.limit,
      offset: searchResults.offset,
      estimatedTotalHits: searchResults.estimatedTotalHits,
      // Agregar header de rate limit
      ...(rateLimit.remaining !== undefined && {
        "X-RateLimit-Remaining": rateLimit.remaining.toString(),
        "X-RateLimit-Reset": new Date(
          requestCounts.get(clientIp)?.resetAt || Date.now()
        ).toISOString(),
      }),
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
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const query = req.query.q as string
  
  if (!query) {
    res.status(400).json({
      message: "Query parameter 'q' is required",
    })
    return
  }

  // Reutilizar lógica POST
  req.body = { query, limit: req.query.limit, offset: req.query.offset }
  return POST(req, res)
}
```

**Archivos a crear/modificar:**
- `backend/src/api/store/search/route.ts` (o ruta equivalente según estructura de Medusa 2.0)

**Notas importantes:**
- Ajustar la estructura de rutas según la versión de Medusa 2.0
- En Medusa 2.0, las rutas pueden estar en `src/api/store/routes/search.ts` o similar
- Verificar documentación de Medusa 2.0 para estructura exacta de rutas

---

### Tarea 1.3: Configurar Variables de Entorno Privadas

**Objetivo:** Mover credenciales de Meilisearch a variables de entorno privadas en el backend.

**Archivo:** `.env` del backend de Medusa

**Variables a agregar:**
```bash
# Meilisearch Configuration (Backend only - NO exponer al frontend)
MEILISEARCH_HOST=http://localhost:7700
MEILISEARCH_API_KEY=your_secure_api_key_here
MEILISEARCH_INDEX_NAME=products
```

**Variables a ELIMINAR del frontend:**
- `NEXT_PUBLIC_SEARCH_ENDPOINT` (ya no se necesita)
- `NEXT_PUBLIC_SEARCH_API_KEY` (ya no se necesita)

**Archivos a modificar:**
- `backend/.env` o `backend/.env.example`
- Documentar en README del backend

---

### Tarea 1.4: Implementar Rate Limiting Avanzado (Opcional pero Recomendado)

**Objetivo:** Reemplazar rate limiting simple con solución más robusta.

**Opciones:**
1. **Redis** (recomendado para producción)
2. **Medusa Rate Limiting Plugin** (si existe)
3. **Express Rate Limit** (si Medusa usa Express)

**Implementación con Redis (ejemplo):**

```typescript
import Redis from "ioredis"

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379")

async function checkRateLimitRedis(ip: string): Promise<{ allowed: boolean; remaining?: number }> {
  const key = `search:ratelimit:${ip}`
  const window = 60 // 1 minuto
  const maxRequests = 30

  const current = await redis.incr(key)
  
  if (current === 1) {
    await redis.expire(key, window)
  }

  const remaining = Math.max(0, maxRequests - current)
  
  return {
    allowed: current <= maxRequests,
    remaining,
  }
}
```

**Dependencias a agregar:**
```bash
npm install ioredis
npm install --save-dev @types/ioredis
```

---

### Tarea 1.5: Agregar Logging y Métricas

**Objetivo:** Implementar logging para auditoría y monitoreo.

**Implementación básica:**

```typescript
// Agregar al endpoint de búsqueda
import { Logger } from "@medusajs/medusa"

const logger = new Logger({ name: "search" })

// En el handler POST:
logger.info("Search request", {
  query,
  ip: clientIp,
  resultsCount: searchResults.hits.length,
  processingTime: searchResults.processingTimeMs,
})
```

**Métricas a registrar:**
- Query realizada
- IP del cliente
- Número de resultados
- Tiempo de procesamiento
- Errores (si los hay)

---

## 🎨 PARTE 2: FRONTEND (Next.js)

### Tarea 2.1: Crear Cliente de Búsqueda Seguro

**Objetivo:** Crear un nuevo cliente de búsqueda que use el endpoint de Medusa en lugar de conexión directa.

**Archivo a crear:** `src/lib/search-client-secure.ts`

**Implementación:**

```typescript
"use server"

import { SEARCH_INDEX_NAME } from "./search-client"

// Cliente seguro que usa el backend de Medusa
export interface SearchHit {
  objectID?: string
  id?: string
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

/**
 * Cliente de búsqueda seguro que usa el backend de Medusa
 * Las credenciales de Meilisearch están protegidas en el servidor
 */
export async function secureSearch(
  query: string,
  options?: {
    limit?: number
    offset?: number
  }
): Promise<SearchResponse> {
  const backendUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"
  
  if (!query || typeof query !== "string") {
    throw new Error("Query is required and must be a string")
  }

  try {
    const response = await fetch(`${backendUrl}/store/search`, {
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

/**
 * Obtiene solo los hits de la búsqueda (compatibilidad con código existente)
 */
export async function searchHits(
  query: string,
  options?: { limit?: number; offset?: number }
): Promise<SearchHit[]> {
  const response = await secureSearch(query, options)
  return response.hits
}
```

**Archivos a crear:**
- `src/lib/search-client-secure.ts`

---

### Tarea 2.2: Crear Wrapper de Cliente para InstantSearch

**Objetivo:** Crear un cliente compatible con `react-instantsearch-hooks-web` que use el backend seguro.

**Archivo a crear:** `src/lib/search-client-instant.ts`

**Implementación:**

```typescript
"use client"

import { secureSearch } from "./search-client-secure"

/**
 * Cliente compatible con InstantSearch que usa el backend seguro
 * Este cliente se usa en componentes del cliente
 */
export function createSecureSearchClient() {
  return {
    search: async (requests: Array<{ indexName: string; params: { query: string } }>) => {
      const backendUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"
      
      // Procesar todas las requests
      const results = await Promise.all(
        requests.map(async (request) => {
          try {
            const response = await fetch(`${backendUrl}/store/search`, {
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

**Archivos a crear:**
- `src/lib/search-client-instant.ts`

---

### Tarea 2.3: Actualizar search-client.ts

**Objetivo:** Modificar el cliente existente para usar el backend seguro en lugar de conexión directa.

**Archivo a modificar:** `src/lib/search-client.ts`

**Cambios:**

```typescript
// OPCIÓN 1: Reemplazar completamente (recomendado)
import { createSecureSearchClient } from "./search-client-instant"

export const searchClient = createSecureSearchClient()

export const SEARCH_INDEX_NAME =
  process.env.NEXT_PUBLIC_INDEX_NAME || "products"

// OPCIÓN 2: Mantener compatibilidad con fallback
// (Solo si necesitas migración gradual)

// import { instantMeiliSearch } from "@meilisearch/instant-meilisearch"
// import { createSecureSearchClient } from "./search-client-instant"

// const useSecureSearch = process.env.NEXT_PUBLIC_USE_SECURE_SEARCH === "true"

// export const searchClient = useSecureSearch
//   ? createSecureSearchClient()
//   : instantMeiliSearch(
//       process.env.NEXT_PUBLIC_SEARCH_ENDPOINT || "http://127.0.0.1:7700",
//       process.env.NEXT_PUBLIC_SEARCH_API_KEY || "test_key"
//     )

// export const SEARCH_INDEX_NAME =
//   process.env.NEXT_PUBLIC_INDEX_NAME || "products"
```

**Archivos a modificar:**
- `src/lib/search-client.ts`

---

### Tarea 2.4: Actualizar Server Action de Búsqueda

**Objetivo:** Modificar el server action para usar el cliente seguro.

**Archivo a modificar:** `src/modules/search/actions.ts`

**Cambios:**

```typescript
"use server"

import { searchHits } from "@lib/search-client-secure"

interface Hits {
  readonly objectID?: string
  id?: string
  [x: string | number | symbol]: unknown
}

/**
 * Uses secure search through Medusa backend
 * @param {string} query - search query
 */
export async function search(query: string): Promise<Hits[]> {
  try {
    const hits = await searchHits(query, { limit: 20 })
    return hits as Hits[]
  } catch (error: any) {
    console.error("[Search Action Error]", error)
    // Retornar array vacío en caso de error para no romper la UI
    return []
  }
}
```

**Archivos a modificar:**
- `src/modules/search/actions.ts`

---

### Tarea 2.5: Actualizar Variables de Entorno

**Objetivo:** Eliminar variables expuestas y documentar cambios.

**Archivo a modificar:** `.env.local` o `.env`

**Variables a ELIMINAR:**
```bash
# ❌ ELIMINAR estas líneas
# NEXT_PUBLIC_SEARCH_ENDPOINT=http://127.0.0.1:7700
# NEXT_PUBLIC_SEARCH_API_KEY=test_key
```

**Variables a MANTENER:**
```bash
# ✅ MANTENER estas (ya existen)
NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_xxx
NEXT_PUBLIC_INDEX_NAME=products
```

**Archivos a modificar:**
- `.env.local`
- `.env.example` (si existe)
- Documentar en README

---

### Tarea 2.6: Verificar y Actualizar Componentes

**Objetivo:** Asegurar que todos los componentes usen el cliente actualizado.

**Archivos a verificar:**
- ✅ `src/modules/search/templates/search-modal/index.tsx` - Ya usa `searchClient` (se actualizará automáticamente)
- ✅ `src/modules/search/components/search-box-wrapper/index.tsx` - No requiere cambios
- ✅ `src/app/[countryCode]/(main)/results/[query]/page.tsx` - Ya usa `search()` action (se actualizará automáticamente)

**Acción:** Solo verificar que no haya imports directos de Meilisearch en componentes.

**Comando de verificación:**
```bash
grep -r "instantMeiliSearch\|meilisearch" src/ --exclude-dir=node_modules
```

---

## 🧪 PARTE 3: TESTING Y VALIDACIÓN

### Tarea 3.1: Testing del Backend

**Objetivos:**
1. Verificar que el endpoint responde correctamente
2. Validar rate limiting
3. Validar manejo de errores

**Tests a realizar:**

```bash
# Test 1: Búsqueda básica
curl -X POST http://localhost:9000/store/search \
  -H "Content-Type: application/json" \
  -H "x-publishable-api-key: pk_xxx" \
  -d '{"query": "perfume", "limit": 10}'

# Test 2: Validación de query vacía
curl -X POST http://localhost:9000/store/search \
  -H "Content-Type: application/json" \
  -H "x-publishable-api-key: pk_xxx" \
  -d '{"query": ""}'

# Test 3: Rate limiting (ejecutar 31 veces rápidamente)
for i in {1..31}; do
  curl -X POST http://localhost:9000/store/search \
    -H "Content-Type: application/json" \
    -H "x-publishable-api-key: pk_xxx" \
    -d '{"query": "test"}'
done
```

---

### Tarea 3.2: Testing del Frontend

**Objetivos:**
1. Verificar que la búsqueda funciona en el modal
2. Verificar que la página de resultados funciona
3. Verificar que no hay errores en consola

**Tests manuales:**
1. Abrir modal de búsqueda
2. Escribir query y verificar resultados
3. Navegar a página de resultados
4. Verificar que no hay requests directos a Meilisearch en Network tab
5. Verificar que todas las requests van a `/store/search`

**Verificación en DevTools:**
- Network tab: No debe haber requests a `localhost:7700` (Meilisearch)
- Network tab: Debe haber requests a `/store/search` del backend
- Console: No debe haber errores relacionados con Meilisearch

---

### Tarea 3.3: Verificación de Seguridad

**Checklist:**
- [ ] Variables `NEXT_PUBLIC_SEARCH_*` eliminadas del frontend
- [ ] No hay credenciales de Meilisearch en el código del cliente
- [ ] Todas las búsquedas pasan por el backend
- [ ] Rate limiting funciona
- [ ] Validación de queries funciona
- [ ] Errores no exponen información sensible

**Comando de verificación:**
```bash
# Buscar cualquier referencia a credenciales expuestas
grep -r "NEXT_PUBLIC_SEARCH" src/
# No debe retornar resultados (excepto en comentarios/documentación)
```

---

## 📝 PARTE 4: DOCUMENTACIÓN

### Tarea 4.1: Actualizar README

**Sección a agregar/actualizar:**

```markdown
## Búsqueda Segura

La búsqueda se realiza a través del backend de Medusa para mantener las credenciales de Meilisearch seguras.

### Configuración Backend

Variables de entorno requeridas en el backend:
- `MEILISEARCH_HOST`: URL del servidor Meilisearch
- `MEILISEARCH_API_KEY`: API key de Meilisearch
- `MEILISEARCH_INDEX_NAME`: Nombre del índice (default: "products")

### Configuración Frontend

Variables de entorno requeridas en el frontend:
- `NEXT_PUBLIC_MEDUSA_BACKEND_URL`: URL del backend de Medusa
- `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`: Publishable key de Medusa
- `NEXT_PUBLIC_INDEX_NAME`: Nombre del índice (default: "products")

**Nota:** Las credenciales de Meilisearch NO deben estar en el frontend.
```

---

## 🚀 ORDEN DE EJECUCIÓN RECOMENDADO

### Fase 1: Backend (Ejecutar primero)
1. ✅ Tarea 1.1: Verificar plugin de Meilisearch
2. ✅ Tarea 1.2: Crear endpoint de búsqueda
3. ✅ Tarea 1.3: Configurar variables de entorno
4. ✅ Tarea 1.4: Implementar rate limiting (opcional pero recomendado)
5. ✅ Tarea 1.5: Agregar logging
6. ✅ Tarea 3.1: Testing del backend

### Fase 2: Frontend (Ejecutar después del backend)
1. ✅ Tarea 2.1: Crear cliente de búsqueda seguro
2. ✅ Tarea 2.2: Crear wrapper para InstantSearch
3. ✅ Tarea 2.3: Actualizar search-client.ts
4. ✅ Tarea 2.4: Actualizar server action
5. ✅ Tarea 2.5: Actualizar variables de entorno
6. ✅ Tarea 2.6: Verificar componentes
7. ✅ Tarea 3.2: Testing del frontend
8. ✅ Tarea 3.3: Verificación de seguridad

### Fase 3: Documentación
1. ✅ Tarea 4.1: Actualizar README

---

## ⚠️ CONSIDERACIONES IMPORTANTES

### Compatibilidad con Medusa 2.0

- **Estructura de rutas:** Medusa 2.0 puede tener una estructura diferente de rutas. Verificar documentación oficial.
- **Tipos:** Usar tipos de `@medusajs/types` para mantener compatibilidad.
- **SDK:** El frontend ya usa `@medusajs/js-sdk`, mantener consistencia.

### Migración Gradual (Opcional)

Si necesitas migración gradual sin downtime:

1. Implementar endpoint en backend
2. Agregar feature flag `NEXT_PUBLIC_USE_SECURE_SEARCH`
3. Mantener ambos clientes (directo y seguro)
4. Activar feature flag gradualmente
5. Eliminar cliente directo una vez validado

### Performance

- **Caching:** Considerar agregar caching en el endpoint de búsqueda si es necesario
- **Connection Pooling:** Meilisearch client debe reutilizar conexiones
- **Timeout:** Configurar timeouts apropiados

### Rate Limiting en Producción

El rate limiting simple implementado es suficiente para desarrollo, pero en producción se recomienda:
- Redis para rate limiting distribuido
- Configuración por usuario autenticado vs anónimo
- Diferentes límites según tipo de búsqueda

---

## 🔍 VERIFICACIÓN FINAL

Antes de considerar la tarea completa, verificar:

- [ ] Backend responde en `/store/search`
- [ ] Frontend no tiene credenciales expuestas
- [ ] Búsqueda funciona en modal
- [ ] Búsqueda funciona en página de resultados
- [ ] Rate limiting funciona
- [ ] No hay errores en consola
- [ ] No hay requests directos a Meilisearch desde el cliente
- [ ] Documentación actualizada

---

## 📞 SOPORTE

Si encuentras problemas durante la implementación:

1. Verificar logs del backend de Medusa
2. Verificar logs del frontend (consola del navegador)
3. Verificar que Meilisearch esté corriendo y accesible desde el backend
4. Verificar variables de entorno en ambos proyectos

---

**Fecha de creación:** $(date)
**Versión:** 1.0
**Estado:** Listo para ejecución

