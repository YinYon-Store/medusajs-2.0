import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
// Importaciones simplificadas - solo lo necesario para crear productos
import { createProductsWorkflow } from "@medusajs/medusa/core-flows";
import * as fs from 'fs';
import * as path from 'path';

// Interface para el JSON de productos
interface ProductImportData {
  "Product Id": string;
  "Product Handle": string;
  "Product Title": string;
  "Product Subtitle": string;
  "Product Description": string;
  "Product Status": string;
  "Product Thumbnail": string;
  "Product Weight": string;
  "Product Length": string;
  "Product Width": string;
  "Product Height": string;
  "Product Origin Country": string;
  "Product Material": string;
  "Product Collection Id": string;
  "Product Type Id": string;
  "Product Discountable": string;
  "Product External Id": string;
  "Product Created At": string;
  "Product Deleted At": string;
  "Product Hs Code": string;
  "Product Image 1": string;
  "Product Is Giftcard": string;
  "Product Mid Code": string;
  "Product Sales Channel 1": string;
  "Product Tag 1": string;
  "Product Tag 2": string;
  "Product Tag 3": string;
  "Product Tag 4": string;
  "Product Tag 5": string;
  "Product Tag 6": string;
  "Product Tag 7": string;
  "Product Tag 8": string;
  "Product Tag 9": string;
  "Product Tag 10": string;
  "Product Tag 11": string;
  "Product Tag 12": string;
  "Product Updated At": string;
  "Variant Id": string;
  "Variant Title": string;
  "Variant Sku": string;
  "Variant Upc": string;
  "Variant Ean": string;
  "Variant Hs Code": string;
  "Variant Mid Code": string;
  "Variant Manage Inventory": string;
  "Variant Allow Backorder": string;
  "Variant Barcode": string;
  "Variant Created At": string;
  "Variant Deleted At": string;
  "Variant Height": string;
  "Variant Length": string;
  "Variant Material": string;
  "Variant Metadata": string;
  "Variant Option 1 Name": string;
  "Variant Option 1 Value": string;
  "Variant Origin Country": string;
  "Variant Price Colombia [COP]": number;
  "Variant Price COP": number;
  "Variant Product Id": string;
  "Variant Updated At": string;
  "Variant Variant Rank": number;
  "Variant Weight": string;
  "Variant Width": string;
  "Product Category 1": string;
  "Product Category 2": string;
}

export default async function importProducts({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const defaultSalesChannel = await salesChannelModuleService.listSalesChannels({
    name: "Default Sales Channel",
  });
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: "sloc_01K3KW7BD1WJ8CK3XE09R4FYXZ",
    },
    [Modules.FULFILLMENT]: {
      fulfillment_provider_id: "manual_manual",
    },
  });
  //const link = container.resolve(ContainerRegistrationKeys.LINK);
  //const query = container.resolve(ContainerRegistrationKeys.QUERY);
  
  // Obtener argumentos de línea de comandos
  const jsonFilePath = './data/import/productos_4.json';
  const batchSize = parseInt(args[1]) || 5;
  
  const startTime = Date.now();
  logger.info(`🚀 Starting product import from: ${jsonFilePath}`);
  
  // Leer el archivo JSON
  const jsonData = fs.readFileSync(path.resolve(jsonFilePath), 'utf8');
  const productsData: ProductImportData[] = JSON.parse(jsonData);
  
  logger.info(`Found ${productsData.length} products to import`);
  
  // Variables para tracking de progreso
  let processedProducts = 0;
  
  try {
    // Configurar datos base necesarios
    await setupBaseData(container, logger);
    
    // Procesar productos en lotes
    const totalBatches = Math.ceil(productsData.length / batchSize);
    const batchStartTime = Date.now();
    
    for (let i = 0; i < productsData.length; i += batchSize) {
      const batch = productsData.slice(i, i + batchSize);
      const currentBatch = Math.floor(i / batchSize) + 1;
      const progressPercentage = Math.round((processedProducts / productsData.length) * 100);
      
      // Calcular tiempo estimado restante
      const elapsedTime = Date.now() - batchStartTime;
      const avgTimePerBatch = elapsedTime / Math.max(1, currentBatch - 1);
      const remainingBatches = totalBatches - currentBatch + 1;
      const estimatedTimeRemaining = Math.round((avgTimePerBatch * remainingBatches) / 1000);
      
      logger.info(`📦 Processing batch ${currentBatch}/${totalBatches} (${progressPercentage}% completed)`);
      logger.info(`   Products in this batch: ${batch.length}`);
      if (currentBatch > 1) {
        logger.info(`   ⏳ Estimated time remaining: ${Math.floor(estimatedTimeRemaining / 60)}m ${estimatedTimeRemaining % 60}s`);
      }
      
      await processBatch(container, batch, logger, defaultSalesChannel);
      
      processedProducts += batch.length;
      const newProgressPercentage = Math.round((processedProducts / productsData.length) * 100);
      
      logger.info(`✅ Batch ${currentBatch} completed! Progress: ${newProgressPercentage}% (${processedProducts}/${productsData.length} products)`);
    }
    
    const endTime = Date.now();
    const totalTime = Math.round((endTime - startTime) / 1000);
    const minutes = Math.floor(totalTime / 60);
    const seconds = totalTime % 60;
    
    logger.info('🎉 Product import completed successfully!');
    logger.info(`⏱️  Total time: ${minutes}m ${seconds}s`);
    logger.info(`📊 Total products imported: ${productsData.length}`);
    logger.info(`⚡ Average time per product: ${Math.round(totalTime / productsData.length * 100) / 100}s`);
    
  } catch (error) {
    const endTime = Date.now();
    const totalTime = Math.round((endTime - startTime) / 1000);
    logger.error(`❌ Error during product import after ${totalTime}s`);
    logger.error(`📊 Products processed before error: ${processedProducts || 0}/${productsData.length}`);
    logger.error(`🔍 Error details:`, error);
    throw error;
  }
}

async function setupBaseData(container: any, logger: any) {
  logger.info('Setting up base data...');
  
  // Por ahora, solo logueamos que estamos listos
  // En el futuro podemos agregar configuración de datos base aquí
  logger.info('Base data setup completed (simplified version)');
}

async function processBatch(container: any, batch: ProductImportData[], logger: any, defaultSalesChannel: any) {
  try {
    logger.info(`🔄 Starting to process ${batch.length} products...`);
    
    const productsToCreate = batch.map(productData => {
      // Validar datos críticos
      const title = productData["Product Title"];
      const handle = productData["Product Handle"];
      
      if (!title || !handle) {
        throw new Error(`Product missing required fields - Title: "${title}", Handle: "${handle}"`);
      }
      
      return {
        title,
        handle,
        description: productData["Product Description"],
        status: ProductStatus.PUBLISHED,
        thumbnail: productData["Product Thumbnail"],
        is_giftcard: false,
        origin_country: productData["Product Origin Country"],
        collection_id: productData["Product Collection Id"],
        type_id: productData["Product Type Id"],
        discountable: productData["Product Discountable"] === "TRUE",
        images: getProductImages(productData),
        tag_ids: getProductTagIds(productData),
        category_ids: [
          productData["Product Category 1"] || "pcat_01K3VPBJVD106013K9XSM5KRQF", 
          productData["Product Category 2"] || "pcat_01K3VPBJVD106013K9XSM5KRQF"
        ].filter((id, index, arr) => id && arr.indexOf(id) === index), // Eliminar duplicados
        // Agregar opciones del producto
        options: [
          {
            title: productData["Variant Option 1 Name"],
            values: [productData["Variant Title"]],
          }
        ],
        variants: [
          {
            title: productData["Variant Title"],
            options: {
              Volumen: productData["Variant Title"],
            },
            prices: [
              {
                amount: productData["Variant Price COP"],
                currency_code: "cop",
              }
            ],
            allow_backorder: true,
            manage_inventory: true,
          },
        ],
        sales_channels:[{ 
          id: "sc_01K3KV0AHJS78D8X7R56SQ2MC1"
        }]
      };
    });


    // Usar el workflow como en seed.ts
    logger.info(`🚀 Creating ${productsToCreate.length} products using workflow...`);
    
    try {
      const { result } = await createProductsWorkflow(container).run({
        input: {
          products: productsToCreate
        }
      });

      logger.info(`✅ Successfully created ${result.length} products with variants and prices:`);
      result.forEach((product, index) => {
        logger.info(`   ${index + 1}. ${product.title} (${product.handle}) - ID: ${product.id}`);
      });
    } catch (workflowError) {
      logger.error('❌ Workflow failed, attempting individual product creation...');
      
      // Intentar crear productos uno por uno para identificar cuál falla
      for (let i = 0; i < productsToCreate.length; i++) {
        try {
          const singleProduct = productsToCreate[i];
          logger.info(`🔄 Attempting to create product ${i + 1}/${productsToCreate.length}: "${singleProduct.handle}"`);
          
          const { result } = await createProductsWorkflow(container).run({
            input: {
              products: [singleProduct]
            }
          });
          
          logger.info(`✅ Successfully created: ${result[0].title} (${result[0].handle}) - ID: ${result[0].id}`);
        } catch (individualError) {
          logger.error(`❌ Failed to create product ${i + 1}:`);
          logger.error(`   Handle: "${productsToCreate[i].handle}"`);
          logger.error(`   Title: "${productsToCreate[i].title}"`);
          logger.error(`   Error:`, individualError);
          throw individualError; // Re-lanzar el error específico
        }
      }
    }
      
    } catch (error) {
    logger.error('❌ Error creating products in batch:', error);
    logger.error('📋 Products in failed batch:');
    batch.forEach((productData, index) => {
      logger.error(`   ${index + 1}. Handle: "${productData["Product Handle"]}" | Title: "${productData["Product Title"]}"`);
    });
    throw error; // Re-lanzar el error para que se propague
  }
}

function getProductImages(productData: ProductImportData): { url: string }[] {
  const images: { url: string }[] = [];
  
  // Agregar imagen principal (thumbnail) si existe
  if (productData["Product Thumbnail"] && productData["Product Thumbnail"].trim() !== "") {
    images.push({ url: productData["Product Thumbnail"] });
  }
  
  // Agregar imagen adicional si existe
  if (productData["Product Image 1"] && productData["Product Image 1"].trim() !== "") {
    images.push({ url: productData["Product Image 1"] });
  }
  
  return images;
}


function getProductTagIds(productData: ProductImportData): string[] {
  const tagIds: string[] = [];
  
  // Iterar desde Product Tag 1 hasta Product Tag 12
  for (let i = 1; i <= 12; i++) {
    const tagKey = `Product Tag ${i}` as keyof ProductImportData;
    const tagValue = productData[tagKey];
    
    // Solo agregar si el tag existe y no está vacío
    if (tagValue && typeof tagValue === 'string' && tagValue.trim() !== "") {
      tagIds.push(tagValue);
    }
  }
  return tagIds;
}

function getProductOptionsFromData(productData: ProductImportData): Array<{title: string, values: string[]}> {
  const options: Array<{title: string, values: string[]}> = [];
  
  // Por ahora solo manejamos Variant Option 1
  if (productData["Variant Option 1 Name"] && productData["Variant Option 1 Value"]) {
    options.push({
      title: productData["Variant Option 1 Name"],
      values: [productData["Variant Option 1 Value"]]
    });
  }
  
  return options;
}

function getProductVariantsFromData(productData: ProductImportData): Array<{
  title: string;
  sku?: string;
  options: Record<string, string>;
  prices: Array<{amount: number, currency_code: string}>;
}> {
  const variants: Array<{
    title: string;
    sku?: string;
    options: Record<string, string>;
    prices: Array<{amount: number, currency_code: string}>;
  }> = [];
  
  // Crear una variante con los datos del JSON
  const variant: {
    title: string;
    sku?: string;
    options: Record<string, string>;
    prices: Array<{amount: number, currency_code: string}>;
  } = {
    title: productData["Variant Title"] || "Default Variant",
    sku: productData["Variant Sku"] || undefined,
    options: getVariantOptions(productData),
    prices: []
  };
  
  // Agregar precio si existe
  const priceAmount = productData["Variant Price COP"];
  if (priceAmount && priceAmount > 0) {
    variant.prices.push({
      amount: Number(priceAmount),
      currency_code: "cop"
    });
  }
  
  variants.push(variant);
  return variants;
}

function getVariantOptions(productData: ProductImportData): Record<string, string> {
  const options: Record<string, string> = {};
  
  // Agregar opción si existe
  if (productData["Variant Option 1 Name"] && productData["Variant Option 1 Value"]) {
    options[productData["Variant Option 1 Name"]] = productData["Variant Option 1 Value"];
  }
  
  return options;
}
