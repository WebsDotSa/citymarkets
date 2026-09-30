// Multi-vendor checkout: one transaction, one parent + N vendor orders.
//
// Atomically:
//   1. Resolve items (stock-locked) and delivery distance (main store →
//      customer lat/lng via Haversine).
//   2. Compute totals (catalog subtotal + per-vendor subtotals + coupon +
//      loyalty + universal distance-based delivery fee + service fee).
//   3. Validate the idempotency key (replay → return existing parent).
//   4. Decrement stock on catalog rows (vendor_products for City
//      Markets, vendor_products for vendors — both columns already
//      exist) and insert order_items / vendor_order_items.
//   5. Insert the parent `orders` row + N `vendor_orders` children
//      with `parent_order_id` and `idempotency_key` set.
//   6. Clear the cart (and the loyalty pending_redeem hold).
//
// Returns the canonical IDs the route will return to the caller:
//   { parent_order_id, vendor_order_ids[], total, ... }
//
// On any error the transaction is rolled back and the caller gets a
// structured error. The route decides which HTTP status to map.

import type { PoolClient } from "pg";
import { CITY_MARKETS_VENDOR_ID } from "@/lib/types";
import { queryMany, queryOne, type Queryable } from "@/lib/db/typed";
import { computeCheckoutTotals, type CheckoutTotals } from "./pricing";
import {
  resolveItems,
  type ItemResolutionError,
  type ResolvedCheckout,
} from "./resolve-items";
import {
  pickUserAddress,
  type DeliveryAddressRow,
} from "./resolve-address";
import type { CouponRow } from "./pricing";
import { haversineKm } from '@/lib/delivery';
import { generateVendorOrderNumber } from "@/lib/orders/order-number";
import {
  parseSlotsConfig,
  riyadhWallClockToUtc,
  toRiyadhDateKey,
  validateSlotSelection,
} from '@/lib/delivery';

export interface CheckoutInput {
  customerId: string | null;
  guestInfo: {
    name: string | null;
    phone: string | null;
    city: string | null;
    district: string | null;
    street: string | null;
    building_number: string | null;
    email: string | null;
    lat: number | null;
    lng: number | null;
  } | null;
  catalog: { product_id: string; quantity: number }[];
  vendorGroups: { vendor_id: string; items: { product_id: string; quantity: number }[] }[];
  addressId: string | null;
  deliveryMode: "delivery" | "pickup";
  paymentMethod: string;
  couponCode: string | null;
  pointsRequested: number;
  userLoyaltyBalance: number;
  /**
   * Admin-tuned loyalty rates. When omitted the pricing pipeline falls
   * back to the same defaults used by `computeLoyaltyRedemption` (0.05
   * SAR/point, 50% cap, 100-pt bundles), preserving byte-for-byte
   * legacy behaviour.
   */
  loyaltySettings?: {
    redeem_value_per_point?: number;
    max_redeem_percent?: number;
  };
  notes: string | null;
  idempotencyKey: string | null;
  // Scheduled delivery — optional. When `scheduledFor` is set, the order
  // is treated as a future-slot booking; `slotId` is the window id from
  // /api/v1/delivery/slots. Validated server-side in the checkout route.
  scheduledFor: Date | null;
  slotId: string | null;
}

export interface CheckoutSuccess {
  success: true;
  parentOrderId: string;
  vendorOrderIds: string[];
  totals: CheckoutTotals;
  paymentMethod: string;
  paymentStatus: "pending";
  requiresOnlinePayment: boolean;
  couponCode: string | null;
  duplicate: boolean;
}

export interface CheckoutFailure {
  success: false;
  error: string;
  /**
   * Machine-readable error tag. The route maps this to an HTTP status:
   *   - validation → 400
   *   - stock_insufficient → 409
   *   - vendor_min_order → 400
   *   - duplicate → 200 (handled by the route when the existing row
   *     is returned instead of constructing a new one)
   *   - other → 500
   */
  kind:
    | "validation"
    | "empty_cart"
    | "no_address"
    | "no_main_store"
    | "vendor_inactive"
    | "stock_insufficient"
    | "vendor_min_order"
    | "ownership_mismatch"
    | "product_not_found"
    | "db_error";
  productId?: string;
  vendorId?: string;
}

export type CheckoutResult = CheckoutSuccess | CheckoutFailure;

export interface CreateCheckoutArgs {
  client: PoolClient;
  input: CheckoutInput;
  pricing: {
    serviceFeeEnabled: boolean;
    serviceFeeType: string;
    serviceFeeValue: number | null;
  };
  /** Coupon row already loaded + FOR UPDATE-locked by the caller. */
  coupon: CouponRow | null;
  /**
   * Main-store lat/lng (and active flag) preloaded by the route from
   * `stores WHERE is_main = true AND is_active = true LIMIT 1`.
   * Required for delivery orders — pickup skips the distance
   * calculation entirely.
   */
  mainStore: { lat: number; lng: number } | null;
  /** Address rows for the user (already loaded by the route). */
  addresses: DeliveryAddressRow[];
}

export async function createCheckout(
  args: CreateCheckoutArgs,
): Promise<CheckoutResult> {
  const { client, input, pricing, coupon, mainStore, addresses } = args;

  if (input.catalog.length === 0 && input.vendorGroups.length === 0) {
    return { success: false, error: "السلة فارغة", kind: "empty_cart" };
  }

  // ---- 1. Delivery resolution: lat/lng + distance from main store ----
  let dbAddressId: string | null = null;
  let point: { lat: number; lng: number } | null = null;
  // Straight-line km from the resolved customer point to the main
  // store. `null` for pickup (no distance relevant) or when the
  // customer point is missing — `computeDistanceFee` treats `null`
  // as "fee is 0" (fail-safe).
  let distanceKm: number | null = null;

  if (input.deliveryMode !== "pickup") {
    if (input.customerId) {
      const addr = pickUserAddress(addresses, input.addressId ?? undefined);
      if (!addr) {
        return {
          success: false,
          error: "لم يتم العثور على عنوان. أضِف عنوانًا من حسابك",
          kind: "no_address",
        };
      }
      dbAddressId = addr.id;
      point = {
        lat: Number(addr.lat),
        lng: Number(addr.lng),
      };
    } else if (input.guestInfo?.lat != null && input.guestInfo.lng != null) {
      point = { lat: input.guestInfo.lat, lng: input.guestInfo.lng };
    } else {
      return {
        success: false,
        error: "العنوان مطلوب للتوصيل",
        kind: "no_address",
      };
    }

    if (!mainStore) {
      return {
        success: false,
        error: "لم يتم تهيئة موقع المتجر الرئيسي. يرجى التواصل مع الإدارة",
        kind: "no_main_store",
      };
    }
    distanceKm = haversineKm(
      mainStore.lat,
      mainStore.lng,
      point.lat,
      point.lng,
    );
  }

  // ---- 2. Items (stock-locked) ----
  const itemsResult = await resolveItems({
    catalog: [{ items: input.catalog }],
    vendorGroups: input.vendorGroups,
    client,
  });
  if ("kind" in itemsResult) {
    return mapItemError(itemsResult);
  }
  const resolved: ResolvedCheckout = itemsResult;

  // ---- 3. Subtotals ----
  const catalogSubtotal = resolved.catalog.reduce(
    (s, it) => s + it.unit_price * it.quantity,
    0,
  );
  const vendorGroupsForPricing = resolved.vendorGroups.map((g) => ({
    vendorId: g.vendor_id,
    vendorSlug: g.vendor_slug,
    subtotal: g.subtotal,
    minOrderAmount: g.min_order_amount,
  }));

  // ---- 4. Pricing ----
  const totals = computeCheckoutTotals({
    catalogSubtotal,
    vendorGroups: vendorGroupsForPricing,
    discounts: {
      coupon,
      pointsRequested: input.pointsRequested,
      userLoyaltyBalance: input.userLoyaltyBalance,
      loyalty: input.loyaltySettings,
    },
    deliveryMode: input.deliveryMode,
    distanceKm,
    pricing: {
      serviceFeeEnabled: pricing.serviceFeeEnabled,
      serviceFeeType: pricing.serviceFeeType,
      serviceFeeValue: pricing.serviceFeeValue,
    },
  });

  // ---- 5. Scheduled-slot validation (if requested) ----
  if (input.scheduledFor && input.slotId) {
    const cfgRes = await (client as Queryable).query(
      `SELECT value FROM delivery_settings WHERE key = 'slots' LIMIT 1`,
    );
    const cfg = parseSlotsConfig(cfgRes.rows[0]?.value);
    // Count booked orders in the same window (Riyadh-day scoped).
    const dayStart = riyadhWallClockToUtc(
      toRiyadhDateKey(input.scheduledFor),
      "00:00",
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
    const bookedRes = await (client as Queryable).query<{ n: string }>(
      // Audit 2026-09-30 (Finding 1.1): exclude orders whose status
      // is cancelled / payment failed / refunded so a cancelled
      // booking doesn't permanently consume capacity. The customer's
      // `payment_status` path is the second discriminator because
      // `status='pending'` + `payment_status='failed'` rows also exist
      // (legacy failed webhooks).
      `SELECT COUNT(*)::int AS n FROM orders
        WHERE scheduled = true
          AND slot_window = $1
          AND scheduled_for >= $2::timestamp
          AND scheduled_for <  $3::timestamp
          AND status <> 'cancelled'
          AND payment_status NOT IN ('failed', 'refunded')`,
      [input.slotId, dayStart.toISOString(), dayEnd.toISOString()],
    );
    const booked = parseInt(bookedRes.rows[0]?.n ?? "0", 10);
    const verdict = validateSlotSelection(
      cfg,
      input.slotId,
      input.scheduledFor.toISOString(),
      booked,
    );
    if (!verdict.ok) {
      return {
        success: false,
        kind: "validation",
        error: verdict.error,
      };
    }
  }

  // ---- 6. Idempotency replay check (parent-level) ----
  if (input.idempotencyKey) {
    interface ExistingOrderRow {
      id: string;
      payment_method: string;
      catalog_subtotal: string | number;
      total: string | number;
    }
    const row = await queryOne<ExistingOrderRow>(
      client as Queryable,
      `SELECT id, payment_method, catalog_subtotal, total
         FROM orders
        WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (row) {
      interface IdRow { id: string }
      const childRows = await queryMany<IdRow>(
        client as Queryable,
        `SELECT id FROM vendor_orders WHERE parent_order_id = $1`,
        [row.id],
      );
      return {
        success: true,
        parentOrderId: row.id,
        vendorOrderIds: childRows.map((r) => r.id),
        totals: {
          ...totals,
          catalogSubtotal: Number(row.catalog_subtotal),
          total: Number(row.total),
        },
        paymentMethod: row.payment_method,
        paymentStatus: "pending",
        requiresOnlinePayment:
          row.payment_method !== "cash" && row.payment_method !== "wallet",
        couponCode: null,
        duplicate: true,
      };
    }
  }

  // ---- 7. Coupon use-count (atomic with the order insert) ----
  if (coupon && totals.couponDiscount > 0 && coupon.id) {
    await client.query(
      `UPDATE coupons
          SET used_count = used_count + 1, used_at = NOW()
        WHERE id = $1`,
      [coupon.id],
    );
  }

  // ---- 8. Stock decrement (catalog only — vendor stock already
  // re-checked + locked in resolveItems; we still decrement here
  // inside the same transaction so a single ROLLBACK unwinds
  // everything).
  //
  // P2-6 (oversell guard): the UPDATE has `AND stock_quantity >=
  // $1` so a concurrent checkout that reserved the last unit sees
  // rowCount=0 and we return stock_insufficient — the route maps
  // that to 409. Without this guard, two concurrent buyers at
  // stock=1 each read stock=1 in resolveItems, both pass the
  // pre-check, and the second UPDATE drives stock_quantity
  // negative (oversell).
  for (const it of resolved.catalog) {
    if (it.track_stock) {
      const dec = await client.query(
        `UPDATE vendor_products
            SET stock_quantity = stock_quantity - $1
          WHERE id = $2 AND vendor_id = $3
            AND stock_quantity >= $1`,
        [it.quantity, it.product_id, CITY_MARKETS_VENDOR_ID],
      );
      if (dec.rowCount === 0) {
        return {
          success: false,
          error: "نفد المخزون",
          kind: "stock_insufficient",
        };
      }
    }
  }
  for (const g of resolved.vendorGroups) {
    for (const it of g.items) {
      if (it.track_stock) {
        const dec = await client.query(
          `UPDATE vendor_products
              SET stock_quantity = stock_quantity - $1
            WHERE id = $2 AND vendor_id = $3
              AND stock_quantity >= $1`,
          [it.quantity, it.product_id, g.vendor_id],
        );
        if (dec.rowCount === 0) {
          return {
            success: false,
            error: "نفد المخزون",
            kind: "stock_insufficient",
          };
        }
      }
    }
  }

  // ---- 9. Guest/Customer info for the parent row ----
  const userId = input.customerId;
  const g = input.guestInfo;

  const requiresOnlinePayment =
    input.paymentMethod !== "cash" && input.paymentMethod !== "wallet";
  // Both the parent `orders.payment_status` column and the child
  // `vendor_orders.payment_status` CHECK constraint
  //   CHECK (payment_status IN ('pending','paid','failed','refunded'))
  // disallow 'unpaid'. The webhook then advances 'pending' → 'paid'
  // on successful payment, so we use 'pending' as the initial state
  // for both online and offline (cash/wallet) orders.
  const paymentStatus: "pending" = "pending";

  // ---- 10. Insert parent order ----
  interface IdRow { id: string }
  const scheduledFlag = input.scheduledFor != null && input.slotId != null;
  const parentOrderId = (
    await queryOne<IdRow>(
      client as Queryable,
      `INSERT INTO orders (
        user_id, address_id,
        guest_name, guest_phone, guest_city, guest_district, guest_street,
        guest_building, notes, subtotal, delivery_fee, service_fee, discount, total,
        catalog_subtotal, payment_method, payment_status, status, coupon_code,
        points_redeemed, points_discount, idempotency_key,
        scheduled, scheduled_for, slot_window
     ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, 'pending', $18, $19, $20, $21,
        $22, $23, $24
     ) RETURNING id`,
      [
        userId ?? null,
        dbAddressId,
        g?.name ?? null,
        g?.phone ?? null,
        g?.city ?? null,
        g?.district ?? null,
        g?.street ?? null,
        g?.building_number ?? null,
        input.notes ?? null,
        // The parent's `subtotal` mirrors the catalog group ONLY (the
        // entire vintage orders table was catalog-only). Vendor amounts
        // live in their own rows.
        totals.catalogSubtotal,
        totals.catalogDeliveryFee,
        totals.serviceFee,
        totals.discount,
        // `total` = catalog + Σ vendor + service − discount
        Math.max(
          0,
          totals.catalogTotal +
            Object.values(totals.vendorTotals).reduce((s, v) => s + v, 0) +
            totals.serviceFee -
            totals.discount,
        ),
        totals.catalogSubtotal, // catalog_subtotal
        input.paymentMethod,
        paymentStatus,
        coupon?.code ?? null,
        totals.pointsRedeemed,
        totals.pointsDiscount,
        input.idempotencyKey ?? null,
        scheduledFlag,
        input.scheduledFor ?? null,
        input.slotId ?? null,
      ],
    )
  )?.id;
  if (!parentOrderId) {
    throw new Error("parent order insert returned no id");
  }

  // ---- 11. Insert order_items (catalog only) ----
  for (const it of resolved.catalog) {
    await client.query(
      `INSERT INTO order_items (order_id, product_id, qty, unit_price)
       VALUES ($1, $2, $3, $4)`,
      [parentOrderId, it.product_id, it.quantity, it.unit_price],
    );
  }

  // ---- 12. Insert vendor_orders (one per group) ----
  const vendorOrderIds: string[] = [];
  for (const grp of resolved.vendorGroups) {
    const orderNumber = generateVendorOrderNumber(grp.vendor_slug);
    const childIdem =
      input.idempotencyKey != null
        ? `${input.idempotencyKey}:${grp.vendor_slug}`
        : null;
    const childId = (
      await queryOne<IdRow>(
        client as Queryable,
        `INSERT INTO vendor_orders (
         order_number, vendor_id, customer_id, customer_name, customer_phone,
         customer_email, address_text, address_lat, address_lng,
         subtotal, delivery_fee, total, status, payment_method, payment_status,
         notes, parent_order_id, idempotency_key
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13, $14,
         $15, $16, $17
       ) RETURNING id`,
        [
          orderNumber,
          grp.vendor_id,
          userId ?? null,
          g?.name ?? null,
          g?.phone ?? null,
          g?.email ?? null,
          null,
          point?.lat ?? null,
          point?.lng ?? null,
          grp.subtotal,
          totals.vendorDeliveryFees[grp.vendor_id] ?? 0,
          totals.vendorTotals[grp.vendor_id] ?? 0,
          input.paymentMethod,
          paymentStatus,
          input.notes ?? null,
          parentOrderId,
          childIdem,
        ],
      )
    )?.id;
    if (!childId) {
      throw new Error("vendor order insert returned no id");
    }
    vendorOrderIds.push(childId);

    for (const it of grp.items) {
      await client.query(
        `INSERT INTO vendor_order_items (
           order_id, product_id, product_name_snapshot, unit_price,
           quantity, line_total, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          childId,
          it.product_id,
          it.name_ar,
          it.unit_price,
          it.quantity,
          it.unit_price * it.quantity,
          null,
        ],
      );
    }
  }

  // ---- 13. Loyalty pending_redeem hold (mirrors the legacy route) ----
  if (userId && totals.pointsRedeemed > 0) {
    await client.query(
      `INSERT INTO loyalty_transactions (user_id, points, type, ref_order_id)
       VALUES ($1, $2, 'pending_redeem', $3)
       ON CONFLICT (ref_order_id, type) DO NOTHING`,
      [userId, -totals.pointsRedeemed, parentOrderId],
    );
  }

  // ---- 14. Clear the cart ----
  if (userId) {
    await client.query("DELETE FROM cart WHERE user_id = $1", [userId]);
  } else {
    // Guest cart: the route can pass the session id via input but
    // we deliberately don't accept it here because the route already
    // used it to resolve the cart upstream. The route clears the
    // guest cart in a separate DELETE after the COMMIT.
  }

  return {
    success: true,
    parentOrderId,
    vendorOrderIds,
    totals,
    paymentMethod: input.paymentMethod,
    paymentStatus,
    requiresOnlinePayment,
    couponCode: coupon?.code ?? null,
    duplicate: false,
  };
}

function mapItemError(err: ItemResolutionError): CheckoutFailure {
  switch (err.kind) {
    case "product_not_found":
      return {
        success: false,
        error: err.message,
        kind: "product_not_found",
        productId: err.productId,
      };
    case "product_inactive":
      return {
        success: false,
        error: err.message,
        kind: "validation",
        productId: err.productId,
      };
    case "vendor_inactive":
      return {
        success: false,
        error: err.message,
        kind: "vendor_inactive",
        vendorId: err.vendorId,
      };
    case "ownership_mismatch":
      return {
        success: false,
        error: err.message,
        kind: "ownership_mismatch",
        productId: err.productId,
        vendorId: err.vendorId,
      };
    case "stock_insufficient":
      return {
        success: false,
        error: err.message,
        kind: "stock_insufficient",
        productId: err.productId,
      };
    case "vendor_min_order":
      return {
        success: false,
        error: err.message,
        kind: "vendor_min_order",
        vendorId: err.vendorId,
      };
  }
}