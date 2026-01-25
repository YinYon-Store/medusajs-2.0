import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { IProductModuleService, IPricingModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { DATABASE_URL } from "../../../../lib/constants";
import { productCacheService } from "../../../../lib/cache/product-cache-service";

/**
 * Endpoint personalizado para /store/products/filter-by-categories
 * 
 * Filtra productos por categorías (category_main y category_ids opcionales)
 * Soporta ordenamiento por order_price y caché
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  try {
    const { category_main, category_ids, order, limit, offset, region_id, fields } = req.query;
    
    // Validar parámetros requeridos
    if (!category_main) {
      return res.status(400).json({
        error: "category_main parameter is required"
      });
    }

    const orderParam = order as string | undefined;
    const isOrderByPrice = orderParam === 'order_price' || orderParam === '-order_price';

    // Convertir category_ids a array si viene como string
    const categoryIdsArray = Array.isArray(category_ids) 
      ? category_ids 
      : category_ids 
        ? [category_ids] 
        : [];

    // Parámetros de paginación
    const pageLimit = parseInt((limit as string) || '100', 10);
    const pageOffset = parseInt((offset as string) || '0', 10);
    const regionId = region_id as string | undefined;

    // ========================================================================
    // CACHE: Intentar obtener respuesta desde caché
    // ========================================================================
    const cacheKey = productCacheService.generateKey(req.query as Record<string, any>)
    const cacheStartTime = Date.now()
    const cachedResponse = await productCacheService.get(cacheKey, req.query as Record<string, any>)
    const cacheTime = Date.now() - cacheStartTime
    
    if (cachedResponse) {
      console.log(`[Categories] Cache HIT: ${cacheKey} (${cacheTime}ms)`)
      res.json(cachedResponse)
      return
    }
    
    console.log(`[Categories] Cache MISS: ${cacheKey}`)
    const productModuleService: IProductModuleService = req.scope.resolve(Modules.PRODUCT);
    const pricingModuleService: IPricingModuleService = req.scope.resolve(Modules.PRICING);

    // Crear una sola conexión a la BD que se reutilizará para todas las consultas SQL
    const { Pool } = require("pg");
    let pool: any = null;
    
    let products: any[];
    let count: number;
    let paginatedProducts: any[];

    if (isOrderByPrice) {
      // Usar SQL directo para obtener productos ordenados por order_price con paginación
      pool = new Pool({ connectionString: DATABASE_URL });

      // Construir filtros WHERE para la consulta SQL
      let whereConditions: string[] = ['p.deleted_at IS NULL', `p.status = 'published'`];
      let sqlParams: any[] = [];
      let paramIndex = 1;

      // Filtro por categoría principal (siempre requerido en este endpoint)
      whereConditions.push(`EXISTS (
        SELECT 1 FROM product_category_product pcp
        WHERE pcp.product_id = p.id 
        AND pcp.category_id = $${paramIndex++}
        AND pcp.deleted_at IS NULL
      )`);
      sqlParams.push(category_main);

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
      sqlParams.push(pageLimit, pageOffset);

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

      // Obtener productos completos con relaciones usando el servicio
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

        // Filtrar por categorías adicionales si existen
        if (categoryIdsArray.length > 0) {
          products = products.filter((product: any) => {
            if (!product.categories || product.categories.length === 0) {
              return false;
            }
            const hasAdditionalCategory = product.categories.some((category: any) => 
              categoryIdsArray.includes(category.id)
            );
            return hasAdditionalCategory;
          });

          // Recalcular count después del filtrado
          const allProductsWithMainCategory = await productModuleService.listProducts(
            { categories: { id: [category_main as string] } },
            { relations: ["categories"] }
          );
          const filteredCount = allProductsWithMainCategory.filter((product: any) => {
            if (!product.categories || product.categories.length === 0) return false;
            return product.categories.some((category: any) => 
              categoryIdsArray.includes(category.id)
            );
          }).length;
          count = filteredCount;
        }

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
    } else {
      // Para otros ordenamientos, usar el servicio normal
      const filterParams: any = {
        status: 'published',
        categories: {
          id: [category_main as string]
        }
      };

      const options: any = {
        relations: ["variants", "variants.options", "images", "categories", "collection", "tags", "options", "options.values"],
        take: pageLimit,
        skip: pageOffset,
      };

      if (orderParam && !isOrderByPrice) {
        // Medusa maneja el order automáticamente desde el query
      }

      [products, count] = await productModuleService.listAndCountProducts(filterParams, options);
      
      // Filtrar por categorías adicionales si existen
      if (categoryIdsArray.length > 0) {
        products = products.filter((product: any) => {
          if (!product.categories || product.categories.length === 0) {
            return false;
          }
          const hasAdditionalCategory = product.categories.some((category: any) => 
            categoryIdsArray.includes(category.id)
          );
          return hasAdditionalCategory;
        });

        // Recalcular count después del filtrado
        const allProductsWithMainCategory = await productModuleService.listProducts(
          { categories: { id: [category_main as string] } },
          { relations: ["categories"] }
        );
        const filteredCount = allProductsWithMainCategory.filter((product: any) => {
          if (!product.categories || product.categories.length === 0) return false;
          return product.categories.some((category: any) => 
            categoryIdsArray.includes(category.id)
          );
        }).length;
        count = filteredCount;
      }
      
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

        const priceMap = new Map<string, any[]>();
        prices.forEach((price: any) => {
          if (!priceMap.has(price.price_set_id)) {
            priceMap.set(price.price_set_id, []);
          }
          priceMap.get(price.price_set_id)!.push(price);
        });

        // Si hay region_id, construir calculated_price manualmente desde los precios
        let calculatedPricesMap = new Map<string, any>();
        if (regionId) {
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
                raw_original_amount: { value: String(firstPrice.amount || 0), precision: 20 },
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

    const response = {
      products: paginatedProducts,
      count: count,
      offset: pageOffset,
      limit: pageLimit,
      filters: {
        category_main,
        category_ids: categoryIdsArray
      }
    };

    // ========================================================================
    // CACHE: Almacenar respuesta en caché (solo si es exitosa)
    // Hacerlo de forma asíncrona para no bloquear la respuesta
    // ========================================================================
    setImmediate(async () => {
      try {
        const productIds = paginatedProducts.map((p: any) => p.id).filter(Boolean)
        await productCacheService.set(cacheKey, response, productIds)
      } catch (cacheError) {
        console.error('[Categories] Cache Error:', cacheError)
      }
    })

    res.json(response);
  } catch (error: any) {
    console.error('[Categories] Error:', error.message);
    
    const statusCode = error.statusCode || error.status || 500;
    res.status(statusCode).json({
      message: "Error filtrando productos por categorías",
      error: error.message,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    });
  }
};
