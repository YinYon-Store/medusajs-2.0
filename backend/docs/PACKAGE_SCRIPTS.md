# Scripts de Package.json - Referencia Rápida

Este documento explica todos los scripts disponibles en `package.json` para referencia rápida.

## 🚀 Scripts de Desarrollo

### `dev`
```bash
pnpm dev
```
Inicia el servidor de desarrollo de Medusa con hot-reload.

---

### `build`
```bash
pnpm build
```
Compila el proyecto y ejecuta el script post-build.

---

### `start`
```bash
pnpm start
```
Inicializa el backend y inicia el servidor en modo producción.

---

### `start:server`
```bash
pnpm start:server
```
Inicia solo el servidor (sin inicializar backend).

---

### `start:worker`
```bash
pnpm start:worker
```
Inicia solo el worker (procesamiento de jobs en background).

---

## 📦 Scripts de Productos

### `products:update-price-sort`
```bash
pnpm products:update-price-sort
```
**Propósito:** Actualiza el campo `order_price` en la tabla `product` basándose en el precio máximo de las variantes.

**Cuándo usar:**
- Después de agregar/modificar productos con variantes
- Para inicializar `order_price` en productos existentes
- Mantenimiento periódico

**Archivo:** `src/scripts/products/update-product-price-sort.ts`

---

### `products:warm-cache`
```bash
pnpm products:warm-cache
```
**Propósito:** Pre-cachea todas las páginas de productos en Redis para mejorar el rendimiento.

**Cuándo usar:**
- Después de limpiar la caché
- Después de agregar/modificar muchos productos
- En startup del servidor (opcional)

**Variables de entorno:**
- `PRODUCT_CACHE_WARM_PAGE_SIZE=25` (tamaño de página)
- `PRODUCT_CACHE_WARM_REGION_ID=reg_xxx` (ID de región)
- `PRODUCT_CACHE_WARM_ORDER=order_price` (ordenamiento)

**Archivo:** `src/scripts/products/warm-product-cache.ts`

---

## 🔍 Scripts de Búsqueda (Meilisearch)

### `meilisearch:init`
```bash
pnpm meilisearch:init
```
Inicializa Meilisearch con la configuración necesaria.

---

### `meilisearch:reindex`
```bash
pnpm meilisearch:reindex
```
Re-indexa todos los productos en Meilisearch.

---

## 📧 Scripts de Email

### `email:dev`
```bash
pnpm email:dev
```
Inicia el servidor de desarrollo para templates de email en el puerto 3002.

---

## 🌱 Scripts de Datos

### `seed`
```bash
pnpm seed
```
Ejecuta el script de seed para poblar la base de datos con datos iniciales.

---

## 📚 Documentación Completa

Para más detalles sobre los scripts de productos, ver:
- [Documentación de Scripts de Productos](./SCRIPTS_PRODUCTS.md)
- [README de Scripts de Productos](../src/scripts/products/README.md)
