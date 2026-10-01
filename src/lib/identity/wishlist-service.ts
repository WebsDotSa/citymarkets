/**
 * Wishlist service — server-backed persistence for the customer
 * wishlist (P2-4).
 *
 * Why this exists:
 *   The wishlist was previously localStorage-only (P2-4). Problems:
 *     - Refresh from another device loses the list
 *     - Switching browsers (mobile → desktop) loses the list
 *     - Cart-recovery flow can't surface wishlist items
 *     - Cross-user isolation requires key namespacing on every read
 *       (D4 fix added namespacing; P2-4 removes the storage layer
 *       entirely for signed-in users)
 *     - Capacity caps are per-browser, not per-user
 *
 * Design:
 *   - wishlist_items: per-user rows of (user_id, product_id, added_at)
 *     — see migration 076. UNIQUE (user_id, product_id) so duplicate
 *     adds short-circuit at the DB layer.
 *   - The service returns hydrated product data (joined against
 *     `products_unified`) so the route handler doesn't have to make
 *     a second round-trip to render the wishlist page.
 *   - Wishlist does NOT track quantity or variant — each product is
 *     either in the wishlist or not. Quantity changes happen at the
 *     cart layer.
 *
 * Out of scope (intentional):
 *   - The browser-side localStorage layer stays as a fast cache for
 *     guest browsing. When a user signs in, the server is the
 *     source of truth; the localStorage bucket for that user gets
 *     repopulated from the server response.
 *   - HTTP-level concerns (auth, response shape, status codes) stay
 *     in routes — the service returns plain rows.
 *   - Product hydration fields are limited to what the wishlist UI
 *     needs (name/price/image/vendor). The product detail page
 *     does its own query.
 */

import { query } from "@/lib/db";
import { MAX_WISHLIST_SIZE } from "./wishlist-constants";

export { MAX_WISHLIST_SIZE };

export interface WishlistProduct {
  id: string;
  name: string;
  name_ar: string | null;
  slug: string;
  price: number;
  discount_price: number | null;
  image_url: string | null;
  vendor_id: string;
  vendor_name: string | null;
  vendor_slug: string | null;
  is_active: boolean;
  stock_qty: number | null;
}

export interface WishlistItem {
  product_id: string;
  added_at: string;
  product: WishlistProduct;
}

export interface WishlistAddResult {
  ok: boolean;
  reason?: "already_present" | "full";
  item?: WishlistItem;
}

const WISHLIST_PRODUCT_FIELDS = `
  p.id, COALESCE(p.name_ar, p.name_en) AS name, p.name_ar, p.slug,
  p.price::float8 AS price,
  p.discount_price::float8 AS discount_price,
  p.image_url,
  p.vendor_id,
  v.name_ar AS vendor_name,
  v.slug AS vendor_slug,
  COALESCE(p.is_active, true) AS is_active,
  p.stock_qty::float8 AS stock_qty
`;

const WISHLIST_JOIN = `
  FROM wishlist_items w
  JOIN products_unified p ON p.id = w.product_id
  LEFT JOIN vendors v ON v.id = p.vendor_id
`;

/**
 * List the user's wishlist with hydrated product data. Newest
 * additions first (matches the order used by the previous
 * localStorage implementation).
 *
 * Soft-deleted / inactive products still surface so the user can
 * remove them; the client UI hides them via `is_active`.
 */
export async function listWishlist(userId: string): Promise<WishlistItem[]> {
  const result = await query<{
    product_id: string;
    added_at: string;
    id: string;
    name: string;
    name_ar: string | null;
    slug: string;
    price: number;
    discount_price: number | null;
    image_url: string | null;
    vendor_id: string;
    vendor_name: string | null;
    vendor_slug: string | null;
    is_active: boolean;
    stock_qty: number | null;
  }>(
    `SELECT w.product_id, w.added_at, ${WISHLIST_PRODUCT_FIELDS}
     ${WISHLIST_JOIN}
    WHERE w.user_id = $1::uuid
    ORDER BY w.added_at DESC`,
    [userId],
  );

  return result.rows.map((r) => ({
    product_id: r.product_id,
    added_at: String(r.added_at),
    product: {
      id: r.id,
      name: r.name,
      name_ar: r.name_ar,
      slug: r.slug,
      price: Number(r.price),
      discount_price: r.discount_price != null ? Number(r.discount_price) : null,
      image_url: r.image_url,
      vendor_id: r.vendor_id,
      vendor_name: r.vendor_name,
      vendor_slug: r.vendor_slug,
      is_active: r.is_active,
      stock_qty: r.stock_qty != null ? Number(r.stock_qty) : null,
    },
  }));
}

/**
 * Add a product to the user's wishlist.
 *
 * Returns `{ ok: false, reason: "already_present" }` if the product
 * is already in the list (UNIQUE constraint, short-circuited before
 * the INSERT to avoid a wasted round-trip).
 *
 * Returns `{ ok: false, reason: "full" }` if the user has hit the
 * MAX_WISHLIST_SIZE cap. The cap is enforced server-side too
 * because the client is not trusted.
 *
 * Returns `{ ok: true, item }` on success.
 */
export async function addToWishlist(
  userId: string,
  productId: string,
): Promise<WishlistAddResult> {
  // Fast path: dedupe before the count query.
  const exists = await query<{ product_id: string }>(
    `SELECT product_id FROM wishlist_items
      WHERE user_id = $1::uuid AND product_id = $2::uuid
      LIMIT 1`,
    [userId, productId],
  );
  if (exists.rows.length > 0) {
    return { ok: false, reason: "already_present" };
  }

  // Cap check.
  const countResult = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM wishlist_items WHERE user_id = $1::uuid`,
    [userId],
  );
  if ((countResult.rows[0]?.c ?? 0) >= MAX_WISHLIST_SIZE) {
    return { ok: false, reason: "full" };
  }

  // INSERT. ON CONFLICT DO NOTHING handles a concurrent add (two
  // browser tabs racing) — both will return ok:true once the row is
  // committed by either tab.
  const insertResult = await query<{
    product_id: string;
    added_at: string;
    id: string;
    name: string;
    name_ar: string | null;
    slug: string;
    price: number;
    discount_price: number | null;
    image_url: string | null;
    vendor_id: string;
    vendor_name: string | null;
    vendor_slug: string | null;
    is_active: boolean;
    stock_qty: number | null;
  }>(
    `WITH inserted AS (
       INSERT INTO wishlist_items (user_id, product_id)
       VALUES ($1::uuid, $2::uuid)
       ON CONFLICT (user_id, product_id) DO NOTHING
       RETURNING product_id, added_at
     )
     SELECT i.product_id, i.added_at, ${WISHLIST_PRODUCT_FIELDS}
     FROM inserted i
     ${WISHLIST_JOIN}`,
    [userId, productId],
  );

  const row = insertResult.rows[0];
  if (!row) {
    // The ON CONFLICT branch hit — a concurrent tab already inserted.
    return { ok: false, reason: "already_present" };
  }

  return {
    ok: true,
    item: {
      product_id: row.product_id,
      added_at: String(row.added_at),
      product: {
        id: row.id,
        name: row.name,
        name_ar: row.name_ar,
        slug: row.slug,
        price: Number(row.price),
        discount_price: row.discount_price != null ? Number(row.discount_price) : null,
        image_url: row.image_url,
        vendor_id: row.vendor_id,
        vendor_name: row.vendor_name,
        vendor_slug: row.vendor_slug,
        is_active: row.is_active,
        stock_qty: row.stock_qty != null ? Number(row.stock_qty) : null,
      },
    },
  };
}

/**
 * Remove a product from the user's wishlist. Returns the number of
 * rows deleted (0 = not present, 1 = removed). The productId is
 * scoped to the user's own rows so a caller can't remove another
 * user's wishlist entry by passing the id.
 */
export async function removeFromWishlist(
  userId: string,
  productId: string,
): Promise<number> {
  const result = await query(
    `DELETE FROM wishlist_items
      WHERE user_id = $1::uuid AND product_id = $2::uuid`,
    [userId, productId],
  );
  return result.rowCount ?? 0;
}

/**
 * Check whether a product is in the user's wishlist. Used by the
 * product-detail page to flip the heart icon.
 */
export async function isInWishlist(
  userId: string,
  productId: string,
): Promise<boolean> {
  const result = await query<{ product_id: string }>(
    `SELECT product_id FROM wishlist_items
      WHERE user_id = $1::uuid AND product_id = $2::uuid
      LIMIT 1`,
    [userId, productId],
  );
  return result.rows.length > 0;
}

/**
 * Clear the user's entire wishlist. Used by the "Clear all" button
 * on the wishlist page.
 */
export async function clearWishlist(userId: string): Promise<number> {
  const result = await query(
    `DELETE FROM wishlist_items WHERE user_id = $1::uuid`,
    [userId],
  );
  return result.rowCount ?? 0;
}

/**
 * Fetch a batch of "is in wishlist" flags in a single query —
 * powers the product card heart icons on the catalog page.
 *
 * Returns a Set of product ids that are in the user's wishlist.
 */
export async function getWishlistMembership(
  userId: string,
  productIds: string[],
): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const result = await query<{ product_id: string }>(
    `SELECT product_id FROM wishlist_items
      WHERE user_id = $1::uuid
        AND product_id = ANY($2::uuid[])`,
    [userId, productIds],
  );
  return new Set(result.rows.map((r) => r.product_id));
}
