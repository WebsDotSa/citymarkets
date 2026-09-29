/**
 * Checkout gate: reject the order when ANY third-party vendor in the
 * cart is currently closed (per its `vendors.open_time` /
 * `vendors.close_time` / `vendors.is_active`).
 *
 * Scope:
 *   - This gate only applies to vendor-groups (real vendor rows in the
 *     `vendors` table). Catalog items belong to `CITY_MARKETS_VENDOR_ID`
 *     — a virtual id with no `vendors` row — and are gated by the
 *     platform-wide working-hours check in
 *     `src/app/api/v1/checkout/route.ts:110`. Running them through the
 *     same per-vendor gate would double-gate catalog orders.
 *   - Pickup orders (`deliveryMode === "pickup"`) still need the gate
 *     because the vendor's kitchen may be closed even when the
 *     storefront can hand over a parcel.
 *
 * The blocked vendor objects returned here are exposed to the client
 * so the checkout UI can render a typed list ("السوق الفلاني مغلق")
 * instead of a generic 409.
 */

import type { PoolClient } from "pg";
import { queryMany, type Queryable } from "@/lib/db/typed";
import { isVendorOpen, type VendorHours } from "./vendor-store-hours";

export type ClosedVendor = {
  id: string;
  name: string;
  slug: string | null;
};

export type ClosedVendorGate = {
  closed: ClosedVendor[];
  message: string;
};

export type CheckClosedVendorsArgs = {
  /**
   * Either a `pg.PoolClient` (so the gate can ride the same connection
   * the caller uses for the checkout transaction) or a generic
   * `Queryable` (e.g. the bare `query` helper). Accepting both keeps
   * the route free to choose where to slot the gate.
   */
  client: PoolClient | Queryable;
  /** Vendor-group ids extracted from the parsed checkout body. May be
   *  empty for catalog-only carts (no gate needed). */
  vendorIds: string[];
  /** `now` is injectable for tests; defaults to server wall clock. */
  now?: Date;
};

export async function checkClosedVendorsInCart(
  args: CheckClosedVendorsArgs,
): Promise<ClosedVendorGate> {
  const { client, vendorIds, now = new Date() } = args;

  // No third-party vendors in the cart → nothing to gate. The catalog
  // (CITY_MARKETS_VENDOR_ID) is checked by the platform-wide hours
  // gate upstream; see module docstring.
  if (vendorIds.length === 0) {
    return { closed: [], message: "" };
  }

  // De-dup before the SELECT — duplicate vendor ids in the request
  // would otherwise produce duplicate "closed" entries in the response.
  const uniqueIds = Array.from(new Set(vendorIds));

  const rows = await queryMany<VendorHours>(
    client,
    `SELECT id, name_ar AS name, slug, open_time, close_time, is_active
       FROM vendors
      WHERE id = ANY($1::uuid[])`,
    [uniqueIds],
  );

  const closed: ClosedVendor[] = [];
  for (const row of rows) {
    if (!isVendorOpen(row, now)) {
      closed.push({
        id: row.id,
        name: row.name ?? "المتجر",
        slug: row.slug ?? null,
      });
    }
  }

  if (closed.length === 0) {
    return { closed: [], message: "" };
  }

  const names = closed.map((v) => v.name).join("، ");
  return {
    closed,
    message:
      closed.length === 1
        ? `المتجر "${names}" مغلق حالياً — احذف منتجاته من السلة لإتمام الطلب`
        : `بعض المتاجر مغلقة حالياً (${names}) — احذف منتجاتها من السلة لإتمام الطلب`,
  };
}
