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
// import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

/**
 * Script para calcular y guardar el precio máximo de las variantes de cada producto
 * en el campo metadata.max_variant_price para ordenamiento.
 * 
 * Ejecutar con:
 * npx medusa exec ./src/scripts/update-product-price-sort.ts
 */
export default async function updateProductPriceSort({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const productModuleService: IProductModuleService = container.resolve(Modules.PRODUCT);
  const pricingModuleService: IPricingModuleService = container.resolve(Modules.PRICING);

  logger.info("🚀 Iniciando actualización de precios máximos para ordenamiento...");

  try {
    // Paso 1: Obtener todos los productos con sus variantes
    // Nota: Los precios pueden estar en diferentes estructuras dependiendo de cómo se consulten
    logger.info("📦 Obteniendo productos y variantes...");
    const products = await productModuleService.listProducts(
      {},
      {
        relations: ["variants"],
      }
    );

    const totalProducts = products.length;
    if (totalProducts === 0) {
      logger.warn("⚠️  No se encontraron productos");
      return;
    }

    logger.info(`✅ Se encontraron ${totalProducts} productos`);

    // Paso 2: Procesar productos en lotes para mejor rendimiento
    const batchSize = 50;
    let processedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(products.length / batchSize);

      logger.info(`\n📊 Procesando lote ${batchNumber}/${totalBatches} (${batch.length} productos)...`);

      // Procesar cada producto del lote
      for (const product of batch) {
        try {
          // Obtener IDs de todas las variantes del producto
          const variantIds = product.variants?.map((v) => v.id) || [];

          if (variantIds.length === 0) {
            logger.warn(`  ⚠️  Producto "${product.title}" (${product.id}) no tiene variantes`);
            processedCount++;
            continue;
          }

          // Obtener el precio máximo de todas las variantes
          // Primero intentar obtener precios desde el pricing service usando price_set_id
          let maxPrice = 0;
          let currencyCode = "cop"; // Moneda por defecto

          // Usar consulta SQL directa para obtener el precio máximo del producto
          // Query probado y confirmado que funciona
          try {
            const { Pool } = require("pg");
            const pool = new Pool({ connectionString: DATABASE_URL });

            // Query para obtener el precio máximo del producto desde todas sus variantes
            const query = `
              SELECT 
                p.id AS producto_id,
                p.title AS producto_title,
                MAX(pr.amount) AS precio_maximo,
                pr.currency_code,
                COUNT(DISTINCT pv.id) AS cantidad_variantes
              FROM product p
              INNER JOIN product_variant pv ON pv.product_id = p.id
              INNER JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
              INNER JOIN price pr ON pr.price_set_id = pvps.price_set_id
              WHERE p.id = $1
                AND p.deleted_at IS NULL
                AND pv.deleted_at IS NULL
                AND pvps.deleted_at IS NULL
                AND pr.deleted_at IS NULL
              GROUP BY p.id, p.title, pr.currency_code
              ORDER BY precio_maximo ASC
            `;

            const result = await pool.query(query, [product.id]);
            await pool.end();

            if (result.rows && result.rows.length > 0) {
              // Tomar el primer resultado (el precio máximo)
              const row = result.rows[0];
              maxPrice = parseFloat(row.precio_maximo) || 0;
              currencyCode = row.currency_code || currencyCode;
            }
          } catch (sqlError: any) {
            // Si falla SQL, loguear el error pero continuar
            logger.debug(`  ⚠️  Error SQL para ${product.title}: ${sqlError.message}`);
          }

          // Si no encontramos precios desde el pricing service, buscar en las variantes directamente
          if (maxPrice === 0) {
            for (const variant of product.variants || []) {
              const variantAny = variant as any;
              let variantMaxPrice = 0;
              let variantCurrency = currencyCode;

              // Opción 1: Desde prices directamente en la variante (estructura más común en respuestas)
              if (variantAny.prices && Array.isArray(variantAny.prices) && variantAny.prices.length > 0) {
                for (const price of variantAny.prices) {
                  const amount = price.amount || 
                    (price.raw_amount?.value ? parseFloat(price.raw_amount.value) : 0);
                  
                  if (amount > variantMaxPrice) {
                    variantMaxPrice = amount;
                    variantCurrency = price.currency_code || variantCurrency;
                  }
                }
              }
              // Opción 2: Desde calculated_price (precio calculado cuando se consulta con region_id)
              else if (variantAny.calculated_price?.calculated_amount) {
                variantMaxPrice = variantAny.calculated_price.calculated_amount;
                variantCurrency = variantAny.calculated_price.currency_code || variantCurrency;
              }
              // Opción 3: Desde calculated_price.original_amount
              else if (variantAny.calculated_price?.original_amount) {
                variantMaxPrice = variantAny.calculated_price.original_amount;
                variantCurrency = variantAny.calculated_price.currency_code || variantCurrency;
              }
              // Opción 4: Desde price_set.prices
              else if (variantAny.price_set?.prices?.length > 0) {
                for (const price of variantAny.price_set.prices) {
                  const amount = price.amount || 
                    (price.raw_amount?.value ? parseFloat(price.raw_amount.value) : 0);
                  
                  if (amount > variantMaxPrice) {
                    variantMaxPrice = amount;
                    variantCurrency = price.currency_code || variantCurrency;
                  }
                }
              }

              // Actualizar el precio máximo global si esta variante tiene un precio mayor
              if (variantMaxPrice > maxPrice) {
                maxPrice = variantMaxPrice;
                currencyCode = variantCurrency;
              }
            }
          }


          // Si encontramos un precio máximo, actualizar el producto en la columna order_price
          if (maxPrice > 0) {
            // Actualizar el producto usando SQL directo para actualizar la columna order_price
            try {
              const { Pool } = require("pg");
              const pool = new Pool({ connectionString: DATABASE_URL });

              // Actualizar la columna order_price con el precio máximo (convertido a entero)
              await pool.query(
                `UPDATE product SET order_price = $1 WHERE id = $2`,
                [Math.round(maxPrice), product.id]
              );

              await pool.end();

              updatedCount++;
              logger.info(
                `  ✅ "${product.title}" - Precio máximo: ${maxPrice} ${currencyCode.toUpperCase()} (order_price: ${Math.round(maxPrice)})`
              );
            } catch (updateError: any) {
              // Si falla SQL, intentar con el servicio como fallback
              try {
                await productModuleService.updateProducts([
                  {
                    id: product.id,
                    order_price: Math.round(maxPrice),
                  },
                ]);
                updatedCount++;
                logger.info(
                  `  ✅ "${product.title}" - Precio máximo: ${maxPrice} ${currencyCode.toUpperCase()} (order_price: ${Math.round(maxPrice)})`
                );
              } catch (serviceError: any) {
                logger.warn(`  ⚠️  Error actualizando producto "${product.title}": SQL=${updateError.message}, Service=${serviceError.message}`);
                // Continuar sin actualizar este producto
                processedCount++;
                continue;
              }
            }
          } else {
            // Debug: mostrar información sobre las variantes para diagnosticar
            const firstVariant = product.variants?.[0] as any;
            const hasPrices = firstVariant?.prices?.length > 0;
            const hasCalculatedPrice = firstVariant?.calculated_price != null;
            const hasPriceSet = firstVariant?.price_set_id != null;
            
            logger.warn(
              `  ⚠️  Producto "${product.title}" (${product.id}) no tiene precios en sus variantes. ` +
              `Debug: hasPrices=${hasPrices}, hasCalculatedPrice=${hasCalculatedPrice}, hasPriceSet=${hasPriceSet}, variantIds=${variantIds.length}`
            );
          }

          processedCount++;
        } catch (error: any) {
          errorCount++;
          logger.error(
            `  ❌ Error procesando producto "${product.title}" (${product.id}): ${error.message}`
          );
        }
      }

      const progress = Math.round((processedCount / totalProducts) * 100);
      logger.info(
        `📈 Progreso: ${processedCount}/${totalProducts} productos procesados (${progress}%)`
      );
    }

    // Resumen final
    logger.info("\n" + "=".repeat(60));
    logger.info("📊 RESUMEN FINAL");
    logger.info("=".repeat(60));
    logger.info(`✅ Productos procesados: ${processedCount}`);
    logger.info(`✅ Productos actualizados: ${updatedCount}`);
    logger.info(`❌ Errores: ${errorCount}`);
    logger.info("=".repeat(60));
    logger.info("✨ Proceso completado!");

  } catch (error: any) {
    logger.error("❌ Error fatal en el proceso:", error);
    throw error;
  }
}
