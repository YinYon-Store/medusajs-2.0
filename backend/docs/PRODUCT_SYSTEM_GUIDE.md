# Product System & API Guide

This document provides a comprehensive guide to the product system, including API endpoints, caching architecture, and maintenance scripts.

---

## 🔌 API Reference (Frontend)

### 1. Main Endpoints

| Endpoint | Purpose | Required Params |
|----------|---------|-----------------|
| `GET /store/products` | Full catalog listing and general filtering | None |
| `GET /store/products/filter-by-categories` | Specialized category filtering | `category_main` |

### 2. Common Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | `number` | Items per page (default: 100) |
| `offset` | `number` | Pagination offset (default: 0) |
| `order` | `string` | Sorting: `order_price`, `-order_price`, `created_at`, `-created_at` (default) |
| `region_id` | `string` | Required for `calculated_price` |
| `category_main` | `string` | Main category ID |
| `category_ids` | `string[]` | Additional category IDs (AND logic with `category_main`) |
| `fields` | `string` | Recommended: `*variants.calculated_price,*variants.prices,*options,*options.values,*categories` |

### 3. Sorting by Price
Use `order=order_price` (Ascending) or `order=-order_price` (Descending). This uses a pre-calculated field for maximum performance.

### 4. Code Example (React Hook)

```typescript
function useProducts(regionId: string, categoryMain?: string, categoryIds: string[] = []) {
  const [data, setData] = useState({ products: [], count: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function fetchProducts() {
      setLoading(true);
      const params = new URLSearchParams({
        limit: '25',
        region_id: regionId,
        order: '-order_price',
        fields: '*variants.calculated_price,*variants.prices,*categories'
      });
      if (categoryMain) params.append('category_main', categoryMain);
      categoryIds.forEach(id => params.append('category_ids', id));

      const res = await fetch(`/store/products?${params.toString()}`);
      setData(await res.json());
      setLoading(false);
    }
    fetchProducts();
  }, [regionId, categoryMain, categoryIds.join(',')]);

  return { ...data, loading };
}
```

---

## 🏗️ Architecture & Caching

### 1. Caching Strategy
- **Redis-based Cache-Aside**: We check Redis before hitting the database.
- **Selective Invalidation**: When a product is updated, only the cache keys containing that specific product are invalidated using a Redis Set index (`products:index:{product_id}`).
- **Performance**: Cache HITs typically respond in 50-150ms.

### 2. Implementation Details
- **Location**: `src/lib/cache/product-cache-service.ts`
- **Keys**: Generated from query parameters (hashed for consistency).
- **Asynchronous Storing**: Cache `set` operations happen in the background (`setImmediate`) to avoid blocking the response.
- **Pipelining**: Multiple Redis commands are batched into a single round-trip.

---

## 🚀 Maintenance Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| Update Prices | `pnpm products:update-price-sort` | Recalculates `order_price` for all products. Run after bulk imports or price changes. |
| Warm Cache | `pnpm products:warm-cache` | Pre-populates Redis with common queries (pages of 25, popular categories). |

---

## 📝 Best Practices
1. **Always provide `region_id`**: Necessary for accurate pricing and `order_price` sorting.
2. **Use `order_price`**: For the fastest price-based sorting.
3. **Handle Loading States**: Cache misses can take 2-4 seconds while the system builds the initial response.
