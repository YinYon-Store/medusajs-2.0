import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { IProductModuleService, IPricingModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { DATABASE_URL } from "../../../lib/constants";

/**
 * Endpoint personalizado para /store/products que maneja order=order_price
 * 
 * Si el parámetro order es order_price o -order_price, este endpoint
 * maneja el ordenamiento manualmente usando SQL directo.
 * 
 * Para otros casos, delega al endpoint por defecto de Medusa.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const orderParam = req.query.order as string | undefined;
  const isOrderByPrice = orderParam === 'order_price' || orderParam === '-order_price';

  // Si no es order_price, eliminar el parámetro order y dejar que Medusa maneje el resto
  // Pero como este endpoint existe, debemos manejar todos los casos
  // Para otros ordenamientos, simplemente no pasamos el order y Medusa usará su lógica por defecto

  try {
    const productModuleService: IProductModuleService = req.scope.resolve(Modules.PRODUCT);
    const pricingModuleService: IPricingModuleService = req.scope.resolve(Modules.PRICING);

    // Obtener parámetros de la query
    const limit = parseInt((req.query.limit as string) || '100', 10);
    const offset = parseInt((req.query.offset as string) || '0', 10);
    const regionId = req.query.region_id as string | undefined;
    const fields = req.query.fields as string | undefined;

    // Construir filtros de búsqueda (sin limit, offset, order, region_id, fields)
    // Estos parámetros van en las opciones, no en los filtros
    const filterParams: any = {};
    
    // Copiar solo los parámetros que son filtros válidos
    const validFilterParams = ['id', 'status', 'collection_id', 'type_id', 'tags', 'categories', 'q', 'title', 'handle'];
    Object.keys(req.query).forEach(key => {
      if (validFilterParams.includes(key) && key !== 'order') {
        filterParams[key] = req.query[key];
      }
    });

    // Si es order_price, NO incluir order en los filtros (para evitar el error de MikroORM)
    // Para otros casos, incluir order en las opciones
    // Nota: variants.prices no es una relación válida en Medusa 2.0, los precios se obtienen del módulo de pricing
    // Optimización: no cargar variants.options.option (ya está en variants.options)
    const options: any = {
      relations: ["variants", "variants.options", "images", "categories", "collection", "tags", "options", "options.values"],
      take: limit,
      skip: offset,
    };

    // Solo incluir order en las opciones si NO es order_price
    // Medusa espera el order como string, no como objeto
    if (!isOrderByPrice && orderParam) {
      // No incluir order aquí, Medusa lo maneja automáticamente desde el query
      // Solo necesitamos asegurarnos de que no esté en queryParams
    }
    
    // Crear una sola conexión a la BD que se reutilizará para todas las consultas SQL
    const { Pool } = require("pg");
    let pool: any = null;
    
    // Si es order_price, usar SQL directo para ordenar y paginar eficientemente
    let products: any[];
    let count: number;
    let paginatedProducts: any[];
    
    if (isOrderByPrice) {
      // Usar SQL directo para obtener productos ordenados por order_price con paginación
      // Esto es mucho más eficiente que obtener todos los productos y ordenarlos en memoria
      pool = new Pool({ connectionString: DATABASE_URL });

      // Construir filtros WHERE para la consulta SQL
      let whereConditions: string[] = ['p.deleted_at IS NULL'];
      let sqlParams: any[] = [];
      let paramIndex = 1;

      // Aplicar filtros básicos si existen
      if (filterParams.status) {
        whereConditions.push(`p.status = $${paramIndex++}`);
        sqlParams.push(filterParams.status);
      }
      if (filterParams.collection_id) {
        whereConditions.push(`p.collection_id = $${paramIndex++}`);
        sqlParams.push(filterParams.collection_id);
      }
      if (filterParams.type_id) {
        whereConditions.push(`p.type_id = $${paramIndex++}`);
        sqlParams.push(filterParams.type_id);
      }

      const isDesc = orderParam?.startsWith('-');
      const orderDirection = isDesc ? 'DESC' : 'ASC';
      const nullOrder = isDesc ? 'NULLS LAST' : 'NULLS FIRST';

      // Obtener productos ordenados por order_price con paginación
      const orderByQuery = `
        SELECT p.id, p.order_price
        FROM product p
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY p.order_price ${orderDirection} ${nullOrder}
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;
      sqlParams.push(limit, offset);

      const productsResult = await pool.query(orderByQuery, sqlParams);

      // Obtener el count total (sin paginación)
      const countQuery = `
        SELECT COUNT(*) as total
        FROM product p
        WHERE ${whereConditions.join(' AND ')}
      `;
      const countResult = await pool.query(countQuery, sqlParams.slice(0, -2)); // Sin limit y offset
      count = parseInt(countResult.rows[0].total, 10);

      const productIds = productsResult.rows.map((row: any) => row.id);

      // Obtener productos completos con relaciones usando el servicio (solo los que necesitamos)
      // Optimización: cargar solo las relaciones necesarias para mejorar el rendimiento
      if (productIds.length > 0) {
        products = await productModuleService.listProducts(
          { id: productIds },
          {
            relations: ["variants", "variants.options", "images", "categories", "collection", "tags", "options", "options.values"],
          }
        );

        // Mantener el orden de los IDs de la consulta SQL
        const productMap = new Map(products.map((p: any) => [p.id, p]));
        products = productIds.map((id: string) => productMap.get(id)).filter(Boolean);

        // Agregar order_price a cada producto
        paginatedProducts = products.map((product: any) => {
          const dbProduct = productsResult.rows.find((row: any) => row.id === product.id);
          return {
            ...product,
            order_price: dbProduct?.order_price ?? null,
          };
        });
      } else {
        paginatedProducts = [];
      }
      // No cerrar pool aquí, se reutilizará para obtener precios
    } else {
      // Para otros casos, usar paginación normal del servicio
      [products, count] = await productModuleService.listAndCountProducts(filterParams, options);
      paginatedProducts = products;
    }

    // Obtener precios para todas las variantes (optimizado - una sola consulta)
    const variantIds = paginatedProducts.flatMap((p: any) => 
      p.variants?.map((v: any) => v.id) || []
    );

    if (variantIds.length > 0) {
      // Reutilizar la conexión de pool si existe, o crear una nueva
      if (!pool) {
        pool = new Pool({ connectionString: DATABASE_URL });
      }
      
      const placeholders = variantIds.map((_: any, i: number) => `$${i + 1}`).join(', ');
      const variantPriceSetResult = await pool.query(
        `SELECT variant_id, price_set_id FROM product_variant_price_set WHERE variant_id IN (${placeholders}) AND deleted_at IS NULL`,
        variantIds
      );

      // Crear mapa de variant_id -> price_set_id
      const variantPriceSetMap = new Map<string, string>();
      variantPriceSetResult.rows.forEach((row: any) => {
        variantPriceSetMap.set(row.variant_id, row.price_set_id);
      });

      // Obtener todos los price_set_ids únicos
      const priceSetIds = Array.from(new Set(variantPriceSetMap.values()));

      if (priceSetIds.length > 0) {
        // Obtener todos los precios de una vez
        const prices = await pricingModuleService.listPrices({
          price_set_id: priceSetIds,
        });

        // Crear mapa de price_set_id -> precios
        const priceMap = new Map<string, any[]>();
        prices.forEach((price: any) => {
          if (!priceMap.has(price.price_set_id)) {
            priceMap.set(price.price_set_id, []);
          }
          priceMap.get(price.price_set_id)!.push(price);
        });

        // Si hay region_id, construir calculated_price manualmente desde los precios
        // En Medusa 2.0, calculated_price se construye desde los precios y el region_id
        let calculatedPricesMap = new Map<string, any>();
        if (regionId) {
          // Construir calculated_price para cada price_set_id
          priceSetIds.forEach((priceSetId: string) => {
            const priceSetPrices = priceMap.get(priceSetId) || [];
            if (priceSetPrices.length > 0) {
              // Tomar el primer precio como calculated_price
              const firstPrice = priceSetPrices[0];
              calculatedPricesMap.set(priceSetId, {
                id: priceSetId,
                is_calculated_price_price_list: false,
                is_calculated_price_tax_inclusive: true,
                calculated_amount: firstPrice.amount || 0,
                raw_calculated_amount: firstPrice.raw_amount || { value: String(firstPrice.amount || 0), precision: 20 },
                is_original_price_price_list: false,
                is_original_price_tax_inclusive: true,
                original_amount: firstPrice.amount || 0,
                raw_original_amount: firstPrice.raw_amount || { value: String(firstPrice.amount || 0), precision: 20 },
                currency_code: firstPrice.currency_code || 'cop',
                calculated_price: {
                  id: firstPrice.id,
                  price_list_id: firstPrice.price_list_id || null,
                  price_list_type: null,
                  min_quantity: firstPrice.min_quantity || null,
                  max_quantity: firstPrice.max_quantity || null,
                },
                original_price: {
                  id: firstPrice.id,
                  price_list_id: firstPrice.price_list_id || null,
                  price_list_type: null,
                  min_quantity: firstPrice.min_quantity || null,
                  max_quantity: firstPrice.max_quantity || null,
                },
              });
            }
          });
        }

        // Asignar precios y calculated_price a cada variante
        paginatedProducts.forEach((product: any) => {
          if (product.variants) {
            product.variants = product.variants.map((variant: any) => {
              const priceSetId = variantPriceSetMap.get(variant.id);
              const variantPrices = priceSetId ? (priceMap.get(priceSetId) || []) : [];
              const calculatedPrice = priceSetId && regionId ? (calculatedPricesMap.get(priceSetId) || null) : null;

              return {
                ...variant,
                prices: variantPrices,
                calculated_price: calculatedPrice,
              };
            });
          }
        });
      } else {
        // Si no hay price_set_ids, asignar arrays vacíos
        paginatedProducts.forEach((product: any) => {
          if (product.variants) {
            product.variants = product.variants.map((variant: any) => ({
              ...variant,
              prices: [],
              calculated_price: null,
            }));
          }
        });
      }
    }

    // Cerrar la conexión a la BD si existe
    if (pool) {
      await pool.end();
    }

    res.json({
      products: paginatedProducts,
      count: count,
      offset: offset,
      limit: limit,
    });
  } catch (error: any) {
    console.error('[ProductsRoute] Error:', error);
    res.status(500).json({
      message: "Error obteniendo productos",
      error: error.message,
    });
  }
};
