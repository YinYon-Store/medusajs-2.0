# Ejemplos de cURL para `/store/products` (Endpoint por defecto de Medusa)

## Endpoint Base

El endpoint por defecto de Medusa JS 2.0 es:
```
GET /store/products
```

## Parámetros Soportados

- `limit`: Número de productos por página
- `offset`: Offset para paginación
- `region_id`: ID de la región (para precios calculados)
- `fields`: Campos a incluir (formato Medusa)
- `order`: Ordenamiento (ej: `variants.prices.amount`, `-variants.prices.amount`, `created_at`, `-created_at`, `title`, `-title`)

---

## Ejemplos de cURL

### 1. Listado Básico con Precios

```bash
curl -X GET "http://localhost:9000/store/products?limit=12&offset=0&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC&fields=*variants.calculated_price,*variants.prices,*options,*options.values,*categories" \
  -H "x-publishable-api-key: TU_API_KEY" \
  -H "Content-Type: application/json"
```

### 2. Ordenar por Precio (Ascendente)

```bash
curl -X GET "http://localhost:9000/store/products?limit=12&offset=0&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC&order=variants.prices.amount&fields=*variants.calculated_price,*variants.prices,*categories" \
  -H "x-publishable-api-key: TU_API_KEY" \
  -H "Content-Type: application/json"
```

### 3. Ordenar por Precio (Descendente)

```bash
curl -X GET "http://localhost:9000/store/products?limit=12&offset=0&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC&order=-variants.prices.amount&fields=*variants.calculated_price,*variants.prices,*categories" \
  -H "x-publishable-api-key: TU_API_KEY" \
  -H "Content-Type: application/json"
```

### 4. Ordenar por Nombre (Ascendente)

```bash
curl -X GET "http://localhost:9000/store/products?limit=12&offset=0&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC&order=title&fields=*variants.calculated_price,*variants.prices,*categories" \
  -H "x-publishable-api-key: TU_API_KEY" \
  -H "Content-Type: application/json"
```

### 5. Ordenar por Fecha de Creación (Más Recientes Primero)

```bash
curl -X GET "http://localhost:9000/store/products?limit=12&offset=0&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC&order=-created_at&fields=*variants.calculated_price,*variants.prices,*categories" \
  -H "x-publishable-api-key: TU_API_KEY" \
  -H "Content-Type: application/json"
```

### 6. Con Búsqueda de Texto (si está disponible)

```bash
curl -X GET "http://localhost:9000/store/products?q=perfume&limit=12&offset=0&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC&order=-variants.prices.amount&fields=*variants.calculated_price,*variants.prices,*categories" \
  -H "x-publishable-api-key: TU_API_KEY" \
  -H "Content-Type: application/json"
```

### 7. Filtrar por Categoría

```bash
curl -X GET "http://localhost:9000/store/products?category_id=cat_01&limit=12&offset=0&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC&order=-variants.prices.amount&fields=*variants.calculated_price,*variants.prices,*categories" \
  -H "x-publishable-api-key: TU_API_KEY" \
  -H "Content-Type: application/json"
```

### 8. Filtrar por Colección

```bash
curl -X GET "http://localhost:9000/store/products?collection_id=pcol_01&limit=12&offset=0&region_id=reg_01K3KW5KVB3KFS8D4HG28WTZKC&order=-variants.prices.amount&fields=*variants.calculated_price,*variants.prices,*categories" \
  -H "x-publishable-api-key: TU_API_KEY" \
  -H "Content-Type: application/json"
```

---

## Notas sobre Ordenamiento por Precio

⚠️ **Importante**: El ordenamiento por `variants.prices.amount` puede no funcionar correctamente si:
- Los productos tienen múltiples variantes con precios diferentes
- Los precios están en diferentes regiones/monedas
- No hay precios calculados para la región especificada

**Recomendación**: Para un ordenamiento confiable por precio, es mejor usar `calculated_price` cuando esté disponible, o implementar un endpoint personalizado que calcule el precio mínimo/máximo por producto.

---

## Respuesta Esperada

```json
{
  "products": [
    {
      "id": "prod_01...",
      "title": "Product Name",
      "variants": [
        {
          "id": "variant_01...",
          "calculated_price": {
            "calculated_amount": 50000,
            "currency_code": "COP"
          },
          "prices": [...]
        }
      ],
      "categories": [...]
    }
  ],
  "count": 150,
  "offset": 0,
  "limit": 12
}
```

---

**Última actualización**: 2024-01-XX


