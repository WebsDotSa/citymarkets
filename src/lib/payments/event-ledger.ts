/**
 * Payment event ledger helper.
 *
 * Records gateway callbacks (Moyasar, Tamara) in the `payment_events`
 * table defined by migration 073. Designed to be the FIRST call in
 * any webhook handler so replays short-circuit before any order/state
 * mutation occurs.
 *
 * Idempotency contract:
 *   - The caller passes {invoiceId, gateway, eventType, raw}.
 *   - On first call, we INSERT and return 'inserted'.
 *   - On any subsequent call with the same triple, the
 *     UNIQUE INDEX uq_payment_events_invoice_event raises 23505 and we
 *     return 'duplicate'. The caller is expected to ack the duplicate
 *     immediately (HTTP 200 with {duplicate: true}) so the gateway
 *     doesn't retry forever.
 *
 * Why a PoolClient is required:
 *   The webhook runs inside an existing transaction (the rest of the
 *   handler wraps order/state mutation). Passing the client keeps the
 *   ledger INSERT atomic with the rest of the work — if the rest fails
 *   and rolls back, the ledger row rolls back too, and a fresh replay
 *   gets to insert again.
 *
 * Why JSON.stringify here:
 *   pg serialises JS objects to JSONB automatically when given an
 *   object, but pg does NOT serialise `unknown` safely in all paths.
 *   Pre-serialising here makes the type contract explicit and lets us
 *   catch non-serialisable payloads at the boundary.
 */

import type { PoolClient } from "pg";
import { warn, error } from "@/lib/logger";

export type PaymentGateway = "moyasar" | "tamara" | "cod";

export interface RecordPaymentEventArgs {
  invoiceId: string;
  gateway: PaymentGateway;
  eventType: string;
  raw: unknown;
}

export type RecordPaymentEventResult = "inserted" | "duplicate";

export async function recordPaymentEvent(
  client: PoolClient,
  args: RecordPaymentEventArgs,
): Promise<RecordPaymentEventResult> {
  // BUGFIX (audit 2026-09-29): wrap JSON.stringify so a circular ref or
  // BigInt in the gateway payload doesn't bubble up as an unhandled
  // exception that hides the real webhook failure from operators. We
  // log the failure path but persist a safe placeholder so the ledger
  // stays complete (the INSERT is the whole point — losing it would
  // break idempotency on the next replay).
  let rawPayload: string;
  if (typeof args.raw === "string") {
    rawPayload = args.raw;
  } else {
    try {
      rawPayload = JSON.stringify(args.raw);
    } catch (serialiseErr) {
      // Audit I39: canonical logger. The previous inline console.warn
      // bypassed the LOG_LEVEL gate and would fire in production.
      warn(
        "[payment-events] raw payload not JSON-serialisable, storing placeholder",
        { invoiceId: args.invoiceId, gateway: args.gateway, eventType: args.eventType },
      );
      // Pass the serialise error to the error sink so we don't lose it.
      error(
        "[payment-events] serialise error",
        serialiseErr,
        { invoiceId: args.invoiceId, gateway: args.gateway, eventType: args.eventType },
      );
      rawPayload = JSON.stringify({
        __unserialisable: true,
        type: typeof args.raw,
        constructor:
          args.raw && typeof args.raw === "object"
            ? (args.raw as { constructor?: { name?: string } }).constructor?.name
            : null,
      });
    }
  }
  try {
    await client.query(
      `INSERT INTO payment_events
         (invoice_id, gateway, event_type, raw_payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [args.invoiceId, args.gateway, args.eventType, rawPayload],
    );
    return "inserted";
  } catch (e) {
    // 23505 = unique_violation. Anything else is a real failure.
    if (e && typeof e === "object" && (e as { code?: string }).code === "23505") {
      return "duplicate";
    }
    throw e;
  }
}

/**
 * Mark a recorded event as processed/failed with optional order_id link.
 * Called from the webhook handler AFTER the order mutation succeeds (or
 * fails) so the ledger reflects the worker's view, not just the gateway's.
 */
export async function finalizePaymentEvent(
  client: PoolClient,
  args: {
    invoiceId: string;
    gateway: PaymentGateway;
    eventType: string;
    status: "processed" | "failed";
    orderId?: string;
  },
): Promise<void> {
  await client.query(
    `UPDATE payment_events
        SET status = $4,
            processed_at = NOW(),
            order_id = COALESCE($5, order_id)
      WHERE invoice_id = $1
        AND gateway = $2
        AND event_type = $3`,
    [args.invoiceId, args.gateway, args.eventType, args.status, args.orderId ?? null],
  );
}
