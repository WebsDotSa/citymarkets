-- Set each category icon_url to one product image from the same category
-- (prefers active products, then most recently updated)

UPDATE categories c
SET icon_url = sub.image_url
FROM (
  SELECT DISTINCT ON (p.category_id)
    p.category_id,
    p.image_url
  FROM products p
  WHERE p.image_url IS NOT NULL
    AND TRIM(p.image_url) <> ''
  ORDER BY
    p.category_id,
    p.is_active DESC,
    p.updated_at DESC NULLS LAST,
    p.id
) sub
WHERE c.id = sub.category_id
  AND (
    c.icon_url IS NULL
    OR TRIM(c.icon_url) = ''
    OR (
      c.icon_url NOT LIKE '/images/%'
      AND c.icon_url NOT LIKE 'http://%'
      AND c.icon_url NOT LIKE 'https://%'
    )
  );
