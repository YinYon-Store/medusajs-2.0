import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { IProductModuleService } from "@medusajs/framework/types";
import MeiliSearch from "meilisearch";
import { MEILISEARCH_HOST, MEILISEARCH_ADMIN_KEY } from "../lib/constants";

const MEILISEARCH_INDEX_NAME = "products";

export default async function reindexMeilisearch({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const productModuleService: IProductModuleService = container.resolve(Modules.PRODUCT);

  // Validar configuración de Meilisearch
  if (!MEILISEARCH_HOST || !MEILISEARCH_ADMIN_KEY) {
    logger.error("❌ Meilisearch configuration is missing. Please set MEILISEARCH_HOST and MEILISEARCH_ADMIN_KEY environment variables.");
    process.exit(1);
  }

  logger.info("[Meilisearch] Starting reindexation");

  try {
    // Crear cliente de Meilisearch
    const client = new MeiliSearch({
      host: MEILISEARCH_HOST,
      apiKey: MEILISEARCH_ADMIN_KEY,
    });

    const index = client.index(MEILISEARCH_INDEX_NAME);

    // Paso 1: Obtener todos los productos activos de la base de datos
    logger.info("[Meilisearch] Fetching products...");
    const products = await productModuleService.listProducts(
      {},
      {
        relations: ["categories", "collection"],
      }
    );

    const totalCount = products.length;
    if (totalCount === 0) {
      logger.warn("[Meilisearch] No products found");
      return;
    }
    const documents = products.map((product) => {
      // Formato según la configuración del plugin en medusa-config.js
      return {
        id: product.id,
        title: product.title || "",
        description: product.description || "",
        handle: product.handle || "",
        thumbnail: product.thumbnail || null,
      };
    });

    // Eliminar todos los documentos existentes del índice
    try {
      await index.deleteAllDocuments();
    } catch (error: any) {
      if (error.code !== "index_not_found") {
        throw error;
      }
    }

    // Paso 4: Indexar los productos en lotes (Meilisearch recomienda lotes de 1000)
    const batchSize = 1000;
    let indexedCount = 0;

    logger.info(`[Meilisearch] Indexing ${documents.length} products in batches of ${batchSize}...`);

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(documents.length / batchSize);

      try {
        const task = await index.addDocuments(batch);
        
        // Esperar a que la tarea se complete
        await index.waitForTask(task.taskUid);
        
        indexedCount += batch.length;
        const progress = Math.round((indexedCount / documents.length) * 100);
        
        logger.info(`[Meilisearch] Batch ${batchNumber}/${totalBatches} (${progress}%)`);
      } catch (error: any) {
        logger.error(`❌ Error indexing batch ${batchNumber}:`, error.message);
        throw error;
      }
    }

    // Paso 5: Configurar el índice según la configuración del plugin
    try {
      await index.updateSettings({
        searchableAttributes: ["title", "description"],
        displayedAttributes: ["id", "handle", "title", "description", "thumbnail"],
        filterableAttributes: ["id", "handle"],
      });
    } catch (error: any) {
      logger.warn(`[Meilisearch] Could not update settings: ${error.message}`);
    }

    const stats = await index.getStats();
    logger.info(`[Meilisearch] Reindexation completed: ${indexedCount} products indexed`);

  } catch (error: any) {
    logger.error("[Meilisearch] Reindexation error:", error);
    throw error;
  }
}
