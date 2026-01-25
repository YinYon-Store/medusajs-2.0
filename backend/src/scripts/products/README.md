# Scripts de Productos y Caché

Esta carpeta contiene scripts relacionados con la gestión de productos y el sistema de caché de productos.

## Scripts Disponibles

### 1. `update-product-price-sort.ts`

**Propósito:** Actualiza el campo `order_price` en la tabla `product` basándose en el precio máximo de las variantes de cada producto.

**Cuándo usar:**
- Después de agregar nuevos productos con variantes
- Después de modificar precios de variantes
- Para inicializar el campo `order_price` en productos existentes
- Como mantenimiento periódico para mantener la consistencia

**Uso:**
```bash
# Básico
pnpm products:update-price-sort

# Con logging detallado
DEBUG=true pnpm products:update-price-sort
```

**Qué hace:**
1. Obtiene todos los productos publicados
2. Para cada producto:
   - Obtiene todas sus variantes
   - Consulta los precios de cada variante desde la base de datos
   - Calcula el precio máximo entre todas las variantes
   - Actualiza el campo `order_price` en la tabla `product` con el precio máximo (redondeado a entero)
3. Muestra un resumen con estadísticas del proceso

**Notas:**
- Usa consultas SQL directas para mejor rendimiento
- Solo procesa productos con status `published`
- El precio se almacena en centavos/unidades mínimas (sin decimales)
- Si un producto no tiene variantes con precios, `order_price` se establece en `NULL`

**Tiempo estimado:** Depende del número de productos (aprox. 0.5-2 segundos por producto)

---

### 2. `warm-product-cache.ts`

**Propósito:** Pre-cachea (warm-up) todas las páginas de productos en Redis para mejorar el rendimiento del endpoint `/store/products`.

**Cuándo usar:**
- Después de limpiar la caché de productos
- Después de agregar/modificar muchos productos
- En el startup del servidor (opcional)
- Manualmente cuando necesites refrescar toda la caché

**Uso:**
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

**Qué hace:**
1. Obtiene el total de productos publicados
2. Calcula el número de páginas según el tamaño de página configurado
3. Para cada página:
   - Verifica si ya está cacheada (omite si existe)
   - Procesa los datos igual que el endpoint `/store/products`
   - Obtiene precios y calculated_price para todas las variantes
   - Cachea la respuesta completa en Redis con indexación
4. Muestra un resumen con estadísticas del proceso

**Notas:**
- Usa servicios de Medusa directamente (no hace HTTP requests)
- Omite páginas ya cacheadas para eficiencia
- Usa pipeline de Redis para mejor rendimiento
- El cacheo incluye indexación para invalidación selectiva
- Si todas las páginas ya están cacheadas, el proceso es muy rápido

**Tiempo estimado:** 
- Primera vez: ~2-5 segundos por página (depende del tamaño)
- Páginas ya cacheadas: ~10-50ms por página

**Ejemplo de salida:**
```
🔥 Iniciando warm-up de caché de productos...
📋 Configuración:
   - Tamaño de página: 25
   - Ordenamiento: order_price
   - Region ID: reg_01K3KW5KVB3KFS8D4HG28WTZKC

📦 Obteniendo total de productos...
✅ Total de productos: 395
📄 Total de páginas a cachear: 16

🚀 Iniciando warm-up de caché...
  ✅ Página 1/16 (offset: 0) - 25 productos cacheados [6%] (cache: 45ms)
  ⏭️  Página 2/16 (offset: 25) - Ya está cacheada, omitiendo... [12%] (check: 12ms)
  ...

📊 RESUMEN FINAL
✅ Páginas procesadas: 16/16
   - Nuevas: 8
   - Omitidas (ya cacheadas): 8
⏱️  Tiempo total: 45.23s
```

---

## Requisitos Previos

### Para `update-product-price-sort.ts`:
- Base de datos PostgreSQL accesible
- Tabla `product` con columna `order_price` (tipo `int4`)
- Productos con variantes y precios configurados

### Para `warm-product-cache.ts`:
- Base de datos PostgreSQL accesible
- Redis configurado y accesible (variable `REDIS_URL`)
- Caché de productos habilitada (`PRODUCT_CACHE_ENABLED` no es `false`)
- Campo `order_price` actualizado en productos (si se usa `order=order_price`)

## Configuración

### Variables de Entorno

**Caché de Productos:**
```env
# Habilitar/deshabilitar caché (default: true)
PRODUCT_CACHE_ENABLED=true

# TTL de caché en segundos (default: 86400 = 24 horas)
PRODUCT_CACHE_TTL_SECONDS=86400

# URL de Redis
REDIS_URL=redis://localhost:6379
```

**Warm-up Script:**
```env
# Tamaño de página para warm-up (default: 25)
PRODUCT_CACHE_WARM_PAGE_SIZE=25

# ID de región para precios calculados
PRODUCT_CACHE_WARM_REGION_ID=reg_xxx

# Ordenamiento (default: order_price)
PRODUCT_CACHE_WARM_ORDER=order_price
```

## Flujo de Trabajo Recomendado

### Inicialización (Primera vez)
1. Ejecutar `update-product-price-sort.ts` para inicializar `order_price`
2. Ejecutar `warm-product-cache.ts` para pre-cachear todas las páginas

### Mantenimiento Regular
1. Cuando se agregan/modifican productos:
   - Ejecutar `update-product-price-sort.ts` para actualizar `order_price`
   - La caché se invalida automáticamente vía subscribers
   - Opcional: Ejecutar `warm-product-cache.ts` para re-cachear todo

### Después de Limpiar Caché
1. Ejecutar `warm-product-cache.ts` para re-cachear todas las páginas

## Troubleshooting

### Error: "order_price column does not exist"
- Asegúrate de que la columna `order_price` existe en la tabla `product`
- Ejecuta la migración SQL para crear la columna

### Error: "Redis unavailable"
- Verifica que Redis esté corriendo
- Verifica la variable `REDIS_URL`
- El script continuará sin caché si Redis no está disponible

### Warm-up muy lento
- Reduce `PRODUCT_CACHE_WARM_PAGE_SIZE` para procesar menos productos por vez
- Verifica la latencia de Redis
- Considera ejecutar en horarios de bajo tráfico

### Caché no se actualiza
- Verifica que los subscribers de invalidación estén registrados
- Verifica que `PRODUCT_CACHE_ENABLED` esté en `true`
- Revisa los logs para errores de Redis

## Referencias

- [Plan de Caché de Productos](../docs/CACHE_PRODUCTS_PLAN.md)
- [Optimizaciones de Caché](../docs/CACHE_OPTIMIZATIONS.md)
- [Endpoint de Productos](../../api/store/products/route.ts)
