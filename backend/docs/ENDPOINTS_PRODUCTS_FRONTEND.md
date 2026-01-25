# Endpoints de Productos - Guía para Frontend

Documentación rápida de los dos endpoints de productos disponibles.

---

## 📋 Resumen

Existen **2 endpoints** para obtener productos:

1. **`/store/products`** - Catálogo completo con filtros opcionales
2. **`/store/products/filter-by-categories`** - Filtrado específico por categorías

Ambos endpoints soportan:
- ✅ Ordenamiento por `order_price` (precio)
- ✅ Sistema de caché con invalidación automática
- ✅ Paginación (`limit` y `offset`)
- ✅ Precios calculados por región (`region_id`)
- ✅ Respuestas optimizadas con precios completos

---

## 1. `/store/products` - Catálogo Completo

**Endpoint:** `GET /store/products`

**Uso:** Para listar todos los productos del catálogo con filtros opcionales.

### Parámetros Principales

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `limit` | `number` | No | Productos por página (default: 100) |
| `offset` | `number` | No | Offset para paginación (default: 0) |
| `order` | `string` | No | Ordenamiento (`order_price`, `-order_price`, `created_at`, etc.) |
| `region_id` | `string` | No | ID de región para calcular precios |
| `status` | `string` | No | Filtrar por estado (`published`, `draft`, etc.) |
| `collection_id` | `string` | No | Filtrar por colección |
| `fields` | `string` | No | Campos a incluir (ej: `*variants.calculated_price,*variants.prices`) |

### Ejemplo de Uso

```typescript
// Obtener productos ordenados por precio (más caros primero)
const response = await fetch(
  `/store/products?limit=25&offset=0&order=-order_price&region_id=${regionId}&fields=*variants.calculated_price,*variants.prices,*categories`
);
const data = await response.json();

// data.products - Array de productos
// data.count - Total de productos
// data.offset - Offset actual
// data.limit - Límite de productos
```

### Respuesta

```json
{
  "products": [
    {
      "id": "prod_...",
      "title": "Producto",
      "order_price": 130000,
      "variants": [
        {
          "id": "variant_...",
          "prices": [...],
          "calculated_price": {
            "calculated_amount": 130000,
            "currency_code": "cop"
          }
        }
      ],
      "categories": [...]
    }
  ],
  "count": 395,
  "offset": 0,
  "limit": 25
}
```

---

## 2. `/store/products/filter-by-categories` - Filtrado por Categorías

**Endpoint:** `GET /store/products/filter-by-categories`

**Uso:** Para filtrar productos específicamente por categorías. **Requiere** `category_main`.

### Parámetros Principales

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `category_main` | `string` | **Sí** | ID de la categoría principal |
| `category_ids` | `string[]` | No | IDs de categorías adicionales (filtro AND) |
| `limit` | `number` | No | Productos por página (default: 100) |
| `offset` | `number` | No | Offset para paginación (default: 0) |
| `order` | `string` | No | Ordenamiento (`order_price`, `-order_price`, etc.) |
| `region_id` | `string` | No | ID de región para calcular precios |
| `fields` | `string` | No | Campos a incluir |

### Lógica de Filtrado

- **Solo `category_main`**: Devuelve todos los productos de esa categoría
- **`category_main` + `category_ids`**: Devuelve productos que:
  - Pertenecen a `category_main` **Y**
  - Tienen **al menos una** de las categorías en `category_ids`

### Ejemplo de Uso

```typescript
// Filtrar perfumes masculinos que sean cítricos o frescos
const categoryMain = 'pcat_01K3VPAHTKZA4K7G4RD4C1GVD4'; // Masculinos
const categoryIds = ['pcat_car_01', 'pcat_car_02']; // Cítricos & Frescos, Amaderados

const queryParams = new URLSearchParams({
  category_main: categoryMain,
  limit: '25',
  offset: '0',
  order: '-order_price',
  region_id: regionId,
  fields: '*variants.calculated_price,*variants.prices,*categories',
});

// Agregar múltiples category_ids
categoryIds.forEach(id => {
  queryParams.append('category_ids', id);
});

const response = await fetch(`/store/products/filter-by-categories?${queryParams.toString()}`);
const data = await response.json();
```

### Respuesta

```json
{
  "products": [...],
  "count": 50,
  "offset": 0,
  "limit": 25,
  "filters": {
    "category_main": "pcat_...",
    "category_ids": ["pcat_...", "pcat_..."]
  }
}
```

---

## 🔄 ¿Cuándo usar cada endpoint?

### Usa `/store/products` cuando:
- ✅ Necesitas listar todo el catálogo
- ✅ Quieres filtrar por colección, estado, tipo, etc.
- ✅ No necesitas filtrar específicamente por categorías
- ✅ Quieres búsqueda de texto (`q`)

### Usa `/store/products/filter-by-categories` cuando:
- ✅ Necesitas filtrar por categorías (siempre requiere `category_main`)
- ✅ Quieres combinar categoría principal con categorías adicionales
- ✅ Necesitas un endpoint dedicado para filtros de categorías

---

## ⚡ Ordenamiento por Precio

Ambos endpoints soportan ordenamiento por precio usando el campo `order_price`:

- `order=order_price` - Precio ascendente (menor a mayor)
- `order=-order_price` - Precio descendente (mayor a menor) ⭐ **Recomendado**

**Nota:** El campo `order_price` está disponible en cada producto y representa el precio más alto entre todas sus variantes.

---

## 💾 Caché

Ambos endpoints utilizan caché Redis:
- **Cache HIT**: ~50-150ms
- **Cache MISS**: ~2-5 segundos (primera vez)
- **Invalidación automática**: Cuando se modifica un producto

---

## 📝 Ejemplo Completo con React

```typescript
import { useState, useEffect } from 'react';

// Hook para catálogo completo
function useProducts(regionId: string, order: string = '-order_price') {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 25;

  useEffect(() => {
    async function fetchProducts() {
      setLoading(true);
      try {
        const offset = (page - 1) * limit;
        const response = await fetch(
          `/store/products?limit=${limit}&offset=${offset}&region_id=${regionId}&order=${order}&fields=*variants.calculated_price,*variants.prices,*categories`
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
  }, [page, regionId, order]);

  return { products, loading, page, setPage, totalCount, totalPages: Math.ceil(totalCount / limit) };
}

// Hook para filtrado por categorías
function useProductsByCategory(
  regionId: string,
  categoryMain: string,
  categoryIds: string[] = [],
  order: string = '-order_price'
) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 25;

  useEffect(() => {
    async function fetchProducts() {
      if (!categoryMain) return;
      
      setLoading(true);
      try {
        const offset = (page - 1) * limit;
        const queryParams = new URLSearchParams({
          category_main: categoryMain,
          limit: String(limit),
          offset: String(offset),
          region_id: regionId,
          order: order,
          fields: '*variants.calculated_price,*variants.prices,*categories',
        });

        categoryIds.forEach(id => {
          queryParams.append('category_ids', id);
        });

        const response = await fetch(
          `/store/products/filter-by-categories?${queryParams.toString()}`
        );
        const data = await response.json();
        setProducts(data.products);
        setTotalCount(data.count);
      } catch (error) {
        console.error('Error fetching products by category:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchProducts();
  }, [page, regionId, categoryMain, categoryIds.join(','), order]);

  return { products, loading, page, setPage, totalCount, totalPages: Math.ceil(totalCount / limit) };
}

// Uso
function ProductList() {
  const regionId = 'reg_01K3KW5KVB3KFS8D4HG28WTZKC';
  const { products, loading, page, setPage, totalPages } = useProducts(regionId);
  
  // O para categorías:
  // const { products, loading, page, setPage, totalPages } = useProductsByCategory(
  //   regionId,
  //   'pcat_01K3VPAHTKZA4K7G4RD4C1GVD4',
  //   ['pcat_car_01']
  // );

  return (
    <div>
      {loading ? (
        <div>Cargando...</div>
      ) : (
        <div>
          {products.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
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

1. **`category_main` es requerido** en `/store/products/filter-by-categories`
2. **`order_price`** está disponible en cada producto para ordenamiento rápido
3. **`calculated_price`** requiere `region_id` para ser calculado
4. **Caché**: Las respuestas se cachean automáticamente, no necesitas hacer nada especial
5. **Paginación**: Usa `offset` y `limit` para navegar entre páginas

---

## 🔗 Referencias

- [Documentación Completa del API](./API_STORE_PRODUCTS.md) - Documentación detallada con más ejemplos
- [Plan de Caché](./CACHE_PRODUCTS_PLAN.md) - Detalles técnicos del sistema de caché

---

**Última actualización:** Diciembre 2024
