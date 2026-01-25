# API Documentation: `/store/products`

Documentación completa del endpoint de productos para el frontend.

## 📋 Información General

**Endpoint:** `GET /store/products`

**Descripción:** Endpoint personalizado que extiende el endpoint por defecto de Medusa para soportar:
- Ordenamiento por `order_price` (campo personalizado)
- Filtros de categorías avanzados (`category_main` y `category_ids`)
- Optimizaciones de caché con invalidación selectiva

**Base URL:** `http://localhost:9000` (o la URL configurada en `BACKEND_URL`)

**Compatibilidad:** Este endpoint es compatible con `/store/products/filter-by-categories` y soporta todos sus parámetros de filtrado por categorías.

---

## 🔌 Endpoint

```
GET /store/products
```

---

## 📥 Parámetros de Query

### Parámetros de Paginación

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `limit` | `number` | No | `100` | Número de productos por página |
| `offset` | `number` | No | `0` | Número de productos a saltar (para paginación) |

**Ejemplo:**
```
GET /store/products?limit=25&offset=0
```

---

### Parámetros de Ordenamiento

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `order` | `string` | No | `-created_at` | Campo y dirección de ordenamiento |

**Valores soportados para `order`:**
- `order_price` - Ordenar por precio (ascendente, menor a mayor)
- `-order_price` - Ordenar por precio (descendente, mayor a menor)
- `created_at` - Ordenar por fecha de creación (ascendente)
- `-created_at` - Ordenar por fecha de creación (descendente, más recientes primero) ⭐ **Default**
- `updated_at` - Ordenar por fecha de actualización (ascendente)
- `-updated_at` - Ordenar por fecha de actualización (descendente)
- `title` - Ordenar por título (A-Z)
- `-title` - Ordenar por título (Z-A)

**Nota:** El prefijo `-` indica orden descendente.

**Ejemplo:**
```
GET /store/products?order=order_price
GET /store/products?order=-order_price
```

---

### Parámetros de Filtrado

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `status` | `string` | No | Filtrar por estado del producto (`draft`, `proposed`, `published`, `rejected`) |
| `collection_id` | `string` | No | Filtrar por ID de colección |
| `type_id` | `string` | No | Filtrar por ID de tipo de producto |
| `categories` | `string` | No | Filtrar por categorías (formato específico de Medusa) |
| `category_main` | `string` | No | **Nuevo:** Filtrar por categoría principal (compatibilidad con `/store/products/filter-by-categories`) |
| `category_ids` | `string` o `string[]` | No | **Nuevo:** Filtrar por IDs de categorías adicionales. Si se proporciona junto con `category_main`, solo devuelve productos que tienen la categoría principal Y alguna de las categorías adicionales |
| `tags` | `string` | No | Filtrar por tags (formato específico de Medusa) |
| `q` | `string` | No | Búsqueda de texto (título, descripción, etc.) |
| `title` | `string` | No | Filtrar por título exacto |
| `handle` | `string` | No | Filtrar por handle del producto |

**Ejemplo:**
```
GET /store/products?status=published&collection_id=col_antonio_banderas
```

---

### Parámetros de Región y Precios

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `region_id` | `string` | No | ID de región para calcular precios (requerido para `calculated_price`) |

**Ejemplo:**
```
GET /store/products?region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC
```

---

### Parámetros de Campos

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `fields` | `string` | No | Campos específicos a incluir (formato Medusa) |

**Valores recomendados:**
```
*variants.calculated_price,*variants.prices,*options,*options.values,*categories
```

**Ejemplo:**
```
GET /store/products?fields=*variants.calculated_price,*variants.prices,*options,*options.values,*categories
```

---

## 📤 Respuesta

### Estructura de Respuesta

```typescript
{
  products: Product[],
  count: number,
  offset: number,
  limit: number
}
```

### Product Object

```typescript
interface Product {
  id: string;
  title: string;
  handle: string;
  subtitle: string | null;
  description: string | null;
  is_giftcard: boolean;
  status: 'draft' | 'proposed' | 'published' | 'rejected';
  thumbnail: string | null;
  weight: string | null;
  length: string | null;
  height: string | null;
  width: string | null;
  origin_country: string | null;
  hs_code: string | null;
  mid_code: string | null;
  material: string | null;
  discountable: boolean;
  external_id: string | null;
  metadata: Record<string, any> | null;
  type_id: string | null;
  type: ProductType | null;
  collection_id: string | null;
  collection: ProductCollection | null;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  deleted_at: string | null;
  
  // Campo personalizado para ordenamiento por precio
  order_price: number | null; // Precio máximo de las variantes (en centavos/unidades mínimas)
  
  // Relaciones
  variants: ProductVariant[];
  options: ProductOption[];
  images: ProductImage[];
  categories: ProductCategory[];
  tags: ProductTag[];
}
```

### ProductVariant Object

```typescript
interface ProductVariant {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  ean: string | null;
  upc: string | null;
  allow_backorder: boolean;
  manage_inventory: boolean;
  hs_code: string | null;
  origin_country: string | null;
  mid_code: string | null;
  material: string | null;
  weight: string | null;
  length: string | null;
  height: string | null;
  width: string | null;
  metadata: Record<string, any> | null;
  variant_rank: number;
  product_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  
  // Precios (requiere region_id y fields)
  prices: Price[];
  calculated_price: CalculatedPrice | null; // Requiere region_id
  
  // Relaciones
  options: ProductOptionValue[];
}
```

### Price Object

```typescript
interface Price {
  id: string;
  title: string | null;
  currency_code: string;
  min_quantity: number | null;
  max_quantity: number | null;
  rules_count: number;
  price_set_id: string;
  price_list_id: string | null;
  price_list: PriceList | null;
  raw_amount: {
    value: string;
    precision: number;
  };
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  amount: number; // Precio en centavos/unidades mínimas
}
```

### CalculatedPrice Object

```typescript
interface CalculatedPrice {
  id: string; // price_set_id
  is_calculated_price_price_list: boolean;
  is_calculated_price_tax_inclusive: boolean;
  calculated_amount: number;
  raw_calculated_amount: {
    value: string;
    precision: number;
  };
  is_original_price_price_list: boolean;
  is_original_price_tax_inclusive: boolean;
  original_amount: number;
  raw_original_amount: {
    value: string;
    precision: number;
  };
  currency_code: string;
  calculated_price: {
    id: string;
    price_list_id: string | null;
    price_list_type: string | null;
    min_quantity: number | null;
    max_quantity: number | null;
  };
  original_price: {
    id: string;
    price_list_id: string | null;
    price_list_type: string | null;
    min_quantity: number | null;
    max_quantity: number | null;
  };
}
```

---

## 📝 Ejemplos de Uso

### 1. Listado Básico con Precios

```bash
GET /store/products?limit=25&offset=0&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC&fields=*variants.calculated_price,*variants.prices,*options,*options.values,*categories
```

**cURL:**
```bash
curl -X GET "http://localhost:9000/store/products?limit=25&offset=0&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC&fields=*variants.calculated_price,*variants.prices,*options,*options.values,*categories" \
  -H "Content-Type: application/json"
```

---

### 2. Ordenar por Precio (Ascendente)

```bash
GET /store/products?limit=25&offset=0&order=order_price&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC&fields=*variants.calculated_price,*variants.prices,*categories
```

**JavaScript/TypeScript:**
```typescript
const response = await fetch(
  `http://localhost:9000/store/products?limit=25&offset=0&order=order_price&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC&fields=*variants.calculated_price,*variants.prices,*categories`
);
const data = await response.json();
```

---

### 3. Ordenar por Precio (Descendente)

```bash
GET /store/products?limit=25&offset=0&order=-order_price&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC&fields=*variants.calculated_price,*variants.prices,*categories
```

---

### 4. Filtrar por Colección

```bash
GET /store/products?limit=25&offset=0&collection_id=col_antonio_banderas&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC&order=-order_price
```

---

### 5. Búsqueda de Texto

```bash
GET /store/products?q=perfume&limit=25&offset=0&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC
```

---

### 8. Paginación

```typescript
// Página 1 (productos 1-25)
const page1 = await fetch(
  `/store/products?limit=25&offset=0&region_id=${regionId}`
);

// Página 2 (productos 26-50)
const page2 = await fetch(
  `/store/products?limit=25&offset=25&region_id=${regionId}`
);

// Página 3 (productos 51-75)
const page3 = await fetch(
  `/store/products?limit=25&offset=50&region_id=${regionId}`
);
```

---

## 🎯 Casos de Uso Comunes

### Caso 1: Listado de Productos con Precios

```typescript
interface ProductListParams {
  limit?: number;
  offset?: number;
  order?: string;
  regionId: string;
  collectionId?: string;
  status?: string;
  categoryMain?: string;
  categoryIds?: string[];
}

async function getProducts(params: ProductListParams) {
  const queryParams = new URLSearchParams({
    limit: String(params.limit || 25),
    offset: String(params.offset || 0),
    region_id: params.regionId,
    fields: '*variants.calculated_price,*variants.prices,*options,*options.values,*categories',
  });

  if (params.order) {
    queryParams.append('order', params.order);
  }
  if (params.collectionId) {
    queryParams.append('collection_id', params.collectionId);
  }
  if (params.status) {
    queryParams.append('status', params.status);
  }
  if (params.categoryMain) {
    queryParams.append('category_main', params.categoryMain);
  }
  if (params.categoryIds && params.categoryIds.length > 0) {
    params.categoryIds.forEach(id => {
      queryParams.append('category_ids', id);
    });
  }

  const response = await fetch(
    `/store/products?${queryParams.toString()}`
  );
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  return await response.json();
}

// Uso básico
const products = await getProducts({
  limit: 25,
  offset: 0,
  order: 'order_price',
  regionId: 'reg_01K3KW5KVB3KFS8D4HG28WTZKC',
  status: 'published',
});

// Uso con filtros de categoría
const productsByCategory = await getProducts({
  limit: 25,
  offset: 0,
  order: 'order_price',
  regionId: 'reg_01K3KW5KVB3KFS8D4HG28WTZKC',
  categoryMain: 'pcat_01K3VPAHTKZA4K7G4RD4C1GVD4', // Masculinos
  categoryIds: ['pcat_car_01', 'pcat_car_02'], // Cítricos & Frescos, Amaderados
});
```

---

### Caso 2: Obtener Precio de Variante

```typescript
function getVariantPrice(variant: ProductVariant, regionId: string): number | null {
  // Si hay calculated_price, usar ese (más preciso)
  if (variant.calculated_price) {
    return variant.calculated_price.calculated_amount;
  }
  
  // Si no, usar el primer precio disponible
  if (variant.prices && variant.prices.length > 0) {
    return variant.prices[0].amount;
  }
  
  return null;
}

// Uso
const product = products.products[0];
const variant = product.variants[0];
const price = getVariantPrice(variant, regionId);
const priceInCurrency = price ? price / 100 : null; // Convertir de centavos a unidades
```

---

### Caso 3: Formatear Precio para Mostrar

```typescript
function formatPrice(amount: number, currencyCode: string = 'cop'): string {
  const currencySymbols: Record<string, string> = {
    cop: '$',
    usd: '$',
    eur: '€',
  };
  
  const symbol = currencySymbols[currencyCode.toLowerCase()] || currencyCode.toUpperCase();
  const value = amount / 100; // Convertir de centavos a unidades
  
  return `${symbol} ${value.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Uso
const variant = product.variants[0];
if (variant.calculated_price) {
  const formattedPrice = formatPrice(
    variant.calculated_price.calculated_amount,
    variant.calculated_price.currency_code
  );
  console.log(formattedPrice); // "$ 130.000"
}
```

---

### Caso 4: Paginación con React

```typescript
import { useState, useEffect } from 'react';

function useProducts(regionId: string, categoryMain?: string, categoryIds?: string[]) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 25;

  useEffect(() => {
    async function fetchProducts() {
      setLoading(true);
      try {
        const offset = (page - 1) * limit;
        const queryParams = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
          region_id: regionId,
          order: '-order_price',
          fields: '*variants.calculated_price,*variants.prices,*categories',
        });

        if (categoryMain) {
          queryParams.append('category_main', categoryMain);
        }
        if (categoryIds && categoryIds.length > 0) {
          categoryIds.forEach(id => {
            queryParams.append('category_ids', id);
          });
        }

        const response = await fetch(
          `/store/products?${queryParams.toString()}`
        );
        const data = await response.json();
        setProducts(data.products);
        setTotalCount(data.count);
      } catch (error) {
        console.error('Error fetching products:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchProducts();
  }, [page, regionId, categoryMain, categoryIds?.join(',')]);

  const totalPages = Math.ceil(totalCount / limit);

  return {
    products,
    loading,
    page,
    setPage,
    totalPages,
    totalCount,
  };
}

// Uso
const { products, loading, page, setPage, totalPages } = useProducts(
  regionId,
  'pcat_01K3VPAHTKZA4K7G4RD4C1GVD4', // categoryMain
  ['pcat_car_01', 'pcat_car_02'] // categoryIds
);
```

---

### Caso 5: Filtros de Categoría con React

```typescript
import { useState, useEffect } from 'react';

interface CategoryFilter {
  main: string | null;
  additional: string[];
}

function useProductsWithCategoryFilter(regionId: string) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>({
    main: null,
    additional: [],
  });
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 25;

  useEffect(() => {
    async function fetchProducts() {
      setLoading(true);
      try {
        const offset = (page - 1) * limit;
        const queryParams = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
          region_id: regionId,
          order: '-order_price',
          fields: '*variants.calculated_price,*variants.prices,*categories',
        });

        if (categoryFilter.main) {
          queryParams.append('category_main', categoryFilter.main);
        }
        if (categoryFilter.additional.length > 0) {
          categoryFilter.additional.forEach(id => {
            queryParams.append('category_ids', id);
          });
        }

        const response = await fetch(
          `/store/products?${queryParams.toString()}`
        );
        const data = await response.json();
        setProducts(data.products);
        setTotalCount(data.count);
      } catch (error) {
        console.error('Error fetching products:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchProducts();
  }, [page, regionId, categoryFilter.main, categoryFilter.additional.join(',')]);

  const updateCategoryFilter = (main: string | null, additional: string[] = []) => {
    setCategoryFilter({ main, additional });
    setPage(1); // Reset a página 1 cuando cambia el filtro
  };

  const totalPages = Math.ceil(totalCount / limit);

  return {
    products,
    loading,
    page,
    setPage,
    totalPages,
    totalCount,
    categoryFilter,
    updateCategoryFilter,
  };
}

// Uso en componente
function ProductList() {
  const { 
    products, 
    loading, 
    page, 
    setPage, 
    totalPages,
    categoryFilter,
    updateCategoryFilter 
  } = useProductsWithCategoryFilter(regionId);

  return (
    <div>
      {/* Selector de categoría principal */}
      <select 
        value={categoryFilter.main || ''} 
        onChange={(e) => updateCategoryFilter(e.target.value || null)}
      >
        <option value="">Todas las categorías</option>
        <option value="pcat_01K3VPAHTKZA4K7G4RD4C1GVD4">Masculinos</option>
        <option value="pcat_02...">Femeninos</option>
      </select>

      {/* Selector de categorías adicionales (checkboxes) */}
      <div>
        <label>
          <input 
            type="checkbox"
            checked={categoryFilter.additional.includes('pcat_car_01')}
            onChange={(e) => {
              const newAdditional = e.target.checked
                ? [...categoryFilter.additional, 'pcat_car_01']
                : categoryFilter.additional.filter(id => id !== 'pcat_car_01');
              updateCategoryFilter(categoryFilter.main, newAdditional);
            }}
          />
          Cítricos & Frescos
        </label>
        {/* Más checkboxes... */}
      </div>

      {/* Lista de productos */}
      {loading ? (
        <div>Cargando...</div>
      ) : (
        <div>
          {products.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      {/* Paginación */}
      <div>
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
          Anterior
        </button>
        <span>Página {page} de {totalPages}</span>
        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
          Siguiente
        </button>
      </div>
    </div>
  );
}
```

---

## ⚠️ Notas Importantes

### 1. Campo `order_price`

- **Tipo:** `number | null`
- **Unidad:** Centavos/unidades mínimas (igual que `amount` en precios)
- **Descripción:** Precio máximo entre todas las variantes del producto
- **Uso:** Para ordenamiento por precio sin necesidad de calcular en el frontend
- **Actualización:** Se actualiza automáticamente cuando se ejecuta el script `products:update-price-sort`

### 2. Precios y `calculated_price`

- **`prices`:** Array de todos los precios disponibles para la variante
- **`calculated_price`:** Precio calculado para la región especificada (requiere `region_id`)
- **Si no hay `region_id`:** `calculated_price` será `null`
- **Formato:** Los precios están en centavos/unidades mínimas (ej: 130000 = $130.000 COP)

### 3. Caché

- El endpoint utiliza caché Redis para mejorar el rendimiento
- Las respuestas se cachean automáticamente
- La caché se invalida automáticamente cuando se modifica un producto
- **Tiempo de respuesta esperado:**
  - Cache HIT: ~50-150ms
  - Cache MISS: ~2-5 segundos (primera vez)
- **Nota:** Las combinaciones de categorías más comunes están pre-cacheadas para mejor rendimiento
- **Nota:** Las combinaciones de categorías más comunes están pre-cacheadas para mejor rendimiento

### 4. Ordenamiento por `order_price`

- Requiere que el campo `order_price` esté actualizado en la base de datos
- Si `order_price` es `null`, esos productos aparecerán al final (o al inicio si es descendente)
- Para actualizar `order_price`, ejecutar: `pnpm products:update-price-sort`

---

## 🔍 Códigos de Estado HTTP

| Código | Descripción |
|--------|-------------|
| `200` | Éxito - Respuesta contiene productos |
| `400` | Error de validación (parámetros inválidos) |
| `500` | Error del servidor |

---

## 🐛 Manejo de Errores

### Ejemplo de Respuesta de Error

```json
{
  "message": "Error obteniendo productos",
  "error": "Error message here"
}
```

### Ejemplo de Manejo en Frontend

```typescript
try {
  const response = await fetch('/store/products?...');
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Error fetching products');
  }
  
  const data = await response.json();
  return data;
} catch (error) {
  console.error('Error:', error);
  // Manejar error (mostrar mensaje al usuario, etc.)
  throw error;
}
```

---

## 📊 Ejemplo de Respuesta Completa

```json
{
  "products": [
    {
      "id": "prod_01K8023BK986A0JSSEP8H4QJFB",
      "title": "Antonio Banderas Blue Seduction Summer Essence For Men",
      "handle": "antonio-banderas-blue-seduction-summer-essence-for-men",
      "status": "published",
      "thumbnail": "https://medusa-store-scg.s3.us-east-2.amazonaws.com/images_products_aura/...",
      "collection_id": "col_antonio_banderas",
      "collection": {
        "id": "col_antonio_banderas",
        "title": "Antonio Banderas",
        "handle": "antonio_banderas"
      },
      "order_price": 130000,
      "variants": [
        {
          "id": "variant_01K8023D0CBM3F05FPZQ7VN9VY",
          "title": "100ml",
          "prices": [
            {
              "id": "price_01K8023EXBK9K3SY6F36YZBZP8",
              "currency_code": "cop",
              "amount": 130000,
              "raw_amount": {
                "value": "130000",
                "precision": 20
              }
            }
          ],
          "calculated_price": {
            "id": "pset_01K8023EXBYXKA4NH0Q1ZHPKGX",
            "calculated_amount": 130000,
            "currency_code": "cop",
            "raw_calculated_amount": {
              "value": "130000",
              "precision": 20
            }
          }
        }
      ],
      "categories": [...],
      "tags": [...],
      "images": [...],
      "created_at": "2025-11-06T04:18:56.804Z",
      "updated_at": "2025-11-06T04:18:56.804Z"
    }
  ],
  "count": 395,
  "offset": 0,
  "limit": 25
}
```

---

## 📋 Guía Rápida de Filtros de Categorías

### ¿Cómo funcionan los filtros de categorías?

Los filtros de categorías permiten refinar búsquedas de productos usando una combinación de categorías:

1. **Solo `category_main`**: Devuelve todos los productos de esa categoría
   ```
   GET /store/products?category_main=pcat_01K3VPAHTKZA4K7G4RD4C1GVD4
   ```

2. **`category_main` + `category_ids`**: Devuelve productos que:
   - Pertenecen a la categoría principal (`category_main`)
   - Y tienen al menos una de las categorías adicionales (`category_ids`)
   ```
   GET /store/products?category_main=pcat_01K3VPAHTKZA4K7G4RD4C1GVD4&category_ids=pcat_car_01
   ```

### Ejemplo Práctico

**Escenario:** Filtrar perfumes masculinos que sean cítricos o frescos

```typescript
// Categoría principal: Masculinos
const categoryMain = 'pcat_01K3VPAHTKZA4K7G4RD4C1GVD4';

// Categorías adicionales: Cítricos & Frescos, Amaderados
const categoryIds = ['pcat_car_01', 'pcat_car_03'];

const queryParams = new URLSearchParams({
  limit: '25',
  offset: '0',
  category_main: categoryMain,
  region_id: regionId,
  order: 'order_price',
});

categoryIds.forEach(id => {
  queryParams.append('category_ids', id);
});

const response = await fetch(`/store/products?${queryParams.toString()}`);
const data = await response.json();

// data.products contiene solo productos que:
// - Son masculinos (category_main)
// - Y son cítricos/frescos O amaderados (category_ids)
```

### Notas Importantes

- **`category_main` es opcional**: Si no se proporciona, se devuelven todos los productos (sujeto a otros filtros)
- **`category_ids` es opcional**: Si se proporciona `category_main` pero no `category_ids`, se devuelven todos los productos de la categoría principal
- **Lógica OR en `category_ids`**: Si un producto tiene cualquiera de las categorías en `category_ids`, se incluye en los resultados
- **Combinación con otros filtros**: Los filtros de categoría se pueden combinar con `collection_id`, `status`, `order`, etc.
- **Compatibilidad**: Estos filtros son compatibles con el endpoint `/store/products/filter-by-categories`

---

## 🔗 Referencias

- [Plan de Caché de Productos](./CACHE_PRODUCTS_PLAN.md)
- [Optimizaciones de Caché](./CACHE_OPTIMIZATIONS.md)
- [Scripts de Productos](./SCRIPTS_PRODUCTS.md)

---

## 📞 Soporte

Para preguntas o problemas con el endpoint, contactar al equipo de backend.
