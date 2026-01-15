import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { reportError, ErrorCategory, ErrorContext } from "../firebase-service";

/**
 * Middleware de manejo de errores global
 * 
 * Captura errores no manejados y los reporta a Firebase Crashlytics
 * También agrega información de contexto útil para debugging
 */

export function errorHandlerMiddleware(
  err: Error,
  req: MedusaRequest,
  res: MedusaResponse,
  next: (err?: Error) => void
): void {
  // Extraer información del request
  const context: ErrorContext = {
    endpoint: req.url,
    method: req.method,
    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown",
    userAgent: req.headers["user-agent"],
    body: req.body ? JSON.stringify(req.body).substring(0, 500) : undefined, // Limitar tamaño
    query: req.query ? JSON.stringify(req.query) : undefined,
    params: req.params ? JSON.stringify(req.params) : undefined,
  };

  // Determinar categoría del error basado en el endpoint
  let category = ErrorCategory.UNKNOWN;
  
  if (req.url?.includes("/hooks/")) {
    category = ErrorCategory.WEBHOOK;
  } else if (req.url?.includes("/store/search")) {
    category = ErrorCategory.SEARCH;
  } else if (req.url?.includes("/payment")) {
    category = ErrorCategory.PAYMENT;
  } else if (req.url?.includes("/admin")) {
    category = ErrorCategory.AUTHENTICATION;
  }

  // Reportar error a Crashlytics
  reportError(err, category, context).catch((reportError) => {
    // No fallar si el reporte falla
    console.error("[Middleware] Error reporting to Crashlytics:", reportError);
  });

  // Continuar con el manejo de errores estándar de Medusa
  next(err);
}








