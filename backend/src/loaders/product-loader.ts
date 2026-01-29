import { LoaderOptions } from "@medusajs/framework/types";

/**
 * Loader para productos que expone campos personalizados desde metadata
 * como campos de nivel superior en la respuesta.
 * 
 * Este loader toma el campo `metadata.max_variant_price` y lo expone
 * como `max_variant_price` directamente en el objeto producto.
 */
/*
export default async function productLoader(
  { container }: LoaderOptions<{ id: string }>
) {
  // Este loader se ejecuta automáticamente cuando se consultan productos
  // y transforma la respuesta para incluir campos personalizados
}

export function transformProductWithPriceSort(product: any): any {
  if (!product) return product;

  // Extraer campos de metadata y exponerlos como campos de nivel superior
  const metadata = product.metadata || {};
  
  return {
    ...product,
    // Exponer max_variant_price desde metadata
    max_variant_price: metadata.max_variant_price || null,
    max_variant_price_currency: metadata.max_variant_price_currency || null,
    price_sort_order: metadata.price_sort_order || null,
  };
}

export function transformProductsWithPriceSort(products: any[]): any[] {
  return products.map(transformProductWithPriceSort);
}
*/