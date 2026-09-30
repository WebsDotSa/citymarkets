import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';
import {
  reconcilePayment,
  type ReconcileOrderRow,
  type PaymentDbStatus,
} from '@/lib/payments/reconcile-payment';
import type { PaymentGateway } from '@/lib/payments/event-ledger';

/**
 * POST /api/v1/payments/_dev/simulate
 *
 * QA helper for driving the reconciliation pipeline without a live
 * payment-gateway round-trip. Useful for:
 *   - Local end-to-end checkout tests (no ngrok, no Moyasar sandbox).
 *   - Re-running a webhook scenario after a schema change to confirm
 *     the new flow still flips the order / loyalty / abandoned-cart
 *     surfaces correctly.
 *   - Recovering from a stuck order in dev (e.g. webhook never
 *     arrived but the gateway says paid) — fire a synthetic callback.
 *
 * Body:
 *   {
 *     invoice_id:    string  — Moyasar/Tamara payment id (orders.payment_reference)
 *     status:        "paid" | "failed" | "refunded"
 *     gateway?:      "moyasar" | "tamara" | "cod"   (default "moyasar")
 *     event_type?:   string  (default "payment_paid" / "payment_failed" / "payment_refunded")
 *     raw?:          object  — payload recorded in payment_events.raw_payload
 *   }
 *
 * Security:
 *   - Hard 404 in production. NODE_ENV !== 'production' gate at the
 *     very top of the handler so we never accidentally expose it.
 *   - Optional bearer-token gate via DEV_SIMULATE_TOKEN env var.
 *     When unset, the endpoint is open (still gated by NODE_ENV).
 *     When set, the Authorization header must match.
 *   - Records every call with an audit log line that includes the
 *     operator's ip + payload so misuse is traceable.
 *
 * Phase 3-8 (full-system audit 2026-09-30).
 */

const SIMULATABLE_STATUSES = ['paid', 'failed', 'refunded'] as const;
type SimulatableStatus = (typeof SIMULATABLE_STATUSES)[number];

function statusToEventType(s: SimulatableStatus): string {
  if (s === 'paid') return 'payment_paid';
  if (s === 'failed') return 'payment_failed';
  return 'payment_refunded';
}

function statusToPaymentDb(s: SimulatableStatus): PaymentDbStatus {
  // 'refunded' is a terminal state distinct from 'failed'; the
  // reconciliation helper only accepts the three canonical statuses
  // ('paid' | 'failed' | 'pending'), so we collapse refunded → paid
  // and rely on the order-status config to reflect the refund on
  // the lifecycle column if needed. The audit row in payment_events
  // preserves the original "refunded" status for forensics.
  return s === 'failed' ? 'failed' : 'paid';
}

function verifyDevAuth(request: NextRequest): boolean {
  const expected = process.env.DEV_SIMULATE_TOKEN?.trim();
  if (!expected) return true; // token unset → open (still NODE_ENV-gated)
  const auth = request.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return false;
  // Constant-time compare without importing crypto (cheap on a short
  // shared-secret string; good-enough for a non-production helper).
  if (token.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!verifyDevAuth(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const invoiceId =
    typeof body.invoice_id === 'string' && body.invoice_id.trim()
      ? body.invoice_id.trim()
      : '';
  if (!invoiceId) {
    return NextResponse.json(
      { error: 'invoice_id is required' },
      { status: 400 },
    );
  }

  const status: SimulatableStatus =
    typeof body.status === 'string' &&
    (SIMULATABLE_STATUSES as readonly string[]).includes(body.status)
      ? (body.status as SimulatableStatus)
      : 'paid';

  const gateway: PaymentGateway =
    body.gateway === 'tamara' || body.gateway === 'cod'
      ? body.gateway
      : 'moyasar';

  const eventType =
    typeof body.event_type === 'string' && body.event_type.trim()
      ? body.event_type.trim()
      : statusToEventType(status);

  const rawPayload =
    body.raw && typeof body.raw === 'object'
      ? body.raw
      : { __simulated: true, status, gateway };

  logInfo('[dev-simulate] driving reconciliation', {
    invoiceId,
    status,
    gateway,
    eventType,
    ip: request.headers.get('x-forwarded-for') ?? 'unknown',
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query<ReconcileOrderRow & {
      payment_reference: string | null;
    }>(
      `SELECT id, total::text AS total,
              catalog_subtotal::text AS catalog_subtotal,
              user_id::text AS user_id,
              points_redeemed::text AS points_redeemed,
              guest_phone,
              payment_reference
         FROM orders
        WHERE payment_reference = $1
        LIMIT 1`,
      [invoiceId],
    );

    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: 'no order found for the given invoice_id',
          invoice_id: invoiceId,
        },
        { status: 404 },
      );
    }

    const orderRow = orderResult.rows[0];

    const result = await reconcilePayment(client, {
      invoiceId,
      gateway,
      eventType,
      paymentDb: statusToPaymentDb(status),
      rawBody: { ...(rawPayload as Record<string, unknown>), __simulated: true },
      orderRow,
    });

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      simulated: true,
      invoice_id: invoiceId,
      status,
      gateway,
      event_type: eventType,
      order_id: orderRow.id,
      recovered_count: result.recoveredCount,
      duplicate: result.duplicate,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    logError('[dev-simulate] reconciliation failed', err, { invoiceId });
    return NextResponse.json(
      { error: 'simulation failed', detail: String((err as Error)?.message ?? err) },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

/**
 * GET handler so a smoke-test (curl/Postman) can confirm the endpoint
 * is reachable without having to construct a body. Same prod gate as
 * POST — production sees 404.
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({
    status: 'ok',
    endpoint: 'POST /api/v1/payments/_dev/simulate',
    body_shape: {
      invoice_id: 'string — orders.payment_reference value',
      status: 'paid | failed | refunded',
      gateway: 'moyasar | tamara | cod  (default moyasar)',
      event_type: 'string (optional, auto-derived from status)',
      raw: 'object (optional, recorded in payment_events.raw_payload)',
    },
    env_gated:
      process.env.DEV_SIMULATE_TOKEN
        ? 'Bearer token required (DEV_SIMULATE_TOKEN)'
        : 'open (no DEV_SIMULATE_TOKEN configured)',
  });
}

// Surface a friendly warning on module load so the operator remembers
// the gate when running locally. Single-shot — only fires once per
// process start, not per request.
logWarn(
  '[dev-simulate] QA simulate route enabled (NODE_ENV=' +
    (process.env.NODE_ENV ?? 'undefined') +
    ')',
);
