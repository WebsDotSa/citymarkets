import { query } from "@/lib/db";
import { tokenizeProductQuery } from "./voice-order";
import type { Product } from "@/lib/types";

export function mapProductRow(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    category_id: String(row.category_id),
    name_ar: String(row.name_ar),
    name_en: row.name_en ? String(row.name_en) : null,
    barcode: row.barcode ? String(row.barcode) : null,
    description: row.description ? String(row.description) : null,
    image_url: row.image_url ? String(row.image_url) : null,
    images: (row.images as string[]) || [],
    price: parseFloat(String(row.price)) || 0,
    discount_price: row.discount_price
      ? parseFloat(String(row.discount_price))
      : null,
    stock_qty: parseInt(String(row.stock_qty), 10) || 0,
    unit: String(row.unit || "piece"),
    is_featured: Boolean(row.is_featured),
    is_active: Boolean(row.is_active),
    category_name: row.category_name ? String(row.category_name) : undefined,
    category_slug: row.category_slug ? String(row.category_slug) : undefined,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function findProductForQuery(searchQuery: string) {
  const trimmed = searchQuery.trim();
  if (!trimmed) return null;

  const full = await query(
    // Slice 1: search the unified view (vendor_products + legacy
    // products) so voice/AI search surfaces third-party vendor listings
    // alongside the City Markets catalog.
    `SELECT p.id, p.category_id, p.name_ar, p.name_en, p.barcode, p.description,
            p.image_url, p.images,
            p.price::float as price, p.discount_price::float as discount_price,
            p.stock_qty, p.unit, p.is_featured, p.is_active,
            p.vendor_id, p.vendor_slug, p.vendor_name,
            p.created_at, p.updated_at,
            c.name_ar as category_name, c.slug as category_slug
     FROM products_unified p
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.is_active = true AND LOWER(p.name_ar) LIKE LOWER($1)
     ORDER BY LENGTH(p.name_ar) ASC
     LIMIT 1`,
    [`%${trimmed}%`]
  );
  if (full.rows[0]) return full.rows[0];

  const tokens = tokenizeProductQuery(trimmed);
  if (tokens.length === 0) return null;

  const conditions = tokens.map((_, i) => `LOWER(p.name_ar) LIKE LOWER($${i + 1})`);
  const params = tokens.map((t) => `%${t}%`);

  const tokenMatch = await query(
    `SELECT p.id, p.category_id, p.name_ar, p.name_en, p.barcode, p.description,
            p.image_url, p.images,
            p.price::float as price, p.discount_price::float as discount_price,
            p.stock_qty, p.unit, p.is_featured, p.is_active,
            p.vendor_id, p.vendor_slug, p.vendor_name,
            p.created_at, p.updated_at,
            c.name_ar as category_name, c.slug as category_slug
     FROM products_unified p
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.is_active = true AND ${conditions.join(" AND ")}
     ORDER BY LENGTH(p.name_ar) ASC
     LIMIT 1`,
    params
  );

  if (tokenMatch.rows[0]) return tokenMatch.rows[0];

  if (tokens.length > 1) {
    const bestToken = [...tokens].sort((a, b) => b.length - a.length)[0];
    const single = await query(
      `SELECT p.id, p.category_id, p.name_ar, p.name_en, p.barcode, p.description,
              p.image_url, p.images,
              p.price::float as price, p.discount_price::float as discount_price,
              p.stock_qty, p.unit, p.is_featured, p.is_active,
              p.vendor_id, p.vendor_slug, p.vendor_name,
              p.created_at, p.updated_at,
              c.name_ar as category_name, c.slug as category_slug
       FROM products_unified p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.is_active = true AND LOWER(p.name_ar) LIKE LOWER($1)
       ORDER BY LENGTH(p.name_ar) ASC
       LIMIT 1`,
      [`%${bestToken}%`]
    );
    return single.rows[0] ?? null;
  }

  return null;
}

export type MatchedProduct = {
  product: Product;
  quantity: number;
  query: string;
};

export async function matchProductsFromList(
  items: { search_query: string; quantity: number }[]
): Promise<{ matched: MatchedProduct[]; unmatched: string[] }> {
  const matched: MatchedProduct[] = [];
  const unmatched: string[] = [];

  for (const item of items) {
    const q = item.search_query.trim();
    if (!q) continue;
    const qty = Math.max(1, Math.min(99, Math.round(item.quantity) || 1));
    const row = await findProductForQuery(q);
    if (row) {
      matched.push({
        product: mapProductRow(row as Record<string, unknown>),
        quantity: qty,
        query: q,
      });
    } else {
      unmatched.push(q);
    }
  }

  return { matched, unmatched };
}
