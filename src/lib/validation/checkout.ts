/**
 * Slice 3 — multi-vendor unified checkout validation.
 *
 * The unified checkout endpoint accepts ONE body that splits into:
 *   - 0..N catalog items (City Markets pseudo-vendor)
 *   - 0..N vendor groups, each with 1..M items from a single vendor
 *
 * Validation rules (defense in depth — server-side only):
 *   - all UUIDs are real UUIDs
 *   - quantity is 1..99
 *   - product ids are unique WITHIN a group (same product twice in one
 *     group is a merge bug, not a feature)
 *   - vendor ids are unique ACROSS groups (one group per vendor)
 *   - vendor_groups must NOT contain the City Markets pseudo-vendor
 *     (catalog items belong in `items`, not in a vendor group)
 *   - idempotency_key is 8..64 chars so it's a usable client-generated
 *     UUID but still bounded for the DB column
 *   - payment_method is the same enum as the legacy catalog endpoint
 *   - delivery mode is delivery|pickup
 *   - coupon_code sane (matches `couponCodeSchema`)
 *   - points_redeemed bounded
 *   - either address_id OR guest coords OR pickup (pickup allows no
 *     address) — guest fallback matches the legacy catalog route
 */

import { z } from "zod";
import { CITY_MARKETS_VENDOR_ID } from "../types";
import {
  couponCodeSchema,
  paymentMethodSchema,
  phoneSchema,
  uuidSchema,
} from "./schemas";

const vendorUuidSchema = uuidSchema.refine(
  (v) => v !== CITY_MARKETS_VENDOR_ID,
  "معرّف البائع غير صالح",
);

/**
 * One catalog (City Markets) item. Vendor is implicit (the catalog).
 */
export const checkoutCatalogItemSchema = z.object({
  product_id: uuidSchema,
  quantity: z.number().int().min(1).max(99),
});

/**
 * One item inside a vendor group. Same shape as catalog, but only the
 * vendor's own products are accepted (route validates ownership).
 */
export const checkoutVendorItemSchema = z.object({
  product_id: uuidSchema,
  quantity: z.number().int().min(1).max(99),
});

/**
 * One vendor's basket. Carries the vendor id explicitly so the server
 * doesn't trust the product's vendor_id to disambiguate (defense).
 * Re-uses the composite key (vendor_id, product_id) — same product
 * id under two different vendors is two distinct items.
 */
export const checkoutVendorGroupSchema = z
  .object({
    vendor_id: vendorUuidSchema,
    items: z.array(checkoutVendorItemSchema).min(1).max(99),
  })
  .superRefine((group, ctx) => {
    const seen = new Set<string>();
    for (const it of group.items) {
      if (seen.has(it.product_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items"],
          message: "منتج مكرر في نفس المتجر",
        });
        return;
      }
      seen.add(it.product_id);
    }
  });

/**
 * Unified checkout body. Slice 3 keeps the legacy top-level fields
 * (`addressId`, `paymentMethod`, `coupon_code`, `idempotency_key`, ...)
 * so the existing checkout UI can adopt the new endpoint with the
 * smallest possible diff.
 */
export const multiVendorCheckoutSchema = z
  .object({
    items: z.array(checkoutCatalogItemSchema).max(99).optional(),
    vendor_groups: z.array(checkoutVendorGroupSchema).max(50).optional(),
    // Both camelCase and snake_case aliases are accepted. Pickup orders
    // send `null` (no address) — `.optional()` alone rejects null with
    // "Expected string, received null", so the schemas must explicitly
    // allow null. The checkout route then forwards `null` to the
    // create-checkout helper which skips zone lookup for pickup.
    addressId: z.string().max(64).nullable().optional(),
    address_id: z.string().max(64).nullable().optional(),
    paymentMethod: paymentMethodSchema.optional(),
    payment_method: paymentMethodSchema.optional(),
    deliveryType: z.enum(["delivery", "pickup"]).optional(),
    delivery_type: z.enum(["delivery", "pickup"]).optional(),
    // Scheduled delivery slot. Send scheduled=true + scheduled_for (ISO-8601
    // UTC, slot start) + slot_id from /api/v1/delivery/slots. server-side
    // validates slot belongs to config + has remaining capacity.
    scheduled: z.boolean().optional(),
    scheduled_for: z.string().datetime().optional(),
    slot_id: z.string().max(64).optional(),
    coupon_code: couponCodeSchema.optional(),
    notes: z.string().max(500).optional(),
    points_redeemed: z.coerce.number().int().min(0).max(100000).optional(),
    idempotency_key: z.string().min(8).max(64).optional(),
    // Guest info (mirrors createOrderSchema but slimmer — Slice 3
    // doesn't accept a free-form guest_info.name; the server falls
    // back to the user's profile name for logged-in users).
    name: z.string().max(100).optional(),
    phone: phoneSchema.optional(),
    guestInfo: z
      .object({
        name: z.string().max(100).optional(),
        phone: phoneSchema.optional(),
        city: z.string().max(50).optional(),
        district: z.string().max(100).optional(),
        street: z.string().max(200).optional(),
        building_number: z.string().max(50).optional(),
        email: z.string().email().optional().or(z.literal("")),
        lat: z.number().optional(),
        lng: z.number().optional(),
      })
      .optional(),
  })
  .superRefine((body, ctx) => {
    const items = body.items ?? [];
    const groups = body.vendor_groups ?? [];
    if (items.length === 0 && groups.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "السلة فارغة",
      });
    }

    // Catalog items must not duplicate each other.
    const seenCatalog = new Set<string>();
    for (const it of items) {
      if (seenCatalog.has(it.product_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items"],
          message: "منتج مكرر في السلة",
        });
        return;
      }
      seenCatalog.add(it.product_id);
    }

    // Vendor groups must not duplicate vendors.
    const seenVendors = new Set<string>();
    for (const g of groups) {
      if (seenVendors.has(g.vendor_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["vendor_groups"],
          message: "مجموعة مكررة لنفس المتجر",
        });
        return;
      }
      seenVendors.add(g.vendor_id);
    }

    // Loyalty+coupon apply only to the catalog — reject when there's
    // no catalog portion (the route would also reject but failing
    // earlier with a clearer message is friendlier).
    if (items.length === 0) {
      if (body.coupon_code) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coupon_code"],
          message: "الكوبون يخص منتجات أسواق سيتي فقط",
        });
      }
      if (body.points_redeemed && body.points_redeemed > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["points_redeemed"],
          message: "استبدال النقاط يخص منتجات أسواق سيتي فقط",
        });
      }
    }
  });