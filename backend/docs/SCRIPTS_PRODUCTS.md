# Scripts de Productos - Documentación

Esta documentación describe los scripts disponibles para la gestión de productos y caché.

## 📋 Scripts Disponibles

### 1. `products:update-price-sort`

**Comando:** `pnpm products:update-price-sort`

**Propósito:** Actualiza el campo `order_price` en la tabla `product` basándose en el precio máximo de las variantes de cada producto.

**Cuándo usar:**
- Después de agregar nuevos productos con variantes
- Después de modificar precios de variantes
- Para inicializar el campo `order_price` en productos existentes
- Como mantenimiento periódico para mantener la consistencia

**Ejemplo de uso:**
```bash
# Básico
pnpm products:update-price-sort

# Con logging detallado
DEBUG=true pnpm products:update-price-sort
```

**Archivo:** `src/scripts/products/update-product-price-sort.ts`

**Documentación completa:** Ver [README.md](../src/scripts/products/README.md)

---

### 2. `products:warm-cache`

**Comando:** `pnpm products:warm-cache`

**Propósito:** Pre-cachea (warm-up) todas las páginas de productos en Redis para mejorar el rendimiento del endpoint `/store/products`.

**Cuándo usar:**
- Después de limpiar la caché de productos
- Después de agregar/modificar muchos productos
- En el startup del servidor (opcional)
- Manualmente cuando necesites refrescar toda la caché

**Ejemplo de uso:**
```bash
# Básico (páginas de 25, orden por order_price)
pnpm products:warm-cache

# Con configuración personalizada
PRODUCT_CACHE_WARM_PAGE_SIZE=30 \
PRODUCT_CACHE_WARM_REGION_ID=reg_01K3KW5KVB3KFS8D4HG28WTZKC \
PRODUCT_CACHE_WARM_ORDER=order_price \
pnpm products:warm-cache
```

**Variables de entorno opcionales:**
- `PRODUCT_CACHE_WARM_PAGE_SIZE`: Tamaño de página (default: 25)
- `PRODUCT_CACHE_WARM_REGION_ID`: ID de región para precios calculados
- `PRODUCT_CACHE_WARM_ORDER`: Ordenamiento (default: `order_price`)

**Archivo:** `src/scripts/products/warm-product-cache.ts`

**Documentación completa:** Ver [README.md](../src/scripts/products/README.md)

---

## 🚀 Flujo de Trabajo Recomendado

### Inicialización (Primera vez)
1. Ejecutar `pnpm products:update-price-sort` para inicializar `order_price`
2. Ejecutar `pnpm products:warm-cache` para pre-cachear todas las páginas

### Mantenimiento Regular
1. Cuando se agregan/modifican productos:
   - Ejecutar `pnpm products:update-price-sort` para actualizar `order_price`
   - La caché se invalida automáticamente vía subscribers
   - Opcional: Ejecutar `pnpm products:warm-cache` para re-cachear todo

### Después de Limpiar Caché
1. Ejecutar `pnpm products:warm-cache` para re-cachear todas las páginas

---

## 📝 Referencias

- [README de Scripts de Productos](../src/scripts/products/README.md)
- [Plan de Caché de Productos](./CACHE_PRODUCTS_PLAN.md)
- [Optimizaciones de Caché](./CACHE_OPTIMIZATIONS.md)
