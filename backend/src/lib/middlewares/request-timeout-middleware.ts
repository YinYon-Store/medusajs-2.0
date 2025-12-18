import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http";

/**
 * Middleware para timeout de requests
 */
export function requestTimeoutMiddleware(options: { timeout: number }) {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): Promise<void> => {
    let timeoutId: NodeJS.Timeout | null = null;
    let isTimedOut = false;

    // Crear un AbortController para cancelar operaciones asíncronas
    const abortController = new AbortController();
    req.signal = abortController.signal as any;

    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutId = setTimeout(() => {
        isTimedOut = true;
        abortController.abort();
        resolve();
      }, options.timeout);
    });

    // Wrapper para el next() que limpia el timeout
    const originalNext = next;
    const wrappedNext = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (!isTimedOut) {
        originalNext();
      }
    };

    // Ejecutar el timeout check en paralelo
    timeoutPromise.then(() => {
      if (isTimedOut && !res.headersSent) {
        res.status(504).json({
          message: `Request timeout. Maximum time is ${options.timeout}ms (${options.timeout / 1000}s)`,
          timeout: options.timeout,
        });
      }
    });

    // Continuar con el request
    // El timeout se cancelará si el request termina antes
    try {
      await Promise.race([
        new Promise<void>((resolve) => {
          // Simular la ejecución del siguiente middleware
          // En realidad, esto se maneja por el framework
          resolve();
        }),
        timeoutPromise,
      ]);
    } catch (error) {
      // Ignorar errores de abort
    }

    // Si no ha expirado, continuar
    if (!isTimedOut) {
      wrappedNext();
    }
  };
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

