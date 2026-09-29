/**
 * Public barrel for the Payments bounded context.
 *
 * Phase 10.3 (domain-modules refactor): the `payments/` folder already
 * existed as a partial extraction (Moyasar, Tamara, event ledger, payment
 * service). This commit adds a public-API barrel so consumers can write
 * `import { authorizeOrderForPayment } from "@/lib/payments"` instead of
 * reaching into individual sub-modules.
 *
 * Internal organization:
 *   - moyasar.ts               — Moyasar invoice + verification
 *   - moyasar-confirm.ts       — confirm paid payment against order
 *   - tamara.ts                — Tamara BNPL checkout + webhook
 *   - initiate.ts              — provider selector (Moyasar / Tamara)
 *   - event-ledger.ts          — append-only payment event ledger
 *   - payment-service.ts       — auth, rate limit, idempotency, lock
 *   - payment-methods.ts       — payment method UI constants + allowed sets
 */

// ── Moyasar ─────────────────────────────────────────────────────────────
export {
  createInvoice,
  fetchInvoice,
  fetchInvoiceDetails,
  fetchPayment,
  getMoyasarApplePayLabel,
  getMoyasarPublishableKey,
  getMoyasarSiteUrl,
  isMoyasarConfigured,
  isMoyasarInlineConfigured,
  toHalalas,
} from "./moyasar";
export type {
  MoyasarInvoiceRequest,
  MoyasarInvoiceResult,
  MoyasarPaymentDetails,
} from "./moyasar";

// ── Moyasar confirm ─────────────────────────────────────────────────────
export { confirmMoyasarPaymentForOrder } from "./moyasar-confirm";
export type { ConfirmMoyasarPaymentResult } from "./moyasar-confirm";

// ── Tamara ──────────────────────────────────────────────────────────────
export {
  createCheckoutSession,
  fetchOrderStatus,
  getTamaraWebhookToken,
  isTamaraConfigured,
  verifyWebhookSignature,
} from "./tamara";
export type { TamaraCheckoutRequest, TamaraCheckoutResult, TamaraOrderStatus } from "./tamara";

// ── Initiate (provider selector) ────────────────────────────────────────
export {
  getPaymentProvider,
  initiateOnlinePayment,
  initiateTamaraPayment,
  isMoyasarInlineCheckoutEnabled,
  isTamaraEnabled,
} from "./initiate";
export type {
  PaymentProviderId,
  UnifiedPaymentRequest,
  UnifiedPaymentResult,
} from "./initiate";

// ── Event ledger (idempotency) ──────────────────────────────────────────
export {
  finalizePaymentEvent,
  recordPaymentEvent,
} from "./event-ledger";
export type {
  PaymentGateway,
  RecordPaymentEventArgs,
  RecordPaymentEventResult,
} from "./event-ledger";

// ── Payment service (auth, rate limit, lock) ────────────────────────────
export {
  applyPaymentRateLimits,
  authorizeOrderForPayment,
  commitOrderLock,
  markOrderPaymentFailed,
  MAX_IDEMPOTENCY_KEY,
  ONLINE_RETRY_METHODS,
  parsePaymentBody,
  rateLimitResponseHeaders,
  resolveCaller,
  rollbackOrderLock,
  validateOrderId,
} from "./payment-service";
export type { AuthorizedOrder, PaymentServiceResult } from "./payment-service";

// ── Payment methods (UI constants) ─────────────────────────────────────
export {
  ALLOWED_METHODS,
  BANK_TRANSFER_DETAILS,
  DISABLED_METHODS,
  NON_ELECTRONIC_METHODS,
  PAYMENT_METHODS_UI,
} from "./payment-methods";
export type { PaymentMethodId, PaymentMethodUi } from "./payment-methods";
