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
    // Interceptar order=order_price ANTES de que llegue al servicio
    // para evitar el error de MikroORM
    const orderParam = req.query.order as string | undefined;
    const isOrderByPrice = orderParam === 'order_price' || orderParam === '-order_price';
    
    if (isOrderByPrice && req.url?.includes('/store/products')) {
      // Guardar el valor original del order para usarlo después
      (req as any)._originalOrder = orderParam;
      
      // Remover el parámetro order del query para evitar el error de MikroORM
      // También modificar la URL para eliminar el parámetro order
      if (req.url) {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        url.searchParams.delete('order');
        req.url = url.pathname + url.search;
      }
      
      // Eliminar del objeto query también
      delete req.query.order;
      // Guardar el método json original
      const originalJson = res.json.bind(res);

      // Sobrescribir el método json para ordenar manualmente
      res.json = async function (body: any) {
        if (body && body.products && Array.isArray(body.products)) {
          try {
            // Obtener order_price desde la BD para cada producto
            const { Pool } = require("pg");
            const pool = new Pool({ connectionString: DATABASE_URL });

            const productIds = body.products.map((p: any) => p.id);
            if (productIds.length > 0) {
              const placeholders = productIds.map((_: any, i: number) => `$${i + 1}`).join(', ');
              const result = await pool.query(
                `SELECT id, order_price FROM product WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
                productIds
              );
              await pool.end();

              // Crear un mapa de order_price por producto
              const priceMap = new Map<string, number>();
              result.rows.forEach((row: any) => {
                priceMap.set(row.id, row.order_price || 0);
              });

              // Agregar order_price a cada producto y ordenar
              body.products = body.products.map((product: any) => ({
                ...product,
                order_price: priceMap.get(product.id) || null,
              }));

              // Ordenar por order_price
              const isDesc = orderParam?.startsWith('-');
              body.products.sort((a: any, b: any) => {
                const priceA = a.order_price || 0;
                const priceB = b.order_price || 0;
                return isDesc ? priceB - priceA : priceA - priceB;
              });
            }
          } catch (error: any) {
            console.error('[ProductTransform] Error ordenando por order_price:', error);
            // Si falla, continuar sin ordenar
          }
        }

        // Transformar productos para exponer campos desde metadata
        if (body && body.products && Array.isArray(body.products)) {
          body.products = body.products.map(transformProduct);
        } else if (body && body.product) {
          body.product = transformProduct(body.product);
        }

        return originalJson(body);
      };

      // Remover el parámetro order del query para evitar el error de MikroORM
      delete req.query.order;
    } else {
      // Si no es order_price, solo transformar productos
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
    }

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
