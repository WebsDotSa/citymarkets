import { query } from "@/lib/db";
import { cache, CACHE_TTL } from "@/lib/cache";

export type ProductSeoRow = {
  id: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  image_url: string | null;
  price: number;
  discount_price: number | null;
  category_name: string | null;
  category_slug: string | null;
  category_icon: string | null;
  is_active: boolean;
  /** Canonical SKU from `vendor_products.sku`. The unified view doesn't
   *  expose `barcode`; SEO consumers should treat this as the GTIN
   *  fallback (see product-json-ld.tsx). */
  sku: string | null;
  stock_qty: number;
};

// Cheap UUID v4/v1/v5 shape check. Lets us short-circuit before
// round-tripping to Postgres when a request lands on /products/<slug>
// or /products/preview — the DB would otherwise throw "invalid input
// syntax for type uuid" and pollute server.log with stack traces for
// every malformed share-link.
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getProductForSeo(
  id: string
): Promise<ProductSeoRow | null> {
  if (!UUID_LIKE.test(id)) return null;
  // Cache key uses singular `product:` prefix so it does NOT collide with
  // the existing plural `products:` prefix (used by /api/v1/products
  // list). Admin product mutations invalidate `product:seo:` separately
  // — see src/app/api/admin/products/route.ts.
  return cache.getOrSet(
    `product:seo:${id}`,
    async () => {
      // Slice 1: SEO row reads from `products_unified` so vendor listings
      // get product-detail metadata + JSON-LD with the same fields as the
      // legacy catalog. The view UNION'd both tables with `id` as the
      // shared primary key (migration 014 backfilled matching UUIDs).
      const result = await query(
        `SELECT p.id::text AS id, p.name_ar, p.name_en, p.description, p.image_url,
                p.price::float AS price, p.discount_price::float AS discount_price,
                p.is_active, p.sku, p.stock_qty,
                c.name_ar AS category_name, c.slug AS category_slug, c.icon_url AS category_icon
         FROM products_unified p
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.id = $1`,
        [id]
      );

      if (result.rows.length === 0) return null;
      return result.rows[0] as ProductSeoRow;
    },
    CACHE_TTL.MEDIUM,
  );
}

export type CategorySeoRow = {
  id: string;
  name_ar: string;
  slug: string;
  icon_url: string | null;
  description_ar: string | null;
  parent_slug: string | null;
  parent_name_ar: string | null;
};

export async function getCategoryForSeo(
  slug: string
): Promise<CategorySeoRow | null> {
  // Cache key uses `categories:seo:slug:` prefix so it is invalidated
  // by admin category mutations that call `cache.invalidatePattern("categories:")`
  // (see src/app/api/admin/categories/route.ts). TTL 5min matches the
  // `categories:all:v7` list cache.
  return cache.getOrSet(
    `categories:seo:slug:${slug}`,
    async () => {
      // Strict slug match. Matching by Arabic name caused canonical-URL
      // mismatches: visitors landed on /categories/<name> but the page canonical
      // pointed to the (different) slug — splitting ranking signals across two
      // URLs. Callers that want to resolve by Arabic name should call
      // getCategoryByNameAr and then redirect to the canonical slug.
      const result = await query(
        `WITH RECURSIVE visible AS (
           SELECT c.id
           FROM categories c
           WHERE c.parent_id IS NULL AND c.is_active = TRUE
           UNION ALL
           SELECT ch.id
           FROM categories ch
           JOIN visible v ON ch.parent_id = v.id
           WHERE ch.is_active = TRUE
         )
         SELECT c.id::text AS id, c.name_ar, c.slug, c.icon_url, c.description_ar,
                p.slug AS parent_slug, p.name_ar AS parent_name_ar
         FROM categories c
         JOIN visible v ON v.id = c.id
         LEFT JOIN categories p ON c.parent_id = p.id
         WHERE c.slug = $1
         LIMIT 1`,
        [slug]
      );
      if (result.rows.length === 0) return null;
      return result.rows[0] as CategorySeoRow;
    },
    CACHE_TTL.MEDIUM,
  );
}

export async function getCategoryByNameAr(
  nameAr: string
): Promise<CategorySeoRow | null> {
  // Same `categories:` namespace — admin category mutations invalidate both.
  return cache.getOrSet(
    `categories:seo:name_ar:${nameAr}`,
    async () => {
      const result = await query(
        `WITH RECURSIVE visible AS (
           SELECT c.id
           FROM categories c
           WHERE c.parent_id IS NULL AND c.is_active = TRUE
           UNION ALL
           SELECT ch.id
           FROM categories ch
           JOIN visible v ON ch.parent_id = v.id
           WHERE ch.is_active = TRUE
         )
         SELECT c.id::text AS id, c.name_ar, c.slug, c.icon_url, c.description_ar,
                p.slug AS parent_slug, p.name_ar AS parent_name_ar
         FROM categories c
         JOIN visible v ON v.id = c.id
         LEFT JOIN categories p ON c.parent_id = p.id
         WHERE c.name_ar = $1
         LIMIT 1`,
        [nameAr]
      );
      if (result.rows.length === 0) return null;
      return result.rows[0] as CategorySeoRow;
    },
    CACHE_TTL.MEDIUM,
  );
}

export function productDescription(row: ProductSeoRow): string {
  const price =
    row.discount_price != null && row.discount_price < row.price
      ? row.discount_price
      : row.price;
  const parts = [
    row.description?.trim(),
    row.category_name ? `قسم ${row.category_name}.` : null,
    `السعر ${price.toFixed(2)} ر.س — تسوق وتوصيل من أسواق سيتي.`,
  ].filter(Boolean);
  return parts.join(" ").slice(0, 160);
}

export function productAltText(row: ProductSeoRow): string {
  const price =
    row.discount_price != null && row.discount_price < row.price
      ? row.discount_price
      : row.price;
  return `${row.name_ar}${row.category_name ? ` - ${row.category_name}` : ""} - ${price.toFixed(2)} ر.س`;
}
