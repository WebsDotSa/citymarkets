import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { applyCsrfProtection } from "@/lib/csrf";
import { error as logError, info as logInfo } from "@/lib/logger";
import { ALLOWED_METHODS } from "@/lib/payments/payment-methods";
import { resolvePaymentMethod } from "@/lib/payments/payment-methods";
import {
  checkRateLimit,
  PAYMENT_METHOD_PATCH_CONFIG,
  PAYMENT_METHOD_PATCH_IP_CONFIG,
  createRateLimitHeaders,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";

import { validateUuidOrError } from "@/lib/api/uuid-guard";
/**
 * PATCH /api/v1/orders/[id]/payment-method
 *
 * Updates the payment method on an EXISTING order — does NOT create a new
 * order. Used by the checkout flow when the user switches payment methods
 * (mada ↔ visa ↔ tamara ↔ cash) so we don't spam the orders /
 * vendor_orders tables with phantom rows just because the user toggled
 * their choice before settling.
 *
 * Auth (ownership):
 *   • Logged-in customer → `orders.user_id = <jwt-userId>`
 *   • Guest              → the body's `idempotency_key` must match the
 *     order's stored `idempotency_key` (this is the secret minted at
 *     checkout time and only the order creator ever sees it).
 *
 * Refuses to touch an order that is already paid / refunded / failed.
 *
 * Body: {
 *   payment_method: 'mada'|'visa'|'mastercard'|'amex'|'apple_pay'|'wallet'|'bank_transfer',
 *   idempotency_key?: string   // required for guest checkouts
 * }
 *
 * Returns: { success: true, order_id, payment_method, payment_status, unchanged? }
 *
 * Operator decision (2026-09-20): `cash`, `stc_pay`, `tamara` removed from
 * the customer-facing picker. They are intentionally NOT in this set so a
 * legacy client cannot silently downgrade the UX back to those flows.
 *
 * Canonical source: imported from `@/lib/payments/payment-methods` to keep
 * this route in sync with the server-wide allowlist (audit H2).
 */
const LOCKED_PAYMENT_STATUSES = new Set(["paid", "failed", "refunded"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // ---- CSRF ----
  const csrf = await applyCsrfProtection(request);
  if (csrf) return csrf;

  const { id: orderId } = await params;
  const badId = validateUuidOrError(orderId, "معرّف الطلب");
  if (badId) return badId;
  if (!orderId || typeof orderId !== "string") {
    return NextResponse.json({ error: "معرّف الطلب مطلوب" }, { status: 400 });
  }

  // ---- Auth (logged-in OR guest via idempotency_key) ----
  const userId = await resolveCustomerUserIdFromRequest(request);

  // ---- Rate limit (PCP-136) ----
  // IP-first so an unauthenticated attacker can't burn the bucket for a
  // legitimate guest session behind the same NAT. The per-user limit is
  // applied AFTER auth so the key reflects the real principal.
  const clientIp = getClientIp(request);
  const ipLimit = await checkRateLimit(clientIp, PAYMENT_METHOD_PATCH_IP_CONFIG);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "تجاوز عدد محاولات تغيير طريقة الدفع. حاول بعد ساعة." },
      { status: 429, headers: createRateLimitHeaders(ipLimit) },
    );
  }
  const principal = userId ?? `guest:${clientIp}`;
  const userLimit = await checkRateLimit(principal, PAYMENT_METHOD_PATCH_CONFIG);
  if (!userLimit.allowed) {
    return NextResponse.json(
      { error: "تجاوز عدد محاولات تغيير طريقة الدفع. حاول بعد ساعة." },
      { status: 429, headers: createRateLimitHeaders(userLimit) },
    );
  }

  // ---- Body ----
  let body: { payment_method?: string; idempotency_key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بيانات غير صالحة" }, { status: 400 });
  }
  const next = (body.payment_method ?? "").trim().toLowerCase();
  if (!ALLOWED_METHODS.has(next)) {
    return NextResponse.json(
      { error: "طريقة الدفع غير مدعومة", allowed: [...ALLOWED_METHODS] },
      { status: 400 },
    );
  }
  const idempotencyKey = (body.idempotency_key ?? "").trim();

  // Canonicalise the requested method to the same mapping the legacy
  // alias table applies at the checkout boundary (PCP-135 sibling —
  // defence in depth: legacy tokens reaching THIS endpoint are rejected
  // by ALLOWED_METHODS above, but a future schema change that re-adds
  // legacy tokens will still be normalised here).
  const canonicalNext = resolvePaymentMethod(next);

  const client = await pool.connect();
  try {
    // ---- Lock the order row + ownership check ----
    // PC P-134: wrap the FOR UPDATE + UPDATE pair in a transaction so
    // (a) the row lock survives until the parent + vendor_orders UPDATEs
    // both land, (b) a concurrent PATCH on the same orderId blocks
    // rather than racing past the payment_status check, and (c) a
    // failure between the two UPDATEs rolls BOTH back instead of
    // leaving parent + children out of sync.
    await client.query("BEGIN");
    try {
      const r = await client.query(
        `SELECT id, user_id, idempotency_key, payment_method, payment_status
           FROM orders
          WHERE id = $1
          FOR UPDATE`,
        [orderId],
      );
      if (r.rows.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
      }
      const row = r.rows[0];

      // Logged-in customer: ownership = orders.user_id matches JWT.
      // Guest: ownership = body's idempotency_key matches stored one (the
      // server-minted secret only the order creator ever sees).
      let isOwner = false;
      if (userId && row.user_id === userId) {
        isOwner = true;
      } else if (!row.user_id && idempotencyKey && row.idempotency_key === idempotencyKey) {
        isOwner = true;
      }
      if (!isOwner) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "غير مصرح بتعديل هذا الطلب" },
          { status: 403 },
        );
      }

      // ---- Refuse to touch a paid / cancelled / refunded order ----
      if (LOCKED_PAYMENT_STATUSES.has(row.payment_status)) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error: `لا يمكن تغيير طريقة الدفع لأن حالة الدفع ${row.payment_status}`,
            current_status: row.payment_status,
          },
          { status: 409 },
        );
      }

      // ---- No-op if same method (compare case-insensitively, canonical form) ----
      const rowMethod = (row.payment_method ?? "").toLowerCase();
      if (rowMethod === canonicalNext) {
        await client.query("COMMIT");
        return NextResponse.json({
          success: true,
          order_id: orderId,
          payment_method: canonicalNext,
          payment_status: row.payment_status,
          unchanged: true,
        });
      }

      // ---- Apply the change atomically ----
      // Use a CTE so the parent + every child row flip together inside
      // the same statement — half-applied updates are impossible.
      const upd = await client.query(
        `WITH parent_upd AS (
           UPDATE orders
              SET payment_method = $1
            WHERE id = $2
           RETURNING id
         )
         UPDATE vendor_orders
            SET payment_method = $1
          WHERE parent_order_id IN (SELECT id FROM parent_upd)`,
        [canonicalNext, orderId],
      );
      if ((upd.rowCount ?? 0) === 0) {
        // No children exist yet — order was created without vendor
        // groups (catalog-only legacy path). The parent UPDATE in the
        // CTE already landed; commit and proceed.
      }

      await client.query("COMMIT");

      logInfo(
        `[orders/payment-method] ${orderId} ${row.payment_method ?? "null"} → ${canonicalNext} (userId=${userId ?? "guest"})`,
      );

      return NextResponse.json({
        success: true,
        order_id: orderId,
        payment_method: canonicalNext,
        payment_status: row.payment_status,
      });
    } catch (inner) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw inner;
    }
  } catch (err) {
    logError("[orders/payment-method] error:", err);
    return NextResponse.json(
      { error: "تعذّر تحديث طريقة الدفع" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
