import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http";
import { DATABASE_URL } from "../constants";

/**
 * Middleware que:
 * 1. Intercepta el parámetro order=order_price y lo maneja manualmente
 * 2. Transforma las respuestas de productos para exponer campos personalizados
 * 
 * Específicamente:
 * - Maneja order=order_price usando SQL directo
 * - Expone metadata.max_variant_price -> max_variant_price
 * - Expone metadata.price_sort_order -> price_sort_order
 * - Expone order_price desde la columna de la BD
 */
export function productTransformMiddleware() {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): Promise<void> => {
    // Intercepter order=order_price ya no es necesario aquí porque se maneja en los endpoints
    
    // Solo transformar productos para exponer campos personalizados
    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      if (req.url?.includes('/store/products') && body) {
        if (body.products && Array.isArray(body.products)) {
          body.products = body.products.map(transformProduct);
        } else if (body.product) {
          body.product = transformProduct(body.product);
        } else if (Array.isArray(body)) {
          body = body.map(transformProduct);
        }
      }
      return originalJson(body);
    };

    next();
  };
}

/**
 * Transforma un producto para exponer campos desde metadata y order_price
 */
function transformProduct(product: any): any {
  if (!product || typeof product !== 'object') {
    return product;
  }

  const metadata = product.metadata || {};

  return {
    ...product,
    // Exponer campos desde metadata como campos de nivel superior
    max_variant_price: metadata.max_variant_price ?? null,
    max_variant_price_currency: metadata.max_variant_price_currency ?? null,
    price_sort_order: metadata.price_sort_order ?? null,
    // order_price ya debería estar incluido si se ordenó por él, pero lo exponemos siempre
    // Si no está, intentar obtenerlo desde metadata como fallback
    order_price: product.order_price ?? metadata.price_sort_order ?? null,
  };
}
