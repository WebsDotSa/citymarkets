/**
 * Public barrel for the Payments bounded context.
 *
 * Recreated during the Phase 5 (domain-guard codemod, audit 2026-09-30)
 * after Phase A3 deleted the legacy `src/lib/payments/index.ts` while
 * collapsing `payment-service.ts` into `@/lib/payments/payment-service`
 * (and a parallel cleanup removed dead re-exports). The 13 deep-import
 * violations across the codebase force us back into having a barrel —
 * re-created with the safety rules from the old barrel intact:
 *
 *   - Server-only. Every re-exported module imports `pg` or
 *     `next/server` — DO NOT add anything that touches the client
 *     bundle (no `push`, no `analytics`).
 *   - No client-bundled helpers. UI metadata lives in
 *     `payment-methods.ts` but that module is also pure (no DB /
 *     `next/headers`), so it is safe to import from server contexts.
 *
 * Internal organization:
 *   - payment-methods.ts        — canonical method ids + helpers (pure)
 *   - payment-service.ts        — DB-backed authorize/lock/fail pipeline
 *   - event-ledger.ts           — append-only payment event log
 *   - moyasar*                  — Moyasar webhook + initiate helpers
 *   - reconcile-payment.ts      — reconciliation worker
 *   - initiate.ts               — initiate-payment helpers
 *   - webhook-auth.ts           — HMAC verification for webhook bodies
 *   - tamara.ts                 — Tamara webhook (pay-later) integration
 */

// ── Payment methods (pure helpers + types) ──────────────────────────────
export {
  ALLOWED_METHODS,
  ALL_PAYMENT_METHODS,
  ALL_PAYMENT_METHODS_SET,
  BANK_TRANSFER_DETAILS,
  LEGACY_PAYMENT_METHODS,
  NON_ELECTRONIC_METHODS,
  ONLINE_RETRY_METHODS,
  ONLINE_RETRY_METHODS_SET,
  PAYMENT_METHODS_UI,
  PAYMENT_METHOD_ALIAS_MAP,
  resolvePaymentMethod,
} from "./payment-methods";
export type { PaymentMethodId, PaymentMethodUi } from "./payment-methods";

// ── Payment service (DB-backed) ─────────────────────────────────────────
export {
  applyPaymentRateLimits,
  authorizeOrderForPayment,
  commitOrderLock,
  markOrderPaymentFailed,
  MAX_IDEMPOTENCY_KEY,
  parsePaymentBody,
  rateLimitResponseHeaders,
  resolveCaller,
  rollbackOrderLock,
  validateOrderId,
} from "./payment-service";
export type {
  AuthorizedOrder,
  PaymentServiceResult,
} from "./payment-service";

// ── Event ledger (DB-backed) ────────────────────────────────────────────
export {
  finalizePaymentEvent,
  recordPaymentEvent,
} from "./event-ledger";
export type {
  PaymentGateway,
  RecordPaymentEventArgs,
  RecordPaymentEventResult,
} from "./event-ledger";

// ── Reconciliation worker (DB-backed) ───────────────────────────────────
export { reconcilePayment } from "./reconcile-payment";
export type {
  PaymentDbStatus,
  ReconcileArgs,
  ReconcileOrderRow,
  ReconcileResult,
} from "./reconcile-payment";
