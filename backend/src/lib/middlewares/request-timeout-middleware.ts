import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http";

/**
 * Middleware para timeout de requests
 * Nota: Usa la versión simplificada que no requiere modificar req.signal
 */
export function requestTimeoutMiddleware(options: { timeout: number }) {
  // Usar la versión simplificada que es compatible con MedusaRequest
  return requestTimeoutMiddlewareSimple(options);
}

/**
 * Versión simplificada que solo establece un timeout en la respuesta
 * Nota: Medusa puede manejar timeouts a nivel de servidor, pero este middleware
 * proporciona una capa adicional de protección
 */
export function requestTimeoutMiddlewareSimple(options: { timeout: number }) {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): Promise<void> => {
    const timeoutId = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          message: `Request timeout. Maximum time is ${options.timeout}ms (${options.timeout / 1000}s)`,
          timeout: options.timeout,
        });
      }
    }, options.timeout);

    // Limpiar timeout cuando la respuesta se envía
    const originalEnd = res.end;
    res.end = function(chunk?: any, encoding?: any, cb?: any) {
      clearTimeout(timeoutId);
      return originalEnd.call(this, chunk, encoding, cb);
    };

    next();
  };
}

