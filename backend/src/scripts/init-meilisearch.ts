import MeiliSearch from "meilisearch";
import { MEILISEARCH_HOST, MEILISEARCH_ADMIN_KEY } from "../lib/constants";

const MEILISEARCH_INDEX_NAME = "products";

/**
 * Initialize Meilisearch index with correct settings
 * This script creates the index and configures it so the plugin can start successfully
 */
async function initMeilisearch() {
  if (!MEILISEARCH_HOST || !MEILISEARCH_ADMIN_KEY) {
    console.error("[Meilisearch] Configuration missing: MEILISEARCH_HOST and MEILISEARCH_ADMIN_KEY required");
    process.exit(1);
  }

  try {
    // Create Meilisearch client
    const client = new MeiliSearch({
      host: MEILISEARCH_HOST,
      apiKey: MEILISEARCH_ADMIN_KEY,
    });

    // Test connection
    try {
      await client.health();
    } catch (error: any) {
      console.error("[Meilisearch] Connection failed:", error.message);
      throw error;
    }

    const index = client.index(MEILISEARCH_INDEX_NAME);

    // Check if index exists
    let indexExists = false;
    try {
      await index.getStats();
      indexExists = true;
    } catch (error: any) {
      if (error.code === "index_not_found" || error.message?.includes("index_not_found")) {
        indexExists = false;
      } else {
        throw error;
      }
    }

    // Configure index settings
    try {
      await index.updateSettings({
        searchableAttributes: ["title", "description"],
        displayedAttributes: ["id", "handle", "title", "description", "thumbnail"],
        filterableAttributes: ["id", "handle"],
      });
    } catch (error: any) {
      // If index doesn't exist, create it first with a dummy document
      if (error.code === "index_not_found" || error.message?.includes("index_not_found")) {
        // Create index by adding a dummy document
        await index.addDocuments([{
          id: "dummy",
          title: "dummy",
          description: "dummy",
          handle: "dummy",
          thumbnail: null,
        }]);

        // Wait for indexing to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Now configure settings
        await index.updateSettings({
          searchableAttributes: ["title", "description"],
          displayedAttributes: ["id", "handle", "title", "description", "thumbnail"],
          filterableAttributes: ["id", "handle"],
        });

        // Delete the dummy document
        await index.deleteDocument("dummy");
      } else {
        throw error;
      }
    }

    console.log("[Meilisearch] Index initialized successfully");

  } catch (error: any) {
    console.error("[Meilisearch] Initialization error:", error.message);
    if (error.code) {
      console.error(`[Meilisearch] Error code: ${error.code}`);
    }
    process.exit(1);
  }
}

// Export as default for medusa exec
export default async function ({ container }: any) {
  await initMeilisearch();
};
