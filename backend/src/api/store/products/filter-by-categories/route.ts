import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { IProductModuleService, IPricingModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { category_main, category_ids } = req.query;
    
    // Validar parámetros requeridos
    if (!category_main) {
      return res.status(400).json({
        error: "category_main parameter is required"
      });
    }

    // Convertir category_ids a array si viene como string
    const categoryIdsArray = Array.isArray(category_ids) 
      ? category_ids 
      : category_ids 
        ? [category_ids] 
        : [];

    const productModuleService: IProductModuleService = req.scope.resolve(Modules.PRODUCT);
    const pricingModuleService: IPricingModuleService = req.scope.resolve(Modules.PRICING);

    // Paso 1: Obtener todos los productos que pertenecen a la categoría principal
    const productsWithMainCategory = await productModuleService.listProducts({
      // Usar la sintaxis correcta para relaciones many-to-many
      categories: {
        id: [category_main as string]
      }
    }, {
      // Incluir relaciones necesarias usando el segundo parámetro
      relations: ["categories", "variants", "images", "collection", "tags"]
    });

    // Paso 1.5: Obtener precios para todas las variantes
    const variantIds = productsWithMainCategory.flatMap(product => 
      product.variants?.map(variant => variant.id) || []
    );

    let prices = [];
    if (variantIds.length > 0) {
      prices = await pricingModuleService.listPrices({
        price_set_id: variantIds
      });
    }


    // Función para enriquecer productos con precios
    const enrichProductsWithPrices = (products: any[]) => {
      return products.map(product => {
        const enrichedVariants = product.variants?.map(variant => {
          const variantPrices = prices.filter(price => price.price_set_id === variant.id);
          return {
            ...variant,
            prices: variantPrices
          };
        }) || [];

        return {
          ...product,
          variants: enrichedVariants
        };
      });
    };

    // Si no hay category_ids adicionales, devolver todos los productos de la categoría principal
    if (categoryIdsArray.length === 0) {
      const enrichedProducts = enrichProductsWithPrices(productsWithMainCategory);
      
      return res.json({
        products: enrichedProducts,
        count: enrichedProducts.length,
        filters: {
          category_main,
          category_ids: []
        }
      });
    }

    // Paso 2: Filtrar productos que también tienen alguna de las categorías adicionales
    const filteredProducts = productsWithMainCategory.filter(product => {
      if (!product.categories || product.categories.length === 0) {
        return false;
      }

      // Verificar si el producto tiene alguna de las categorías adicionales
      const hasAdditionalCategory = product.categories.some(category => 
        categoryIdsArray.includes(category.id)
      );

      return hasAdditionalCategory;
    });


    const enrichedFilteredProducts = enrichProductsWithPrices(filteredProducts);

    return res.json({
      products: enrichedFilteredProducts,
      count: enrichedFilteredProducts.length,
      filters: {
        category_main,
        category_ids: categoryIdsArray
      }
    });

  } catch (error) {
    console.error("Error filtering products by categories:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message
    });
  }
};
