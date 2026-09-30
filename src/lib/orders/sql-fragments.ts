/**
 * Reusable SQL fragments for `orders` SELECT queries.
 *
 * Why this module exists:
 *   The previous codebase repeated the same financial + guest + address
 *   + user SELECT fragment across at least four endpoints:
 *     - `src/app/api/admin/orders/route.ts`           (single + list)
 *     - `src/app/api/v1/orders/[id]/route.ts`         (customer detail)
 *     - `src/app/api/v1/orders/[id]/invoice-pdf/route.ts`
 *   Each copy drifted slightly (one added `o.tax::float`, another
 *   dropped `o.updated_at`, another aliased `user_id::text`).
 *   Centralising the column lists here makes adding a new field
 *   to the order detail a one-place edit instead of four.
 *
 * Why fragments and not one big constant:
 *   Each caller needs a different JOIN set (some need `direct_order_meta`,
 *   some don't) and different columns (`invoice-pdf` is minimal, customer
 *   detail needs `scheduled`/`slot_window`, admin needs `internal_notes`).
 *   SQL template-literal composition keeps each query readable while
 *   the shared parts stay single-sourced.
 *
 * Why this lives in `lib/orders` and not `lib/db`:
 *   The fragments reference order-specific columns (subtotal, payment_status,
 *   scheduled) so they belong with the orders bounded context. Putting
 *   them in `lib/db` would couple that generic module to a single domain.
 *
 * Server-only — DO NOT import from a client component. The strings are
 * safe (no user data) but the import would pull in `node:fs`-style
 * transitive deps that break Next.js client bundles.
 *
 * Convention:
 *   Each fragment is a SQL string that DOES NOT start or end with a
 *   comma. Callers concatenate with their own leading comma. See the
 *   example at the bottom.
 */

// ── Column fragments ─────────────────────────────────────────────────────

/**
 * Universal financial + guest columns used by every order-detail +
 * orders-list query. Numeric columns get `::float` so pg returns them
 * as JS numbers instead of strings.
 */
export const ORDER_BASE_COLUMNS = `
  o.id, o.status, o.payment_status, o.payment_method, o.payment_reference,
  o.subtotal::float as subtotal,
  o.delivery_fee::float as delivery_fee,
  o.service_fee::float as service_fee,
  o.tax::float as tax,
  o.discount::float as discount,
  o.total::float as total,
  o.guest_name, o.guest_phone,
  o.guest_city, o.guest_district, o.guest_street, o.guest_building,
  o.notes, o.internal_notes,
  o.scheduled, o.scheduled_for, o.slot_window,
  o.created_at, o.updated_at
`;

/**
 * Slim variant for the admin orders list. Same as `ORDER_BASE_COLUMNS`
 * minus `internal_notes`, `guest_building`, `payment_reference` — the
 * list view never shows those. Scheduled fields are kept so the
 * operator can see at-a-glance whether a row is a scheduled delivery
 * and which window it belongs to.
 */
export const ORDER_LIST_COLUMNS = `
  o.id, o.status, o.payment_status, o.payment_method, o.payment_reference,
  o.subtotal::float as subtotal,
  o.delivery_fee::float as delivery_fee,
  o.service_fee::float as service_fee,
  o.discount::float as discount,
  o.total::float as total,
  o.guest_name, o.guest_phone,
  o.notes,
  o.scheduled, o.scheduled_for, o.slot_window,
  o.created_at, o.updated_at
`;

/** Address-table columns. Always joined via `LEFT JOIN addresses a`. */
export const ORDER_ADDRESS_COLUMNS = `
  a.label as address_label, a.address_text,
  a.lat as address_lat, a.lng as address_lng,
  a.description as address_description,
  COALESCE(a.place_images, '{}') as address_place_images
`;

/** Minimal address columns for invoice rendering. */
export const ORDER_ADDRESS_COLUMNS_MINIMAL = `
  a.label as address_label, a.address_text
`;

/** User-table columns. Always joined via `LEFT JOIN users u`. */
export const ORDER_USER_COLUMNS = `
  u.name as user_name, u.phone as user_phone
`;

// ── JOIN clauses ────────────────────────────────────────────────────────

/**
 * Standard JOIN set for any order-detail query that needs both
 * address and user data. Use after `SELECT ... ${ORDER_BASE_COLUMNS}`.
 */
export const ORDER_DETAIL_JOINS = `
  FROM orders o
  LEFT JOIN addresses a ON o.address_id = a.id
  LEFT JOIN users u    ON o.user_id    = u.id
`;

/**
 * JOIN set for the customer-facing detail route which also pulls
 * direct_order_meta (manual-order metadata: lat/lng/plus_code/edited_at).
 */
export const ORDER_DETAIL_JOINS_WITH_META = `
  FROM orders o
  LEFT JOIN addresses a       ON o.address_id = a.id
  LEFT JOIN direct_order_meta m ON m.order_id = o.id
  LEFT JOIN users u          ON o.user_id    = u.id
`;

/**
 * JOIN set for the admin orders list query. The caller still needs to
 * append `WHERE` + `ORDER BY` + `LIMIT` clauses.
 */
export const ORDER_LIST_JOINS = ORDER_DETAIL_JOINS;

// ── Example ─────────────────────────────────────────────────────────────
//
//   import { ORDER_BASE_COLUMNS, ORDER_ADDRESS_COLUMNS,
//            ORDER_USER_COLUMNS, ORDER_DETAIL_JOINS } from "@/lib/orders/sql-fragments";
//
//   const result = await query(
//     `SELECT ${ORDER_BASE_COLUMNS},
//             ${ORDER_ADDRESS_COLUMNS},
//             ${ORDER_USER_COLUMNS}
//      ${ORDER_DETAIL_JOINS}
//      WHERE o.id = $1 LIMIT 1`,
//     [orderId],
//   );
