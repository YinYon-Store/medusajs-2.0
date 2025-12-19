import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http";

/**
 * Middleware para validar tamaño máximo del payload
 */
export function payloadSizeMiddleware(options: { maxSize: number }) {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): Promise<void> => {
    try {
      const contentLength = req.headers["content-length"];
      
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        
        if (size > options.maxSize) {
          res.status(413).json({
            message: `Payload too large. Maximum size is ${options.maxSize} bytes (${Math.round(options.maxSize / 1024)}KB)`,
            maxSize: options.maxSize,
            receivedSize: size,
          });
          return;
        }
      }

      // También validar el body después de parse (si está disponible)
      if (req.body && typeof req.body === 'string') {
        const bodySize = Buffer.byteLength(req.body, 'utf8');
        if (bodySize > options.maxSize) {
          res.status(413).json({
            message: `Payload too large. Maximum size is ${options.maxSize} bytes (${Math.round(options.maxSize / 1024)}KB)`,
            maxSize: options.maxSize,
            receivedSize: bodySize,
          });
          return;
        }
      }

      next();
    } catch (error) {
      console.error("Payload size middleware error:", error);
      // En caso de error, permitir el request (fail open)
      next();
    }
  };
}



