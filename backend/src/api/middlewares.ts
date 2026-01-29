import type {
  MiddlewaresConfig,
} from "@medusajs/framework/http";
import {
  rateLimitMiddleware,
  payloadSizeMiddleware,
  requestTimeoutMiddleware,
} from "../lib/middlewares";
import { productTransformMiddleware } from "../lib/middlewares/product-transform-middleware";
import {
  RATE_LIMIT_WEBHOOK_WINDOW_MS,
  RATE_LIMIT_WEBHOOK_MAX_REQUESTS,
  RATE_LIMIT_ADMIN_WINDOW_MS,
  RATE_LIMIT_ADMIN_MAX_REQUESTS,
  RATE_LIMIT_STORE_WINDOW_MS,
  RATE_LIMIT_STORE_MAX_REQUESTS,
  RATE_LIMIT_SEARCH_WINDOW_MS,
  RATE_LIMIT_SEARCH_MAX_REQUESTS,
  PAYLOAD_MAX_SIZE_WEBHOOK,
  PAYLOAD_MAX_SIZE_ADMIN,
  PAYLOAD_MAX_SIZE_STORE,
  PAYLOAD_MAX_SIZE_SEARCH,
  REQUEST_TIMEOUT_WEBHOOK,
  REQUEST_TIMEOUT_ADMIN,
  REQUEST_TIMEOUT_STORE,
  REQUEST_TIMEOUT_SEARCH,
} from "../lib/constants";

const config: MiddlewaresConfig = {
  routes: [
    // Webhooks (pago + WhatsApp/Twilio) - Rate limiting estricto POR IP
    {
      matcher: /^\/hooks\/(wompi|addi|bold)\/payment|^\/hooks\/whatsapp/,
      middlewares: [
        rateLimitMiddleware({
          windowMs: RATE_LIMIT_WEBHOOK_WINDOW_MS,
          maxRequests: RATE_LIMIT_WEBHOOK_MAX_REQUESTS,
          strategy: 'sliding',
          identifier: 'ip', // Limitar por IP del proveedor
        }),
        payloadSizeMiddleware({ maxSize: PAYLOAD_MAX_SIZE_WEBHOOK }),
        requestTimeoutMiddleware({ timeout: REQUEST_TIMEOUT_WEBHOOK }),
      ],
    },
    
    // Endpoints de admin - Rate limiting moderado POR USUARIO
    {
      matcher: /^\/admin\//,
      middlewares: [
        rateLimitMiddleware({
          windowMs: RATE_LIMIT_ADMIN_WINDOW_MS,
          maxRequests: RATE_LIMIT_ADMIN_MAX_REQUESTS,
          strategy: 'fixed',
          identifier: 'user', // Limitar por User ID del JWT
        }),
        payloadSizeMiddleware({ maxSize: PAYLOAD_MAX_SIZE_ADMIN }),
        requestTimeoutMiddleware({ timeout: REQUEST_TIMEOUT_ADMIN }),
      ],
    },
    
    // Endpoint de búsqueda - Rate limiting específico POR IP
    {
      matcher: /^\/store\/search/,
      middlewares: [
        rateLimitMiddleware({
          windowMs: RATE_LIMIT_SEARCH_WINDOW_MS,
          maxRequests: RATE_LIMIT_SEARCH_MAX_REQUESTS,
          strategy: 'sliding',
          identifier: 'ip', // Limitar por IP del cliente
        }),
        payloadSizeMiddleware({ maxSize: PAYLOAD_MAX_SIZE_SEARCH }),
        requestTimeoutMiddleware({ timeout: REQUEST_TIMEOUT_SEARCH }),
      ],
    },
    
    // Endpoints de store - Rate limiting estándar POR IP
    {
      matcher: /^\/store\//,
      middlewares: [
        rateLimitMiddleware({
          windowMs: RATE_LIMIT_STORE_WINDOW_MS,
          maxRequests: RATE_LIMIT_STORE_MAX_REQUESTS,
          strategy: 'sliding',
          identifier: 'ip', // Limitar por IP del cliente
        }),
        payloadSizeMiddleware({ maxSize: PAYLOAD_MAX_SIZE_STORE }),
        requestTimeoutMiddleware({ timeout: REQUEST_TIMEOUT_STORE }),
        productTransformMiddleware(), // Transformar productos para exponer campos personalizados
      ],
    },
  ],
};

// Export both named and default for compatibility
export { config };
export default config;

