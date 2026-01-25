import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
import {
  IProductModuleService,
  IPricingModuleService,
} from "@medusajs/framework/types";
import { DATABASE_URL } from "../../lib/constants";
import { productCacheService } from "../../lib/cache/product-cache-service";

/**
 * Obtiene todas las categorías de productos
 */
async function getAllCategories(productModuleService: IProductModuleService): Promise<any[]> {
  try {
    // En Medusa 2.0, las categorías se obtienen del módulo de productos
    // Necesitamos usar el servicio de categorías o hacer una consulta directa
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: DATABASE_URL });
    
    const result = await pool.query(`
      SELECT id, name, handle, parent_category_id
      FROM product_category
      WHERE deleted_at IS NULL
      ORDER BY name
    `);
    
    await pool.end();
    return result.rows;
  } catch (error) {
    console.error("Error obteniendo categorías:", error);
    return [];
  }
}

/**
 * Genera combinaciones de categorías para cachear
 * Retorna un array de objetos con category_main y category_ids
 */
function generateCategoryCombinations(categories: any[]): Array<{ category_main: string; category_ids: string[] }> {
  const combinations: Array<{ category_main: string; category_ids: string[] }> = [];
  
  // 1. Solo category_main (sin category_ids)
  for (const category of categories) {
    combinations.push({
      category_main: category.id,
      category_ids: []
    });
  }
  
  // 2. category_main + category_ids (combinaciones de 1 a 3 categorías adicionales)
  // Limitar a 3 para no generar demasiadas combinaciones
  for (const mainCategory of categories) {
    const otherCategories = categories.filter(c => c.id !== mainCategory.id);
    
    // Combinaciones de 1 categoría adicional
    for (const additionalCategory of otherCategories) {
      combinations.push({
        category_main: mainCategory.id,
        category_ids: [additionalCategory.id]
      });
    }
    
    // Combinaciones de 2 categorías adicionales (solo primeras 5 para no generar demasiadas)
    for (let i = 0; i < Math.min(5, otherCategories.length); i++) {
      for (let j = i + 1; j < Math.min(i + 3, otherCategories.length); j++) {
        combinations.push({
          category_main: mainCategory.id,
          category_ids: [otherCategories[i].id, otherCategories[j].id]
        });
      }
    }
  }
  
  return combinations;
}

/**
 * Script para pre-cachear (warm-up) todas las páginas de productos
 * 
 * Este script simula las requests al endpoint /store/products procesando
 * directamente los datos y cacheándolos, sin necesidad de hacer HTTP requests.
 * 
 * Uso:
 *   medusa exec ./src/scripts/warm-product-cache.ts
 * 
 * Variables de entorno opcionales:
 *   PRODUCT_CACHE_WARM_PAGE_SIZE=25 (tamaño de página, default: 25)
 *   PRODUCT_CACHE_WARM_REGION_ID=reg_xxx (region_id para los requests)
 *   PRODUCT_CACHE_WARM_ORDER=order_price (ordenamiento, default: order_price)
 */
export default async function warmProductCache({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const productModuleService: IProductModuleService = container.resolve(Modules.PRODUCT);
  const pricingModuleService: IPricingModuleService = container.resolve(Modules.PRICING);

  logger.info("🔥 Iniciando warm-up de caché de productos...");

  try {
    // Configuración
    const PAGE_SIZE = parseInt(process.env.PRODUCT_CACHE_WARM_PAGE_SIZE || '25', 10);
    const REGION_ID = process.env.PRODUCT_CACHE_WARM_REGION_ID;
    const ORDER = process.env.PRODUCT_CACHE_WARM_ORDER || 'order_price';

    logger.info(`📋 Configuración:`);
    logger.info(`   - Tamaño de página: ${PAGE_SIZE}`);
    logger.info(`   - Ordenamiento: ${ORDER}`);
    logger.info(`   - Region ID: ${REGION_ID || 'no especificado'}`);

    // 1. Obtener el total de productos
    logger.info("\n📦 Obteniendo total de productos...");
    const [_, totalCount] = await productModuleService.listAndCountProducts(
      { status: 'published' },
      {}
    );

    if (totalCount === 0) {
      logger.warn("⚠️  No se encontraron productos publicados");
      return;
    }

    logger.info(`✅ Total de productos: ${totalCount}`);
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    logger.info(`📄 Total de páginas a cachear: ${totalPages}`);

    // 2. Obtener todas las categorías para generar combinaciones
    logger.info("\n📂 Obteniendo categorías para generar combinaciones...");
    const allCategories = await getAllCategories(productModuleService);
    logger.info(`✅ Total de categorías encontradas: ${allCategories.length}`);
    
    // Generar combinaciones de categorías
    const categoryCombinations = generateCategoryCombinations(allCategories);
    logger.info(`📊 Total de combinaciones de categorías a cachear: ${categoryCombinations.length}`);

    // 3. Construir query params base para generar keys de caché
    const baseQueryParams: Record<string, any> = {
      limit: PAGE_SIZE,
      order: ORDER,
    };
    if (REGION_ID) {
      baseQueryParams.region_id = REGION_ID;
    }
    baseQueryParams.fields = '*variants.calculated_price,*variants.prices,*options,*options.values,*categories';

    // 4. Procesar y cachear cada página (sin filtros de categoría)
    logger.info("\n🚀 Iniciando warm-up de caché (páginas generales)...");
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const startTime = Date.now();

    const isOrderByPrice = ORDER === 'order_price' || ORDER === '-order_price';

    // Cachear páginas generales (sin filtros de categoría)
    for (let page = 0; page < totalPages; page++) {
      const offset = page * PAGE_SIZE;
      const queryParams = { ...baseQueryParams, offset };

      try {
        // Generar key de caché
        const cacheKey = productCacheService.generateKey(queryParams);

        // Verificar si ya está cacheado (solo verificar, no construir desde individuales)
        const checkStartTime = Date.now();
        const existing = await productCacheService.get(cacheKey, undefined); // No pasar queryParams para evitar construcción desde individuales
        const checkTime = Date.now() - checkStartTime;
        
        if (existing) {
          skippedCount++;
          const progress = Math.round(((page + 1) / totalPages) * 100);
          logger.info(`  ⏭️  Página ${page + 1}/${totalPages} (offset: ${offset}) - Ya está cacheada, omitiendo... [${progress}%] (check: ${checkTime}ms)`);
          successCount++;
          continue;
        }

        // Procesar la página (similar a lo que hace el endpoint)
        let products: any[];
        let count: number;
        let paginatedProducts: any[];

        if (isOrderByPrice) {
          // Usar SQL directo para ordenar por order_price
          const { Pool } = require("pg");
          const pool = new Pool({ connectionString: DATABASE_URL });

          const isDesc = ORDER.startsWith('-');
          const orderDirection = isDesc ? 'DESC' : 'ASC';
          const nullOrder = isDesc ? 'NULLS LAST' : 'NULLS FIRST';

          const orderByQuery = `
            SELECT p.id, p.order_price
            FROM product p
            WHERE p.deleted_at IS NULL AND p.status = 'published'
            ORDER BY p.order_price ${orderDirection} ${nullOrder}
            LIMIT $1 OFFSET $2
          `;

          const productsResult = await pool.query(orderByQuery, [PAGE_SIZE, offset]);
          const productIds = productsResult.rows.map((row: any) => row.id);

          if (productIds.length > 0) {
            products = await productModuleService.listProducts(
              { id: productIds },
              {
                relations: ["variants", "variants.options", "images", "categories", "collection", "tags", "options", "options.values"],
              }
            );

            const productMap = new Map(products.map((p: any) => [p.id, p]));
            products = productIds.map((id: string) => productMap.get(id)).filter(Boolean);

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

          await pool.end();
          count = totalCount; // Ya lo tenemos
        } else {
          // Usar servicio normal
          const filterParams: any = { status: 'published' };
          const options: any = {
            relations: ["variants", "variants.options", "images", "categories", "collection", "tags", "options", "options.values"],
            take: PAGE_SIZE,
            skip: offset,
          };

          [products, count] = await productModuleService.listAndCountProducts(filterParams, options);
          paginatedProducts = products;
        }

        // Obtener precios para todas las variantes
        const variantIds = paginatedProducts.flatMap((p: any) => 
          p.variants?.map((v: any) => v.id) || []
        );

        if (variantIds.length > 0) {
          const { Pool } = require("pg");
          const pool = new Pool({ connectionString: DATABASE_URL });
          
          const placeholders = variantIds.map((_: any, i: number) => `$${i + 1}`).join(', ');
          const variantPriceSetResult = await pool.query(
            `SELECT variant_id, price_set_id FROM product_variant_price_set WHERE variant_id IN (${placeholders}) AND deleted_at IS NULL`,
            variantIds
          );
          await pool.end();

          const variantPriceSetMap = new Map<string, string>();
          variantPriceSetResult.rows.forEach((row: any) => {
            variantPriceSetMap.set(row.variant_id, row.price_set_id);
          });

          const priceSetIds = Array.from(new Set(variantPriceSetMap.values()));

          if (priceSetIds.length > 0) {
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

            let calculatedPricesMap = new Map<string, any>();
            if (REGION_ID) {
              priceSetIds.forEach((priceSetId: string) => {
                const priceSetPrices = priceMap.get(priceSetId) || [];
                if (priceSetPrices.length > 0) {
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

            paginatedProducts.forEach((product: any) => {
              if (product.variants) {
                product.variants = product.variants.map((variant: any) => {
                  const priceSetId = variantPriceSetMap.get(variant.id);
                  const variantPrices = priceSetId ? (priceMap.get(priceSetId) || []) : [];
                  const calculatedPrice = priceSetId && REGION_ID ? (calculatedPricesMap.get(priceSetId) || null) : null;

                  return {
                    ...variant,
                    prices: variantPrices,
                    calculated_price: calculatedPrice,
                  };
                });
              }
            });
          }
        }

        // Construir respuesta
        const response = {
          products: paginatedProducts,
          count: count,
          offset: offset,
          limit: PAGE_SIZE,
        };

        // Cachear la respuesta (síncrono en el script para asegurar que se complete)
        const productIds = paginatedProducts.map((p: any) => p.id).filter(Boolean);
        const cacheStartTime = Date.now();
        await productCacheService.set(cacheKey, response, productIds);
        const cacheTime = Date.now() - cacheStartTime;

        successCount++;
        const progress = Math.round(((page + 1) / totalPages) * 100);
        logger.info(
          `  ✅ Página ${page + 1}/${totalPages} (offset: ${offset}) - ${paginatedProducts.length} productos cacheados [${progress}%] (cache: ${cacheTime}ms)`
        );

        // Pequeña pausa para no sobrecargar Redis
        if (page < totalPages - 1) {
          await new Promise(resolve => setTimeout(resolve, 10)); // Reducido de 50ms a 10ms
        }
      } catch (error: any) {
        errorCount++;
        logger.error(
          `  ❌ Error cacheando página ${page + 1} (offset: ${offset}): ${error.message}`
        );
      }
    }

    const generalPagesTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const generalProcessedPages = successCount - skippedCount;
    const generalSkippedCount = skippedCount;
    const generalErrorCount = errorCount;
    const generalSuccessCount = successCount;

    logger.info(`\n✅ Páginas generales completadas: ${generalSuccessCount}/${totalPages} (${generalPagesTime}s)`);

    // 5. Procesar y cachear combinaciones de categorías
    logger.info("\n🚀 Iniciando warm-up de caché (combinaciones de categorías)...");
    let categorySuccessCount = 0;
    let categoryErrorCount = 0;
    let categorySkippedCount = 0;
    const categoryStartTime = Date.now();

    for (let i = 0; i < categoryCombinations.length; i++) {
      const combination = categoryCombinations[i];
      const queryParams = {
        ...baseQueryParams,
        category_main: combination.category_main,
        category_ids: combination.category_ids,
        offset: 0, // Solo cachear primera página de cada combinación
      };

      try {
        const cacheKey = productCacheService.generateKey(queryParams);
        const checkStartTime = Date.now();
        const existing = await productCacheService.get(cacheKey, undefined);
        const checkTime = Date.now() - checkStartTime;

        if (existing) {
          categorySkippedCount++;
          const progress = Math.round(((i + 1) / categoryCombinations.length) * 100);
          logger.info(
            `  ⏭️  Combinación ${i + 1}/${categoryCombinations.length} (${combination.category_main} + ${combination.category_ids.length} adicionales) - Ya está cacheada [${progress}%] (check: ${checkTime}ms)`
          );
          categorySuccessCount++;
          continue;
        }

        // Procesar la combinación (similar a lo que hace el endpoint)
        const filterParams: any = {
          status: 'published',
          categories: {
            id: [combination.category_main]
          }
        };

        const options: any = {
          relations: ["variants", "variants.options", "images", "categories", "collection", "tags", "options", "options.values"],
          take: PAGE_SIZE,
          skip: 0,
        };

        let products: any[];
        let count: number;

        [products, count] = await productModuleService.listAndCountProducts(filterParams, options);

        // Filtrar por categorías adicionales si existen
        if (combination.category_ids.length > 0) {
          products = products.filter((product: any) => {
            if (!product.categories || product.categories.length === 0) {
              return false;
            }
            const hasAdditionalCategory = product.categories.some((category: any) =>
              combination.category_ids.includes(category.id)
            );
            return hasAdditionalCategory;
          });
          count = products.length;
        }

        // Obtener precios (código similar al de páginas generales)
        const variantIds = products.flatMap((p: any) =>
          p.variants?.map((v: any) => v.id) || []
        );

        if (variantIds.length > 0) {
          const { Pool } = require("pg");
          const pool = new Pool({ connectionString: DATABASE_URL });

          const placeholders = variantIds.map((_: any, i: number) => `$${i + 1}`).join(', ');
          const variantPriceSetResult = await pool.query(
            `SELECT variant_id, price_set_id FROM product_variant_price_set WHERE variant_id IN (${placeholders}) AND deleted_at IS NULL`,
            variantIds
          );
          await pool.end();

          const variantPriceSetMap = new Map<string, string>();
          variantPriceSetResult.rows.forEach((row: any) => {
            variantPriceSetMap.set(row.variant_id, row.price_set_id);
          });

          const priceSetIds = Array.from(new Set(variantPriceSetMap.values()));

          if (priceSetIds.length > 0) {
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

            let calculatedPricesMap = new Map<string, any>();
            if (REGION_ID) {
              priceSetIds.forEach((priceSetId: string) => {
                const priceSetPrices = priceMap.get(priceSetId) || [];
                if (priceSetPrices.length > 0) {
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

            products.forEach((product: any) => {
              if (product.variants) {
                product.variants = product.variants.map((variant: any) => {
                  const priceSetId = variantPriceSetMap.get(variant.id);
                  const variantPrices = priceSetId ? (priceMap.get(priceSetId) || []) : [];
                  const calculatedPrice = priceSetId && REGION_ID ? (calculatedPricesMap.get(priceSetId) || null) : null;

                  return {
                    ...variant,
                    prices: variantPrices,
                    calculated_price: calculatedPrice,
                  };
                });
              }
            });
          }
        }

        // Construir respuesta
        const response = {
          products: products,
          count: count,
          offset: 0,
          limit: PAGE_SIZE,
        };

        // Cachear la respuesta
        const productIds = products.map((p: any) => p.id).filter(Boolean);
        const cacheStartTime = Date.now();
        await productCacheService.set(cacheKey, response, productIds);
        const cacheTime = Date.now() - cacheStartTime;

        categorySuccessCount++;
        const progress = Math.round(((i + 1) / categoryCombinations.length) * 100);
        logger.info(
          `  ✅ Combinación ${i + 1}/${categoryCombinations.length} (${combination.category_main} + ${combination.category_ids.length} adicionales) - ${products.length} productos cacheados [${progress}%] (cache: ${cacheTime}ms)`
        );

        // Pequeña pausa para no sobrecargar Redis
        if (i < categoryCombinations.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      } catch (error: any) {
        categoryErrorCount++;
        logger.error(
          `  ❌ Error cacheando combinación ${i + 1} (${combination.category_main}): ${error.message}`
        );
      }
    }

    const categoryTime = ((Date.now() - categoryStartTime) / 1000).toFixed(2);
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

    const totalProcessedPages = generalProcessedPages + (categorySuccessCount - categorySkippedCount);
    const totalSkippedCount = generalSkippedCount + categorySkippedCount;
    const totalErrorCount = generalErrorCount + categoryErrorCount;
    const totalSuccessCount = generalSuccessCount + categorySuccessCount;

    logger.info("\n" + "=".repeat(60));
    logger.info("📊 RESUMEN FINAL");
    logger.info("=".repeat(60));
    logger.info("📄 PÁGINAS GENERALES:");
    logger.info(`   ✅ Procesadas: ${generalSuccessCount}/${totalPages}`);
    logger.info(`   - Nuevas: ${generalProcessedPages}`);
    logger.info(`   - Omitidas: ${generalSkippedCount}`);
    logger.info(`   ⏱️  Tiempo: ${generalPagesTime}s`);
    logger.info("");
    logger.info("📂 COMBINACIONES DE CATEGORÍAS:");
    logger.info(`   ✅ Procesadas: ${categorySuccessCount}/${categoryCombinations.length}`);
    logger.info(`   - Nuevas: ${categorySuccessCount - categorySkippedCount}`);
    logger.info(`   - Omitidas: ${categorySkippedCount}`);
    logger.info(`   ⏱️  Tiempo: ${categoryTime}s`);
    logger.info("");
    logger.info("📊 TOTAL:");
    logger.info(`   ✅ Total procesado: ${totalSuccessCount}`);
    logger.info(`   - Nuevas: ${totalProcessedPages}`);
    logger.info(`   - Omitidas: ${totalSkippedCount}`);
    logger.info(`   ❌ Errores: ${totalErrorCount}`);
    logger.info(`   ⏱️  Tiempo total: ${totalTime}s`);
    logger.info(`   📦 Total de productos: ${totalCount}`);
    logger.info(`   📄 Tamaño de página: ${PAGE_SIZE}`);
    logger.info(`   📂 Combinaciones de categorías: ${categoryCombinations.length}`);
    logger.info("=".repeat(60));
    logger.info("✨ Warm-up completado!");

    if (totalErrorCount > 0) {
      logger.warn(`⚠️  Hubo ${totalErrorCount} errores. Revisa los logs arriba.`);
    }

    if (totalSkippedCount === totalSuccessCount) {
      logger.info("ℹ️  Todas las páginas y combinaciones ya estaban cacheadas. No se procesó nada nuevo.");
    }

  } catch (error: any) {
    logger.error("❌ Error fatal en el proceso:", error);
    throw error;
  }
}
