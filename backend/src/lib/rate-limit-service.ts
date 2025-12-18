import { createClient, RedisClientType } from "redis";
import { REDIS_URL, RATE_LIMIT_ENABLED } from "./constants";
import type { MedusaRequest } from "@medusajs/framework/http";

/**
 * Estrategia de identificación para rate limiting
 */
export type RateLimitIdentifier = 'ip' | 'user' | 'api-key' | 'custom';

/**
 * Estrategia de ventana de tiempo
 */
export type RateLimitStrategy = 'fixed' | 'sliding';

/**
 * Configuración de rate limiting
 */
export interface RateLimitConfig {
  windowMs: number;        // Ventana de tiempo en ms
  maxRequests: number;     // Máximo de requests
  strategy: RateLimitStrategy;
  identifier: RateLimitIdentifier;
  keyGenerator?: (req: MedusaRequest) => string; // Función personalizada para generar key
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

/**
 * Resultado del check de rate limit
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining?: number;
  resetAt?: number;
  total?: number;
}

/**
 * Cliente Redis singleton para rate limiting
 */
let redisClient: RedisClientType | null = null;
let redisConnected = false;

/**
 * Inicializa el cliente Redis si está disponible
 */
async function getRedisClient(): Promise<RedisClientType | null> {
  if (!REDIS_URL) {
    return null;
  }

  if (redisClient && redisConnected) {
    return redisClient;
  }

  try {
    const client = createClient({
      url: REDIS_URL,
    });

    client.on("error", (err) => {
      console.error("Rate Limit Redis Client Error:", err);
      redisConnected = false;
    });

    client.on("connect", () => {
      console.log("Rate Limit Redis Client Connected");
      redisConnected = true;
    });

    await client.connect();
    redisClient = client as RedisClientType;
    redisConnected = true;
    return redisClient;
  } catch (error) {
    console.warn("Failed to connect to Redis for rate limiting, will use in-memory fallback:", error);
    redisConnected = false;
    return null;
  }
}

/**
 * Fallback en memoria cuando Redis no está disponible
 */
const inMemoryStore = new Map<string, { count: number; resetAt: number; windowStart: number }>();

/**
 * Extrae el identificador del request según la estrategia
 */
function getIdentifier(req: MedusaRequest, strategy: RateLimitIdentifier, customKeyGenerator?: (req: MedusaRequest) => string): string {
  if (customKeyGenerator) {
    return customKeyGenerator(req);
  }

  switch (strategy) {
    case 'ip':
      // Extraer IP real (considerando proxies)
      return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || 
             req.ip || 
             "unknown";
    case 'user':
      // Extraer user ID del JWT token
      // @ts-ignore - auth puede no estar tipado en MedusaRequest
      return req.auth?.actor_id || req.auth?.auth_user_id || 'anonymous';
    case 'api-key':
      // Extraer API key del header
      return (req.headers["x-api-key"] as string) || 'no-key';
    default:
      return 'unknown';
  }
}

/**
 * Genera la key de Redis para rate limiting
 */
function generateRedisKey(identifier: string, endpoint: string, windowMs: number): string {
  // Para fixed window, usar timestamp redondeado
  // Para sliding window, usar solo el identificador y endpoint
  const windowKey = Math.floor(Date.now() / windowMs);
  return `rate_limit:${identifier}:${endpoint}:${windowKey}`;
}

/**
 * Fixed Window Rate Limiting
 */
async function checkFixedWindow(
  redis: RedisClientType | null,
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const redisKey = `${key}:${windowStart}`;
  const ttl = Math.ceil((windowStart + windowMs - now) / 1000);

  if (redis) {
    try {
      // Usar operaciones atómicas de Redis
      const current = await redis.incr(redisKey);
      
      if (current === 1) {
        // Primera request en esta ventana, establecer TTL
        await redis.expire(redisKey, ttl);
      }

      const remaining = Math.max(0, maxRequests - current);
      const resetAt = windowStart + windowMs;

      return {
        allowed: current <= maxRequests,
        remaining,
        resetAt,
        total: current,
      };
    } catch (error) {
      console.error("Redis error in rate limiting, falling back to memory:", error);
      // Fallback a memoria
    }
  }

  // Fallback en memoria
  const stored = inMemoryStore.get(redisKey);
  if (!stored || now >= stored.resetAt) {
    inMemoryStore.set(redisKey, {
      count: 1,
      resetAt: windowStart + windowMs,
      windowStart,
    });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt: windowStart + windowMs,
      total: 1,
    };
  }

  if (stored.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: stored.resetAt,
      total: stored.count,
    };
  }

  stored.count++;
  return {
    allowed: true,
    remaining: maxRequests - stored.count,
    resetAt: stored.resetAt,
    total: stored.count,
  };
}

/**
 * Sliding Window Rate Limiting usando sorted set de Redis
 */
async function checkSlidingWindow(
  redis: RedisClientType | null,
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - windowMs;
  const redisKey = `rate_limit:sliding:${key}`;

  if (redis) {
    try {
      // Usar sorted set para sliding window
      // Cada request se guarda con timestamp como score
      const pipeline = redis.multi();
      
      // Agregar request actual
      pipeline.zAdd(redisKey, { score: now, value: `${now}-${Math.random()}` });
      
      // Remover requests fuera de la ventana
      pipeline.zRemRangeByScore(redisKey, 0, windowStart);
      
      // Contar requests en la ventana
      pipeline.zCard(redisKey);
      
      // Establecer TTL
      pipeline.expire(redisKey, Math.ceil(windowMs / 1000));

      const results = await pipeline.exec();
      // results[2] es el resultado de zCard (cardinalidad del sorted set)
      const count = (results?.[2] as unknown as number) || 0;

      const remaining = Math.max(0, maxRequests - count);
      const resetAt = now + windowMs;

      return {
        allowed: count <= maxRequests,
        remaining,
        resetAt,
        total: count,
      };
    } catch (error) {
      console.error("Redis error in sliding window rate limiting, falling back to memory:", error);
      // Fallback a memoria
    }
  }

  // Fallback en memoria (simplificado - usa fixed window)
  return checkFixedWindow(null, key, maxRequests, windowMs);
}

/**
 * Limpia el store en memoria (útil para tests)
 */
export function clearInMemoryStore(): void {
  inMemoryStore.clear();
}

/**
 * Verifica el rate limit para un request
 */
export async function checkRateLimit(
  req: MedusaRequest,
  config: RateLimitConfig,
  endpoint: string = 'default'
): Promise<RateLimitResult> {
  if (!RATE_LIMIT_ENABLED) {
    return { allowed: true };
  }

  const redis = await getRedisClient();
  const identifier = getIdentifier(req, config.identifier, config.keyGenerator);
  const key = `${config.identifier}:${identifier}:${endpoint}`;

  let result: RateLimitResult;

  if (config.strategy === 'sliding') {
    result = await checkSlidingWindow(redis, key, config.maxRequests, config.windowMs);
  } else {
    result = await checkFixedWindow(redis, key, config.maxRequests, config.windowMs);
  }

  return result;
}

