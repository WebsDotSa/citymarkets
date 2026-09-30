// CheckoutService — orchestrates the POST /api/v1/checkout pipeline.
//
// Pulled out of src/app/api/v1/checkout/route.ts in 2026-09-28 to keep
// the route handler thin (CSRF + auth + rate-limit + body parsing +
// delegation). The service owns every business step AFTER body
// validation:
//
//   1. Store-status gate (admin-controlled platform-wide open/closed)
//   2. Daily working-hours gate (admin-controlled delivery windows)
//   3. Per-vendor closed gate (vendor-controlled open windows)
//   4. Scheduled-slot validation (against delivery_settings.slots)
//   5. Backfill guestInfo from `users` for logged-in customers (so
//      vendor_orders.customer_phone NOT NULL accepts the row).
//   6. Open a transaction, run createCheckout (atomic stock lock +
//      order + vendor_orders insert).
//   7. Initiate online payment (Tamara / Moyasar inline / Moyasar
//      hosted) — best-effort with rollback to `payment_status='failed'`
//      when the gateway rejects.
//   8. Fire-and-forget push + admin notify.
//   9. Surface idempotency-key UNIQUE violations as replays instead
//      of 500s (race between two simultaneous same-key POSTs).
//
// Returns a discriminated union so the route can map kinds → HTTP
// status codes without re-implementing the switch. The route is
// responsible for the JSON body shape — the service only carries
// payload data, never NextResponse objects.
//
// All side-effecting calls are explicit arguments (no module-level
// imports of `pool`, etc.) so the service is straightforward to unit
// test with a fake Queryable.

import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { multiVendorCheckoutSchema } from "@/lib/validation";
import { error as logError, info as logInfo, warn as logWarn } from "@/lib/logger";
import { getStoreStatusSettings } from "@/lib/app-settings";
import { evaluateHours } from '@/lib/delivery/delivery-hours';
import { getActiveStoreHours } from '@/lib/delivery/store-hours';
import { checkClosedVendorsInCart } from '@/lib/delivery/vendor-closed-gate';
import { getLoyaltySettings } from "../loyalty";
import {
  createCheckout,
  type CheckoutResult,
} from "./create-checkout";
import type { DeliveryAddressRow } from "./resolve-address";
import type { CouponRow } from "./pricing";
import { reportCheckoutError } from "@/lib/errors/checkout-error-reporter";
import { markOrderPaymentFailed } from "@/lib/payments/payment-service";
import { getMainStoreAndDistance } from "@/lib/delivery/main-store";

/** Caller identity resolved upstream by the route handler. */
export interface CheckoutServiceCaller {
  userId: string | null;
  sessionId: string | null;
  clientIp: string;
}

/** All non-body inputs the service needs from the caller. */
export interface CheckoutServiceContext {
  caller: CheckoutServiceCaller;
  body: unknown; // pre-validated against multiVendorCheckoutSchema
}

export type CheckoutServiceResult =
  // 2xx — terminal success (or replay)
  | { kind: "success"; status: 200 | 201; body: CheckoutSuccessBody }
  | { kind: "replay"; status: 200; body: CheckoutReplayBody }
  // 4xx — caller-fixable
  | { kind: "validation_error"; status: 400; error: string; field?: string }
  | { kind: "vendor_min_order"; status: 400; error: string; vendorId?: string }
  | { kind: "vendor_inactive"; status: 422; error: string; vendorId?: string }
  | { kind: "stock_insufficient"; status: 409; error: string; productId?: string }
  | { kind: "ownership_mismatch"; status: 400; error: string; productId?: string }
  | { kind: "product_not_found"; status: 400; error: string; productId?: string }
  | { kind: "empty_cart"; status: 400; error: string }
  | { kind: "no_address"; status: 400; error: string }
  | { kind: "no_main_store"; status: 503; error: string }
  // 5xx — server / upstream
  | { kind: "store_closed"; status: 503; error: string; outOfHours?: boolean; hours?: { open_time: string; close_time: string } }
  | { kind: "vendor_closed"; status: 409; error: string; closedVendorIds: string[]; closedVendorNames: string[] }
  | { kind: "payment_init_failed"; status: 502; error: string; parentOrderId: string }
  | { kind: "internal_error"; status: 500; error: string; debug?: string | null };

export interface CheckoutSuccessBody {
  success: true;
  parent_order_id: string;
  vendor_order_ids: string[];
  duplicate?: boolean;
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  discount: number;
  total: number;
  vendor_totals: Record<string, number>;
  payment_method: string;
  payment_url: string | null;
  inline_payment: boolean;
  requires_payment: boolean;
  message: string;
}

export interface CheckoutReplayBody {
  success: true;
  parent_order_id: string;
  vendor_order_ids: string[];
  duplicate: true;
  payment_method: string;
}

/**
 * Run the full checkout pipeline. Never throws — every error path
 * returns a discriminated-union result so the caller can map directly
 * to a NextResponse.
 */
export async function runCheckout(
  ctx: CheckoutServiceContext,
): Promise<CheckoutServiceResult> {
  const { caller } = ctx;
  const validation = multiVendorCheckoutSchema.safeParse(ctx.body);
  if (!validation.success) {
    const first = validation.error.errors[0];
    return {
      kind: "validation_error",
      status: 400,
      error: first?.message || "بيانات غير صالحة",
    };
  }
  const v = validation.data;

  // 1. Store open/closed (admin toggle)
  const storeStatus = await getStoreStatusSettings();
  if (storeStatus.is_open === false) {
    return {
      kind: "store_closed",
      status: 503,
      error: storeStatus.message || "الموقع مغلق — لا يمكن إتمام الطلبات حالياً",
    };
  }

  // 2. Daily working hours — resolve the main store id first so the
  // gate respects per-branch `stores.opening_hours` (migration 079).
  // Pre-079 the platform used a single global `delivery_settings.hours`
  // and any branch could quietly breach it; now a branch with custom
  // hours overrides the global config.
  const { store: mainStoreRow } = await getMainStoreAndDistance(pool, null, null);
  const mainStoreId = mainStoreRow?.id ?? null;
  if (!mainStoreId) {
    return {
      kind: "no_main_store",
      status: 503,
      error: "لم يتم تكوين الفرع الرئيسي. أضف متجرًا رئيسيًا في إعدادات الفروع.",
    };
  }
  const hours = await getActiveStoreHours(pool, mainStoreId);
  if (!hours) {
    // Defensive: shouldn't happen — we just resolved the id above.
    return {
      kind: "no_main_store",
      status: 503,
      error: "لم يتم العثور على إعدادات ساعات العمل للفرع الرئيسي.",
    };
  }
  const hoursCheck = evaluateHours(hours);
  if (!hoursCheck.open) {
    return {
      kind: "store_closed",
      status: 503,
      error:
        hoursCheck.message ||
        hours.closed_message ||
        "التوصيل متاح فقط خلال ساعات العمل",
      outOfHours: true,
      hours: {
        open_time: hours.open_time,
        close_time: hours.close_time,
      },
    };
  }

  // 3. Per-vendor closed gate (best-effort, never blocks on settings hiccup)
  const vendorIdsInCart = (v.vendor_groups ?? [])
    .map((g) => g.vendor_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (vendorIdsInCart.length > 0) {
    try {
      const closedGate = await checkClosedVendorsInCart({
        client: pool,
        vendorIds: vendorIdsInCart,
      });
      if (closedGate.closed.length > 0) {
        return {
          kind: "vendor_closed",
          status: 409,
          error: closedGate.message,
          closedVendorIds: closedGate.closed.map((x) => x.id),
          closedVendorNames: closedGate.closed.map((x) => x.name),
        };
      }
    } catch (err) {
      logError("vendor closed gate query failed:", err);
    }
  }

  // 4. Scheduled-slot validation
  let scheduledFor: Date | null = null;
  let slotId: string | null = null;
  if (v.scheduled) {
    if (!v.scheduled_for || !v.slot_id) {
      return {
        kind: "validation_error",
        status: 400,
        error: "scheduled_for و slot_id مطلوبان عند scheduled=true",
      };
    }
    scheduledFor = new Date(v.scheduled_for);
    slotId = v.slot_id;
    if ((v.deliveryType ?? v.delivery_type ?? "delivery") === "pickup") {
      return {
        kind: "validation_error",
        status: 400,
        error: "الاستلام من الفرع لا يدعم الجدولة",
      };
    }
  }

  // 5. Backfill guestInfo from `users` for logged-in customers
  const guestInfo = await resolveGuestInfo(v, caller.userId);

  // 6. Run the transactional createCheckout
  const client = await pool.connect();
  let txOpen = false;
  try {
    const pricingJson = await loadPricingJson(client);
    const pricing = {
      serviceFeeEnabled: pricingJson.serviceFeeEnabled !== false,
      serviceFeeType: (pricingJson.serviceFeeType as string) ?? "fixed",
      serviceFeeValue: (pricingJson.serviceFeeValue as number | null) ?? null,
    };

    const mainStore = await loadMainStore(client);

    const addresses: DeliveryAddressRow[] = caller.userId
      ? await loadUserAddresses(client, caller.userId)
      : [];

    const { coupon, txOpen: cOpen } = await loadCoupon(client, v.coupon_code ?? null);
    txOpen = cOpen;

    const userLoyaltyBalance = caller.userId
      ? await loadLoyaltyBalance(client, caller.userId)
      : 0;
    const loyaltySettings = await getLoyaltySettings();

    if (!txOpen) {
      await client.query("BEGIN");
      txOpen = true;
    }

    const deliveryMode = (v.deliveryType ?? v.delivery_type ?? "delivery") as
      | "delivery"
      | "pickup";
    const paymentMethod = (v.paymentMethod ?? v.payment_method ?? "mada") as string;
    const addressId = (v.addressId ?? v.address_id) as string | undefined;
    const couponCode = v.coupon_code ?? null;
    const pointsRequested = v.points_redeemed ?? 0;

    const result: CheckoutResult = await createCheckout({
      client,
      input: {
        customerId: caller.userId,
        guestInfo,
        catalog: (v.items ?? []).map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
        })),
        vendorGroups: (v.vendor_groups ?? []).map((g) => ({
          vendor_id: g.vendor_id,
          items: g.items.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity,
          })),
        })),
        addressId: addressId ?? null,
        deliveryMode,
        paymentMethod,
        couponCode,
        pointsRequested,
        userLoyaltyBalance,
        loyaltySettings: {
          redeem_value_per_point: loyaltySettings.redeem_value_per_point,
          max_redeem_percent: loyaltySettings.max_redeem_percent,
        },
        notes: v.notes ?? null,
        idempotencyKey: v.idempotency_key ?? null,
        scheduledFor,
        slotId,
      },
      pricing,
      coupon,
      mainStore,
      addresses,
    });

    if (!result.success) {
      await client.query("ROLLBACK");
      txOpen = false;
      return mapResolutionError(result);
    }

    await client.query("COMMIT");
    txOpen = false;

    // 7. Online payment init
    const paymentUrl = await maybeInitiatePayment({
      paymentMethod,
      guestInfo,
      idempotencyKey: v.idempotency_key ?? null,
      parentOrderId: result.parentOrderId,
      vendorOrderIds: result.vendorOrderIds,
      total: result.totals.total,
    });

    if (paymentUrl.kind === "failure") {
      return {
        kind: "payment_init_failed",
        status: 502,
        error: paymentUrl.error,
        parentOrderId: result.parentOrderId,
      };
    }

    // 8. Guest cart cleanup (logged-in users cleared inside createCheckout)
    if (!caller.userId && caller.sessionId) {
      await pool.query("DELETE FROM guest_cart WHERE session_id = $1", [
        caller.sessionId,
      ]);
    }

    // 9. Push + admin notify (fire-and-forget)
    void notifySuccess({
      userId: caller.userId,
      parentOrderId: result.parentOrderId,
      total: result.totals.total,
      customerName: guestInfo?.name ?? null,
    });

    logInfo(
      `multi-vendor checkout ${result.duplicate ? "replay" : "created"} parent=${result.parentOrderId} children=${result.vendorOrderIds.length}`,
    );

    return {
      kind: "success",
      status: 200,
      body: {
        success: true,
        parent_order_id: result.parentOrderId,
        vendor_order_ids: result.vendorOrderIds,
        duplicate: result.duplicate,
        subtotal: result.totals.catalogSubtotal,
        deliveryFee: result.totals.totalDeliveryFee,
        serviceFee: result.totals.serviceFee,
        discount: result.totals.discount,
        total: result.totals.total,
        vendor_totals: result.totals.vendorTotals,
        payment_method: result.paymentMethod,
        payment_url: paymentUrl.url,
        inline_payment: paymentUrl.inline,
        requires_payment: result.requiresOnlinePayment,
        message: paymentUrl.inline
          ? "تم إنشاء الطلب، أكمل الدفع أدناه"
          : paymentUrl.url
            ? "تم إنشاء الطلب، جاري التحويل للدفع"
            : "تم إنشاء الطلب بنجاح",
      },
    };
  } catch (error) {
    if (txOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
    }

    const cause = (error as { cause?: unknown })?.cause;
    const causeMsg =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : null;
    const isUniqueViolation =
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      (cause as { code: unknown }).code === "23505";

    if (isUniqueViolation) {
      logWarn("idempotency_key unique violation — replaying existing order", {
        pgMessage: causeMsg ?? undefined,
      });
      if (v.idempotency_key) {
        const replay = await replayByIdempotencyKey(v.idempotency_key);
        if (replay) return { kind: "replay", status: 200, body: replay };
      }
    }

    logError("multi-vendor checkout error:", error, {
      pgMessage: causeMsg ?? undefined,
      userId: caller.userId ?? undefined,
      idempotencyKey: v.idempotency_key ?? undefined,
      itemsCount: (v.items ?? []).length,
      vendorGroupsCount: (v.vendor_groups ?? []).length,
    });
    await reportCheckoutError(error, {
      surface: "checkout",
      route: "POST /api/v1/checkout",
      userId: caller.userId,
      idempotencyKey: v.idempotency_key ?? null,
      itemsCount: (v.items ?? []).length,
      vendorGroupsCount: (v.vendor_groups ?? []).length,
      paymentMethod: v.payment_method ?? null,
      deliveryType: v.delivery_type ?? null,
    });
    const showDebug =
      process.env.NODE_ENV !== "production" &&
      process.env.HIDE_CHECKOUT_DEBUG !== "1";
    return {
      kind: "internal_error",
      status: 500,
      error: "حدث خطأ في إنشاء الطلب",
      debug: showDebug
        ? process.env.DEBUG_CHECKOUT === "1"
          ? causeMsg ?? (error instanceof Error ? error.message : null)
          : null
        : null,
    };
  } finally {
    client.release();
  }
}

// ---- Helpers (exported for unit testing) ----

interface ValidatedCheckoutBody {
  items?: Array<{ product_id: string; quantity: number }>;
  vendor_groups?: Array<{
    vendor_id?: string;
    items: Array<{ product_id: string; quantity: number }>;
  }>;
  addressId?: string | null;
  address_id?: string | null;
  paymentMethod?: string;
  payment_method?: string;
  deliveryType?: "delivery" | "pickup";
  delivery_type?: "delivery" | "pickup";
  coupon_code?: string | null;
  points_redeemed?: number;
  idempotency_key?: string | null;
  notes?: string | null;
  scheduled?: boolean;
  scheduled_for?: string;
  slot_id?: string;
  guestInfo?: {
    name?: string;
    phone?: string;
    city?: string;
    district?: string;
    street?: string;
    building_number?: string;
    email?: string;
    lat?: string | number | null;
    lng?: string | number | null;
  };
  name?: string;
  phone?: string;
}

async function resolveGuestInfo(
  v: ValidatedCheckoutBody,
  userId: string | null,
) {
  let guestInfo: {
    name: string | null;
    phone: string | null;
    city: string | null;
    district: string | null;
    street: string | null;
    building_number: string | null;
    email: string | null;
    lat: number | null;
    lng: number | null;
  } | null = v.guestInfo
    ? {
        name: v.guestInfo.name ?? v.name ?? null,
        phone: v.guestInfo.phone ?? v.phone ?? null,
        city: v.guestInfo.city ?? null,
        district: v.guestInfo.district ?? null,
        street: v.guestInfo.street ?? null,
        building_number: v.guestInfo.building_number ?? null,
        email: v.guestInfo.email ?? null,
        lat: v.guestInfo.lat != null ? Number(v.guestInfo.lat) : null,
        lng: v.guestInfo.lng != null ? Number(v.guestInfo.lng) : null,
      }
    : v.name || v.phone
      ? {
          name: v.name ?? null,
          phone: v.phone ?? null,
          city: null,
          district: null,
          street: null,
          building_number: null,
          email: null,
          lat: null,
          lng: null,
        }
      : null;

  if (userId && (!guestInfo || !guestInfo.phone || !guestInfo.name)) {
    const u = await pool.query<{
      phone: string | null;
      name: string | null;
      email: string | null;
    }>(`SELECT phone, name, email FROM users WHERE id = $1 LIMIT 1`, [userId]);
    const urow = u.rows[0];
    if (urow) {
      guestInfo = {
        name: guestInfo?.name ?? urow.name ?? null,
        phone: guestInfo?.phone ?? urow.phone ?? null,
        email: guestInfo?.email ?? urow.email ?? null,
        city: guestInfo?.city ?? null,
        district: guestInfo?.district ?? null,
        street: guestInfo?.street ?? null,
        building_number: guestInfo?.building_number ?? null,
        lat: guestInfo?.lat != null ? Number(guestInfo.lat) : null,
        lng: guestInfo?.lng != null ? Number(guestInfo.lng) : null,
      };
    }
  }
  return guestInfo;
}

async function loadPricingJson(client: PoolClient): Promise<Record<string, unknown>> {
  const r = await client.query(
    `SELECT value FROM delivery_settings WHERE key = 'pricing'`,
  );
  return (r.rows[0]?.value as Record<string, unknown>) ?? {};
}

async function loadMainStore(client: PoolClient): Promise<{ lat: number; lng: number } | null> {
  // Delegate to the canonical helper. We pass no customer point
  // (distance is computed later inside `createCheckout` after the
  // address is resolved). The helper returns `{ store, distanceKm }`
  // where `distanceKm` is null when no point was supplied.
  const { store } = await getMainStoreAndDistance(client, null, null);
  if (!store) return null;
  if (store.is_active === false) return null;
  if (store.lat == null || store.lng == null) return null;
  return { lat: Number(store.lat), lng: Number(store.lng) };
}

async function loadUserAddresses(
  client: PoolClient,
  userId: string,
): Promise<DeliveryAddressRow[]> {
  const r = await client.query<DeliveryAddressRow>(
    `SELECT id, lat, lng FROM addresses
      WHERE user_id = $1
      ORDER BY is_default DESC, created_at ASC`,
    [userId],
  );
  return r.rows;
}

async function loadCoupon(
  client: PoolClient,
  couponCode: string | null,
): Promise<{ coupon: CouponRow | null; txOpen: boolean }> {
  if (!couponCode) return { coupon: null, txOpen: false };
  await client.query("BEGIN");
  const cp = await client.query(
    `SELECT id, code, type::text AS type, value, min_order, max_discount,
            max_uses, used_count, expires_at, is_active
       FROM coupons
      WHERE UPPER(code) = $1
      FOR UPDATE`,
    [couponCode],
  );
  return { coupon: (cp.rows[0] as CouponRow | undefined) ?? null, txOpen: true };
}

async function loadLoyaltyBalance(client: PoolClient, userId: string): Promise<number> {
  const r = await client.query(
    `SELECT balance FROM loyalty_points WHERE user_id = $1`,
    [userId],
  );
  return Number(r.rows[0]?.balance ?? 0);
}

function mapResolutionError(result: Extract<CheckoutResult, { success: false }>): CheckoutServiceResult {
  switch (result.kind) {
    case "stock_insufficient":
      return {
        kind: "stock_insufficient",
        status: 409,
        error: result.error,
        productId: result.productId,
      };
    case "vendor_min_order":
      return {
        kind: "vendor_min_order",
        status: 400,
        error: result.error,
        vendorId: result.vendorId,
      };
    case "vendor_inactive":
      return {
        kind: "vendor_inactive",
        status: 422,
        error: result.error,
        vendorId: result.vendorId,
      };
    case "ownership_mismatch":
      return {
        kind: "ownership_mismatch",
        status: 400,
        error: result.error,
        productId: result.productId,
      };
    case "product_not_found":
      return {
        kind: "product_not_found",
        status: 400,
        error: result.error,
        productId: result.productId,
      };
    case "empty_cart":
      return { kind: "empty_cart", status: 400, error: result.error };
    case "no_address":
      return { kind: "no_address", status: 400, error: result.error };
    case "no_main_store":
      return { kind: "no_main_store", status: 503, error: result.error };
    default:
      return { kind: "internal_error", status: 500, error: result.error };
  }
}

interface PaymentInitResult {
  kind: "ok";
  url: string | null;
  inline: boolean;
}
interface PaymentInitFailure {
  kind: "failure";
  error: string;
}

async function maybeInitiatePayment(args: {
  paymentMethod: string;
  guestInfo: {
    name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  idempotencyKey: string | null;
  parentOrderId: string;
  vendorOrderIds: string[];
  total: number;
}): Promise<PaymentInitResult | PaymentInitFailure> {
  const { paymentMethod, guestInfo, idempotencyKey, parentOrderId, vendorOrderIds, total } = args;
  const customerName = guestInfo?.name || "عميل";
  const customerMobile = guestInfo?.phone || "0500000000";

  // Cash / wallet / pickup — no gateway call.
  if (paymentMethod === "cash" || paymentMethod === "wallet") {
    return { kind: "ok", url: null, inline: false };
  }

  try {
    const {
      initiateOnlinePayment,
      initiateTamaraPayment,
      isTamaraEnabled,
      getPaymentProvider,
      isMoyasarInlineCheckoutEnabled,
    } = await import("@/lib/payments/initiate");

    if (paymentMethod === "tamara" && isTamaraEnabled()) {
      const t = await initiateTamaraPayment({
        orderId: parentOrderId,
        totalSar: total,
        description: `طلب سيتي ماركت #${parentOrderId.slice(-8)}`,
        customerName,
        customerPhone: customerMobile,
        customerEmail: guestInfo?.email ?? undefined,
        items: [{ name: "طلب متعدد البائعين", quantity: 1, unitPriceSar: total }],
        idempotencyKey: idempotencyKey ?? undefined,
      });
      if (t.success && t.paymentUrl && t.referenceId) {
        await pool.query(
          `UPDATE orders SET payment_reference = $1, payment_status = 'pending' WHERE id = $2`,
          [String(t.referenceId), parentOrderId],
        );
        return { kind: "ok", url: t.paymentUrl, inline: false };
      }
      await markOrderPaymentFailed(parentOrderId, vendorOrderIds);
      return {
        kind: "failure",
        error: t.error || "تعذّر فتح بوابة تمارا. لم يتم خصم أي مبلغ.",
      };
    }

    if (isMoyasarInlineCheckoutEnabled()) {
      await pool.query(
        `UPDATE orders SET payment_status = 'pending' WHERE id = $1`,
        [parentOrderId],
      );
      return { kind: "ok", url: null, inline: true };
    }

    const p = await initiateOnlinePayment({
      amount: total,
      orderId: parentOrderId,
      customerName,
      customerMobile,
      customerEmail: guestInfo?.email ?? undefined,
      items: [{ name: "طلب متعدد البائعين", quantity: 1, unitPrice: total }],
      idempotencyKey: idempotencyKey ?? undefined,
    });
    const provider = getPaymentProvider();
    if (p.success && p.paymentUrl && p.referenceId) {
      await pool.query(
        `UPDATE orders SET payment_reference = $1, payment_status = 'pending' WHERE id = $2`,
        [String(p.referenceId), parentOrderId],
      );
      return { kind: "ok", url: p.paymentUrl, inline: false };
    }
    logError("Payment init failed", p.error, { provider });
    await markOrderPaymentFailed(parentOrderId, vendorOrderIds);
    return {
      kind: "failure",
      error: p.error || "تعذّر فتح بوابة الدفع الإلكتروني. لم يتم خصم أي مبلغ.",
    };
  } catch (err) {
    logError("Payment init error:", err);
    await markOrderPaymentFailed(parentOrderId, vendorOrderIds);
    return { kind: "failure", error: "تعذّر الاتصال ببوابة الدفع. حاول مرة أخرى." };
  }
}

async function replayByIdempotencyKey(
  key: string,
): Promise<CheckoutReplayBody | null> {
  const r = await pool.query(
    `SELECT id, payment_method FROM orders WHERE idempotency_key = $1`,
    [key],
  );
  if (r.rows.length === 0) return null;
  const parent = r.rows[0];
  const childRows = await pool.query(
    `SELECT id FROM vendor_orders WHERE parent_order_id = $1`,
    [parent.id],
  );
  return {
    success: true,
    parent_order_id: parent.id,
    vendor_order_ids: childRows.rows.map((row: { id: string }) => row.id),
    duplicate: true,
    payment_method: parent.payment_method,
  };
}

async function notifySuccess(args: {
  userId: string | null;
  parentOrderId: string;
  total: number;
  customerName: string | null;
}) {
  const { userId, parentOrderId, total, customerName } = args;
  try {
    if (userId) {
      const { sendPushToUser } = await import("@/lib/push");
      await sendPushToUser(userId, {
        title: "تم استلام طلبك",
        body: `طلبك #${parentOrderId.slice(0, 8)} قيد المعالجة — ${total.toFixed(2)} ر.س`,
        url: "/orders",
        tag: `order-${parentOrderId}`,
      });
    }
  } catch {
    /* push is optional */
  }
  try {
    const { enqueueAdminNewOrder } = await import("@/lib/queue");
    // Worker re-fetches the order to compute customerName + total, so
    // we only pass the parent order id here.
    void enqueueAdminNewOrder(parentOrderId);
  } catch {
    /* admin notify is optional */
  }
}
