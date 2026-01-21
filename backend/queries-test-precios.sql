-- ============================================================================
-- QUERIES PARA PROBAR PRECIOS Y PRODUCTOS EN POSTGRESQL
-- ============================================================================

-- Query 1: Obtener todos los productos con sus variantes y precios
-- Muestra: producto_id, producto_title, variant_id, price_set_id, amount, currency_code
SELECT 
  p.id AS producto_id,
  p.title AS producto_title,
  pv.id AS variant_id,
  pvps.price_set_id,
  pr.amount,
  pr.currency_code
FROM product p
INNER JOIN product_variant pv ON pv.product_id = p.id
INNER JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
INNER JOIN price pr ON pr.price_set_id = pvps.price_set_id
WHERE p.deleted_at IS NULL
  AND pv.deleted_at IS NULL
  AND pvps.deleted_at IS NULL
  AND pr.deleted_at IS NULL
ORDER BY p.id, pr.amount DESC
LIMIT 50;

-- Query 2: Obtener el precio MÁXIMO por producto
-- Muestra: producto_id, producto_title, precio_maximo, currency_code, cantidad_variantes
SELECT 
  p.id AS producto_id,
  p.title AS producto_title,
  MAX(pr.amount) AS precio_maximo,
  pr.currency_code,
  COUNT(DISTINCT pv.id) AS cantidad_variantes
FROM product p
INNER JOIN product_variant pv ON pv.product_id = p.id
INNER JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
INNER JOIN price pr ON pr.price_set_id = pvps.price_set_id
WHERE p.deleted_at IS NULL
  AND pv.deleted_at IS NULL
  AND pvps.deleted_at IS NULL
  AND pr.deleted_at IS NULL
GROUP BY p.id, p.title, pr.currency_code
ORDER BY precio_maximo DESC
LIMIT 50;

-- Query 3: Obtener productos SIN precios (para diagnosticar)
-- Muestra productos que tienen variantes pero no tienen precios asociados
SELECT 
  p.id AS producto_id,
  p.title AS producto_title,
  COUNT(pv.id) AS cantidad_variantes,
  COUNT(pvps.price_set_id) AS variantes_con_price_set,
  COUNT(pr.id) AS variantes_con_precio
FROM product p
LEFT JOIN product_variant pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id AND pvps.deleted_at IS NULL
LEFT JOIN price pr ON pr.price_set_id = pvps.price_set_id AND pr.deleted_at IS NULL
WHERE p.deleted_at IS NULL
GROUP BY p.id, p.title
HAVING COUNT(pv.id) > 0 AND COUNT(pr.id) = 0
ORDER BY cantidad_variantes DESC
LIMIT 50;

-- Query 4: Obtener precio máximo por producto (versión completa con todos los detalles)
-- Similar al Query 2 pero con más información
SELECT 
  p.id AS producto_id,
  p.title AS producto_title,
  MAX(pr.amount) AS precio_maximo,
  pr.currency_code,
  COUNT(DISTINCT pv.id) AS cantidad_variantes,
  STRING_AGG(DISTINCT pv.id::text, ', ') AS variant_ids,
  STRING_AGG(DISTINCT pr.id::text, ', ') AS price_ids
FROM product p
INNER JOIN product_variant pv ON pv.product_id = p.id
INNER JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
INNER JOIN price pr ON pr.price_set_id = pvps.price_set_id
WHERE p.deleted_at IS NULL
  AND pv.deleted_at IS NULL
  AND pvps.deleted_at IS NULL
  AND pr.deleted_at IS NULL
GROUP BY p.id, p.title, pr.currency_code
ORDER BY precio_maximo DESC
LIMIT 50;

-- Query 5: Verificar estructura de product_variant_price_set
-- Para ver cómo están relacionados variant_id con price_set_id
SELECT 
  pvps.variant_id,
  pv.title AS variant_title,
  pvps.price_set_id,
  COUNT(pr.id) AS cantidad_precios,
  MAX(pr.amount) AS precio_maximo,
  pr.currency_code
FROM product_variant_price_set pvps
INNER JOIN product_variant pv ON pv.id = pvps.variant_id
LEFT JOIN price pr ON pr.price_set_id = pvps.price_set_id AND pr.deleted_at IS NULL
WHERE pvps.deleted_at IS NULL
  AND pv.deleted_at IS NULL
GROUP BY pvps.variant_id, pv.title, pvps.price_set_id, pr.currency_code
ORDER BY pvps.variant_id
LIMIT 50;

-- Query 6: Obtener un producto específico con todos sus precios
-- Reemplaza 'prod_01K8022M7S5G3NSQC5S12QB148' con el ID del producto que quieras probar
SELECT 
  p.id AS producto_id,
  p.title AS producto_title,
  pv.id AS variant_id,
  pv.title AS variant_title,
  pvps.price_set_id,
  pr.id AS price_id,
  pr.amount,
  pr.currency_code,
  pr.price_list_id
FROM product p
INNER JOIN product_variant pv ON pv.product_id = p.id
INNER JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id
INNER JOIN price pr ON pr.price_set_id = pvps.price_set_id
WHERE p.id = 'prod_01K8022M7S5G3NSQC5S12QB148'  -- Cambia este ID
  AND p.deleted_at IS NULL
  AND pv.deleted_at IS NULL
  AND pvps.deleted_at IS NULL
  AND pr.deleted_at IS NULL
ORDER BY pr.amount DESC;
