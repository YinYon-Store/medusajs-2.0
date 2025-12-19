import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http";
import { checkRateLimit, RateLimitConfig } from "../rate-limit-service";

/**
 * Middleware de rate limiting
 */
export function rateLimitMiddleware(config: RateLimitConfig) {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): Promise<void> => {
    try {
      // Extraer endpoint de la URL
      const endpoint = req.url?.split('?')[0] || 'unknown';
      
      const result = await checkRateLimit(req, config, endpoint);

      if (!result.allowed) {
        res.status(429).json({
          message: "Too many requests. Please try again later.",
          retryAfter: result.resetAt ? Math.ceil((result.resetAt - Date.now()) / 1000) : undefined,
        });
        return;
      }

      // Agregar headers de rate limit
      if (result.remaining !== undefined) {
        res.setHeader("X-RateLimit-Limit", config.maxRequests.toString());
        res.setHeader("X-RateLimit-Remaining", result.remaining.toString());
      }
      
      if (result.resetAt) {
        res.setHeader("X-RateLimit-Reset", new Date(result.resetAt).toISOString());
      }

      next();
    } catch (error) {
      console.error("Rate limit middleware error:", error);
      // En caso de error, permitir el request (fail open)
      next();
    }
  };
}



