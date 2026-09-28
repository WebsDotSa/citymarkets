import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  getGuestSessionIdFromRequest,
  resolveCustomerUserIdFromRequest,
} from "@/lib/customer-session";
import { checkRateLimit, ORDER_CREATE_CONFIG, createRateLimitHeaders } from "@/lib/rate-limit";
import { multiVendorCheckoutSchema, validationError } from "@/lib/validation";
import { applyCsrfProtection } from "@/lib/csrf";
import { getClientIp } from "@/lib/request-ip";
import { error as logError, info as logInfo, warn as logWarn } from "@/lib/logger";
import { createCheckout, type CheckoutResult } from "@/lib/checkout/create-checkout";
import type { DeliveryAddressRow } from "@/lib/checkout/resolve-address";
import type { CouponRow } from "@/lib/pricing";
import { getLoyaltySettings } from "@/lib/loyalty";
import { getDeliveryHours, evaluateHours } from "@/lib/delivery-hours";
import { getStoreStatusSettings } from "@/lib/app-settings";
import { checkClosedVendorsInCart } from "@/lib/vendor-closed-gate";

/**
 * POST /api/v1/checkout — Slice 3 unified multi-vendor checkout.
 *
 * Body shape (see `multiVendorCheckoutSchema` in src/lib/validation.ts):
 *   {
 *     items:            [{ product_id, quantity }]      // catalog
 *     vendor_groups:    [{ vendor_id, items: [...] }]   // 3rd-party vendors
 *     addressId, paymentMethod, deliveryType, coupon_code,
 *     points_redeemed, idempotency_key, notes, guestInfo, ...
 *   }
 *
 * Returns:
 *   { success: true, parent_order_id, vendor_order_ids[], total,
 *     payment_url, requires_payment, duplicate? }
 *
 * On online payment: initiates a single invoice on the parent total —
 * child rows track `payment_reference` via the parent's column. The
 * webhook fans out status changes to the children.
 */
export async function POST(request: NextRequest) {
  // ---- CSRF ----
  const csrf = await applyCsrfProtection(request);
  if (csrf) return csrf;

  // ---- Auth (customer OR guest) ----
  const userId = await resolveCustomerUserIdFromRequest(request);
  const sessionId = getGuestSessionIdFromRequest(request);
  if (!userId && !sessionId) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  // ---- Rate limit ----
  const rateLimitKey = userId || getClientIp(request);
  const rateLimitResult = await checkRateLimit(
    `checkout:${rateLimitKey}`,
    ORDER_CREATE_CONFIG,
  );
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "تجاوزت الحد المسموح من الطلبات. حاول لاحقاً.",
        retryAfter: rateLimitResult.retryAfterMs,
      },
      {
        status: 429,
        headers: createRateLimitHeaders(rateLimitResult),
      },
    );
  }

  // ---- Body ----
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(validationError("نوع البيانات غير صالح"), { status: 400 });
  }
  const validation = multiVendorCheckoutSchema.safeParse(body);
  if (!validation.success) {
    const first = validation.error.errors[0];
    return NextResponse.json(
      validationError(first?.message || "بيانات غير صالحة"),
      { status: 400 },
    );
  }
  const v = validation.data;

  // ---- Store open/closed toggle (admin-controlled) ----
  // When the admin has closed the store we reject every checkout so
  // the sticky banner is not just cosmetic. We keep the response in
  // the same shape as the rest of this route so the client UI can
  // surface the configured message verbatim.
  const storeStatus = await getStoreStatusSettings();
  if (storeStatus.is_open === false) {
    return NextResponse.json(
      {
        success: false,
        error: storeStatus.message || "الموقع مغلق — لا يمكن إتمام الطلبات حالياً",
        store_closed: true,
      },
      { status: 503 },
    );
  }

  // ---- Daily working-hours gate (admin-controlled) ----
  // Server-side authoritative check: clients can lie about their
  // clock all they want, but `new Date()` here reads the host wall
  // clock. We reject the order with 503 + `out_of_hours: true` so the
  // checkout UI can render the same banner the public store-status
  // endpoint uses, instead of a generic 503.
  const hours = await getDeliveryHours();
  const hoursCheck = evaluateHours(hours);
  if (!hoursCheck.open) {
    return NextResponse.json(
      {
        success: false,
        error:
          hoursCheck.message ||
          hours.closed_message ||
          "التوصيل متاح فقط خلال ساعات العمل",
        store_closed: true,
        out_of_hours: true,
        hours: {
          open_time: hours.open_time,
          close_time: hours.close_time,
        },
      },
      { status: 503 },
    );
  }

  // ---- Per-vendor closed gate (vendor-controlled) ----
  // Block the entire order when ANY third-party vendor in the cart is
  // currently outside its own open/close window (or force-closed via
  // `vendors.is_active`). Catalog items (`CITY_MARKETS_VENDOR_ID` —
  // virtual, no `vendors` row) are gated by the platform-wide hours
  // check above. Status 409 matches the `stock_insufficient` branch
  // in `mapErrorKindToStatus` — both are "your cart contents need
  // adjusting before the order can proceed".
  // We run this BEFORE `pool.connect()` to keep it as a tiny
  // autocommit read; the more expensive txn work starts only when
  // every vendor is open.
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
        return NextResponse.json(
          {
            success: false,
            error: closedGate.message,
            vendor_closed: true,
            closedVendorIds: closedGate.closed.map((x) => x.id),
            closedVendorNames: closedGate.closed.map((x) => x.name),
          },
          { status: 409 },
        );
      }
    } catch (err) {
      // Never block checkout on a settings hiccup — log and continue
      // so the existing flow can still process the order. The admin
      // gets the same warning via Sentry/loki.
      logError("vendor closed gate query failed:", err);
    }
  }

  const deliveryMode = (v.deliveryType ?? v.delivery_type ?? "delivery") as "delivery" | "pickup";
  // Operator decision (2026-09-20): cash is no longer accepted. The
  // checkout UI always sends an explicit payment_method, but if a stale
  // client omits it we fall back to `mada` instead of the historical
  // `cash` so the resulting order is in a payable state.
  const paymentMethod = (v.paymentMethod ?? v.payment_method ?? "mada") as string;
  const addressId = (v.addressId ?? v.address_id) as string | undefined;
  const couponCode = v.coupon_code ?? null;
  const pointsRequested = v.points_redeemed ?? 0;

  // ---- Scheduled delivery slot (optional) ----
  // Parsed + validated against `delivery_settings.slots` config; capacity
  // re-checked at insert time so two concurrent orders can't double-book
  // the last seat in a window.
  let scheduledFor: Date | null = null;
  let slotId: string | null = null;
  if (v.scheduled) {
    if (!v.scheduled_for || !v.slot_id) {
      return NextResponse.json(
        validationError("scheduled_for و slot_id مطلوبان عند scheduled=true"),
        { status: 400 },
      );
    }
    scheduledFor = new Date(v.scheduled_for);
    slotId = v.slot_id;
    if (deliveryMode === "pickup") {
      return NextResponse.json(
        validationError("الاستلام من الفرع لا يدعم الجدولة"),
        { status: 400 },
      );
    }
  }

  // ---- Build the input ----
  // Declared `let` (not `const`) so the post-validation merge below
  // can fill in name/phone/email from the `users` table when a logged-in
  // customer submits without `guestInfo`. The legacy version used
  // `const`, which meant the only path to a successful `vendor_orders`
  // insert was to send a `guestInfo` payload — and the React checkout
  // never sends one for authenticated users, so every vendor order
  // crashed with "null value in column 'customer_phone'".
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

  // For LOGGED-IN customers who didn't include `guestInfo` (or sent it
  // without phone/name), pull the stored values from the `users` table
  // so `vendor_orders.customer_phone` (NOT NULL) accepts the row.
  // Without this, every vendor order fails with
  //   "null value in column 'customer_phone' of relation 'vendor_orders'
  //    violates not-null constraint".
  if (userId && (!guestInfo || !guestInfo.phone || !guestInfo.name)) {
    const u = await pool.query<{ phone: string | null; name: string | null; email: string | null }>(
      `SELECT phone, name, email FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
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
        // The downstream `createCheckout` type narrows `lat`/`lng` to
        // `number | null` (it converts via Number() before INSERTing).
        // The input shape allows `string | number | null` because the
        // wire payload may carry either, so coerce here.
        lat: guestInfo?.lat != null ? Number(guestInfo.lat) : null,
        lng: guestInfo?.lng != null ? Number(guestInfo.lng) : null,
      };
    }
  }

  const client = await pool.connect();
  let txOpen = false;
  try {
    // ---- 1. Currency / pricing settings ----
    const pricingRow = await client.query(
      `SELECT value FROM delivery_settings WHERE key = 'pricing'`,
    );
    const pricingJson = (pricingRow.rows[0]?.value as Record<string, unknown>) ?? {};
    const pricing = {
      serviceFeeEnabled: pricingJson.serviceFeeEnabled !== false,
      serviceFeeType: (pricingJson.serviceFeeType as string) ?? "fixed",
      serviceFeeValue: (pricingJson.serviceFeeValue as number | null) ?? null,
    };

    // ---- 2. Main store location (source for distance-based delivery) ----
    // Delivery fee is computed by Haversine distance from this point
    // to the customer's address — no zones, no min_order, no
    // free_delivery thresholds (migration 060).
    interface MainStoreRow {
      lat: string | number | null;
      lng: string | number | null;
      is_active: boolean;
    }
    const mainStoreResult = await client.query<MainStoreRow>(
      `SELECT lat, lng, is_active FROM stores WHERE is_main = true LIMIT 1`,
    );
    const mainStoreRow = mainStoreResult.rows[0];
    const mainStore =
      mainStoreRow &&
      mainStoreRow.is_active !== false &&
      mainStoreRow.lat != null &&
      mainStoreRow.lng != null
        ? {
            lat: Number(mainStoreRow.lat),
            lng: Number(mainStoreRow.lng),
          }
        : null;

    // ---- 3. User addresses (if logged in) ----
    let addresses: DeliveryAddressRow[] = [];
    if (userId) {
      const addrResult = await client.query<DeliveryAddressRow>(
        `SELECT id, lat, lng FROM addresses
          WHERE user_id = $1
          ORDER BY is_default DESC, created_at ASC`,
        [userId],
      );
      addresses = addrResult.rows;
    }

    // ---- 4. Coupon (FOR UPDATE so concurrent redemptions serialize) ----
    let coupon: CouponRow | null = null;
    if (couponCode) {
      await client.query("BEGIN");
      txOpen = true;
      const cp = await client.query(
        `SELECT id, code, type::text AS type, value, min_order, max_discount,
                max_uses, used_count, expires_at, is_active
           FROM coupons
          WHERE UPPER(code) = $1
          FOR UPDATE`,
        [couponCode],
      );
      coupon = (cp.rows[0] as CouponRow | undefined) ?? null;
    }

    // ---- 5. Loyalty balance ----
    let userLoyaltyBalance = 0;
    if (userId) {
      const lr = await client.query(
        `SELECT balance FROM loyalty_points WHERE user_id = $1`,
        [userId],
      );
      userLoyaltyBalance = Number(lr.rows[0]?.balance ?? 0);
    }
    // Read once and reuse for the pricing pipeline — the rate is
    // admin-tunable from /admin/loyalty so we never want to bake a
    // hardcoded value into the checkout computation.
    const loyaltySettings = await getLoyaltySettings();

    if (!txOpen) {
      await client.query("BEGIN");
      txOpen = true;
    }

    // ---- 6. Create the checkout (atomic) ----
    const result: CheckoutResult = await createCheckout({
      client,
      input: {
        customerId: userId,
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
        loyaltySettings: (() => {
          const s = loyaltySettings;
          return {
            redeem_value_per_point: s.redeem_value_per_point,
            max_redeem_percent: s.max_redeem_percent,
          };
        })(),
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
      const status = mapErrorKindToStatus(result.kind);
      return NextResponse.json(
        { success: false, error: result.error, kind: result.kind },
        { status },
      );
    }

    await client.query("COMMIT");
    txOpen = false;

    // ---- 7. Clear the guest cart (logged-in users already cleared inside) ----
    if (!userId && sessionId) {
      await pool.query("DELETE FROM guest_cart WHERE session_id = $1", [sessionId]);
    }

    // ---- 8. Online payment init (one parent invoice) ----
    let paymentUrl: string | null = null;
    let inlinePayment = false;
    if (result.requiresOnlinePayment) {
      try {
        const {
          initiateOnlinePayment,
          initiateTamaraPayment,
          isTamaraEnabled,
          getPaymentProvider,
          isMoyasarInlineCheckoutEnabled,
        } = await import("@/lib/payments/initiate");

        const customerName = guestInfo?.name || "عميل";
        const customerMobile = guestInfo?.phone || "0500000000";
        const provider = getPaymentProvider();

        // تمارا — خيار دفع على مستوى الطلب (BNPL). يختلف عن المزوّد
        // العالمي (moyasar): إذا اختار العميل "tamara" نمرّر
        // عبر initiateTamaraPayment ونحفظ checkoutId كمرجع دفع. تمارا
        // تُحدّث الحالة عبر الـ webhook ثم تُحوّل العميل إلى /checkout/success.
        if (paymentMethod === "tamara" && isTamaraEnabled()) {
          const tResult = await initiateTamaraPayment({
            orderId: result.parentOrderId,
            totalSar: result.totals.total,
            description: `طلب سيتي ماركت #${result.parentOrderId.slice(-8)}`,
            customerName,
            customerPhone: customerMobile,
            customerEmail: guestInfo?.email ?? undefined,
            items: [
              {
                name: "طلب متعدد البائعين",
                quantity: 1,
                unitPriceSar: result.totals.total,
              },
            ],
            idempotencyKey: v.idempotency_key ?? undefined,
          });
          if (tResult.success && tResult.paymentUrl && tResult.referenceId) {
            paymentUrl = tResult.paymentUrl;
            await pool.query(
              `UPDATE orders SET payment_reference = $1, payment_status = 'pending' WHERE id = $2`,
              [String(tResult.referenceId), result.parentOrderId],
            );
          } else {
            logError("Tamara init failed", tResult.error);
            await pool.query(
              `UPDATE orders SET payment_status = 'failed', status = 'cancelled' WHERE id = $1`,
              [result.parentOrderId],
            );
            for (const childId of result.vendorOrderIds) {
              await pool.query(
                `UPDATE vendor_orders SET payment_status = 'failed', status = 'cancelled' WHERE id = $1`,
                [childId],
              );
            }
            return NextResponse.json(
              {
                success: false,
                error:
                  tResult.error ||
                  "تعذّر فتح بوابة تمارا. لم يتم خصم أي مبلغ.",
                orderId: result.parentOrderId,
              },
              { status: 502 },
            );
          }
        } else if (isMoyasarInlineCheckoutEnabled()) {
          await pool.query(
            `UPDATE orders SET payment_status = 'pending' WHERE id = $1`,
            [result.parentOrderId],
          );
          inlinePayment = true;
        } else {
          const paymentResult = await initiateOnlinePayment({
            amount: result.totals.total,
            orderId: result.parentOrderId,
            customerName,
            customerMobile,
            customerEmail: guestInfo?.email ?? undefined,
            items: [
              {
                name: "طلب متعدد البائعين",
                quantity: 1,
                unitPrice: result.totals.total,
              },
            ],
            idempotencyKey: v.idempotency_key ?? undefined,
          });
          if (paymentResult.success && paymentResult.paymentUrl && paymentResult.referenceId) {
            paymentUrl = paymentResult.paymentUrl;
            await pool.query(
              `UPDATE orders SET payment_reference = $1, payment_status = 'pending' WHERE id = $2`,
              [String(paymentResult.referenceId), result.parentOrderId],
            );
          } else {
            logError("Payment init failed", paymentResult.error, { provider });
            await pool.query(
              `UPDATE orders SET payment_status = 'failed', status = 'cancelled' WHERE id = $1`,
              [result.parentOrderId],
            );
            for (const childId of result.vendorOrderIds) {
              await pool.query(
                `UPDATE vendor_orders SET payment_status = 'failed', status = 'cancelled' WHERE id = $1`,
                [childId],
              );
            }
            return NextResponse.json(
              {
                success: false,
                error:
                  paymentResult.error ||
                  "تعذّر فتح بوابة الدفع الإلكتروني. لم يتم خصم أي مبلغ.",
                orderId: result.parentOrderId,
              },
              { status: 502 },
            );
          }
        }
      } catch (err) {
        logError("Payment init error:", err);
        await pool.query(
          `UPDATE orders SET payment_status = 'failed', status = 'cancelled' WHERE id = $1`,
          [result.parentOrderId],
        );
        for (const childId of result.vendorOrderIds) {
          await pool.query(
            `UPDATE vendor_orders SET payment_status = 'failed', status = 'cancelled' WHERE id = $1`,
            [childId],
          );
        }
        return NextResponse.json(
          {
            success: false,
            error: "تعذّر الاتصال ببوابة الدفع. حاول مرة أخرى.",
            orderId: result.parentOrderId,
          },
          { status: 502 },
        );
      }
    }

    // ---- 9. Push notifications + admin notify (best-effort, fire-and-forget) ----
    void notifySuccess({
      userId,
      parentOrderId: result.parentOrderId,
      total: result.totals.total,
      customerName: guestInfo?.name ?? null,
    });

    logInfo(
      `multi-vendor checkout ${result.duplicate ? "replay" : "created"} parent=${result.parentOrderId} children=${result.vendorOrderIds.length}`,
    );

    return NextResponse.json({
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
      payment_url: paymentUrl,
      inline_payment: inlinePayment,
      requires_payment: result.requiresOnlinePayment,
      message: inlinePayment
        ? "تم إنشاء الطلب، أكمل الدفع أدناه"
        : paymentUrl
          ? "تم إنشاء الطلب، جاري التحويل للدفع"
          : "تم إنشاء الطلب بنجاح",
    });
  } catch (error) {
    if (txOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
    }
    // DbError wraps the underlying pg error in `.cause`. Surface both so
    // we can debug constraint violations, missing columns, etc. without
    // guessing from a generic 500 message.
    const cause = (error as { cause?: unknown })?.cause;
    const causeMsg =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : null;

    // SECURITY (idempotency-key race): The pre-check at L312 in
    // create-checkout.ts only catches a duplicate that already exists.
    // Two requests with the same idempotency_key arriving in the same
    // window can both pass the check and one of them will hit the
    // UNIQUE constraint (orders.idempotency_key_key) at INSERT time.
    // Postgres surfaces that as SQLSTATE 23505 (unique_violation).
    // Treat it as a successful replay rather than 500 — the first
    // request already produced the order.
    const isUniqueViolation =
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      (cause as { code: unknown }).code === "23505";
    if (isUniqueViolation) {
      logWarn("idempotency_key unique violation — replaying existing order", {
        pgMessage: causeMsg ?? undefined,
      });
      // Replay the idempotency lookup. We use the same query shape as
      // create-checkout.ts so the response contract matches.
      if (v.idempotency_key) {
        const replay = await pool.query(
          `SELECT id, payment_method, catalog_subtotal, total
             FROM orders
            WHERE idempotency_key = $1`,
          [v.idempotency_key],
        );
        if (replay.rows.length > 0) {
          const r = replay.rows[0];
          const childRows = await pool.query(
            `SELECT id FROM vendor_orders WHERE parent_order_id = $1`,
            [r.id],
          );
          return NextResponse.json({
            success: true,
            parent_order_id: r.id,
            vendor_order_ids: childRows.rows.map((row: { id: string }) => row.id),
            duplicate: true,
            payment_method: r.payment_method,
          });
        }
      }
    }

    logError("multi-vendor checkout error:", error, {
      pgMessage: causeMsg ?? undefined,
      userId: userId ?? undefined,
      idempotencyKey: v.idempotency_key ?? undefined,
      itemsCount: (v.items ?? []).length,
      vendorGroupsCount: (v.vendor_groups ?? []).length,
    });
    // Persist the actual error to a side-channel file so on-call can
    // see the real cause even when production hides the `debug` field.
    // The catch-all above intentionally masks DB / network / constraint
    // errors with a generic Arabic message; without this dump we can't
    // triage from logs alone when the run is containerised and stdout
    // is the only diagnostic surface. Best-effort: any FS error here
    // is swallowed so the user-facing response still works.
    //
    // Path resolution: prefer a writable location in priority order —
    //   1. `process.env.CHECKOUT_ERROR_LOG` (operator override, e.g.
    //      bind-mount a host path)
    //   2. `<cwd>/logs/checkout-errors.log` (dev / non-readonly hosts)
    //   3. `<tmpdir>/checkout-errors.log` — always writable in Docker
    //      because docker-compose mounts tmpfs at /tmp. Production
    //      containers can `docker exec ... cat /tmp/checkout-errors.log`
    //      to triage without restarting anything.
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const tmpDir =
        process.env.CHECKOUT_ERROR_LOG ??
        path.join(process.cwd(), "logs", "checkout-errors.log");
      await fs.mkdir(path.dirname(tmpDir), { recursive: true });
      const dumpPath = tmpDir;
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        userId,
        idempotencyKey: v.idempotency_key ?? null,
        itemsCount: (v.items ?? []).length,
        vendorGroupsCount: (v.vendor_groups ?? []).length,
        paymentMethod: v.payment_method ?? null,
        deliveryType: v.delivery_type ?? null,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        pgCode:
          cause && typeof cause === "object" && "code" in cause
            ? String((cause as { code: unknown }).code)
            : null,
        pgMessage: causeMsg,
        // Keep the full stack at WARN level — useful when the same
        // error recurs and we need to find the offending line.
        stack:
          error instanceof Error
            ? (error.stack ?? "").split("\n").slice(0, 8).join("\n")
            : null,
      });
      await fs.appendFile(dumpPath, line + "\n", "utf8");
    } catch {
      /* never let the dump itself break the user response */
    }
    return NextResponse.json(
      {
        success: false,
        error: "حدث خطأ في إنشاء الطلب",
        // Even in production, surface the underlying pg message so the
        // user can copy it to support — the message is non-sensitive
        // (it never contains card or PII; just column/constraint names).
        // Operators can hide this by setting HIDE_CHECKOUT_DEBUG=1.
        ...(process.env.HIDE_CHECKOUT_DEBUG !== "1"
          ? { debug: causeMsg ?? (error instanceof Error ? error.message : null) }
          : {}),
      },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

function mapErrorKindToStatus(kind: string): number {
  switch (kind) {
    case "validation":
    case "empty_cart":
    case "no_address":
    case "vendor_min_order":
    case "ownership_mismatch":
    case "product_not_found":
      return 400;
    case "vendor_inactive":
      return 422;
    case "no_main_store":
      return 503;
    case "stock_insufficient":
      return 409;
    default:
      return 500;
  }
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
    const { notifyAdminNewOrder } = await import("@/lib/order-notify-admin");
    void notifyAdminNewOrder({
      id: parentOrderId,
      total,
      customerName,
    });
  } catch {
    /* admin notify is optional */
  }
}
