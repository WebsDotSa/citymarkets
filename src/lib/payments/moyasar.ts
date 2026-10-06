/**
 * Moyasar — فواتير إلكترونية (Hosted Checkout)
 * https://docs.moyasar.com/api/invoices/01-create-invoice/
 */

import { error as logError } from '@/lib/logger';

const MOYASAR_API_BASE =
  process.env.MOYASAR_API_BASE_URL || 'https://api.moyasar.com/v1';

const MOYASAR_SECRET_KEY = process.env.MOYASAR_SECRET_KEY;
const MOYASAR_PUBLISHABLE_KEY = process.env.MOYASAR_PUBLISHABLE_KEY;

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
  'https://citymarkets.sa';

export interface MoyasarInvoiceRequest {
  amount: number;
  orderId: string | number;
  description: string;
  customerName?: string;
  /**
   * Idempotency key forwarded to Moyasar as `idempotency_key` in the
   * create-invoice body. When the same key is sent twice within the
   * provider's idempotency window (~24h), Moyasar returns the original
   * invoice instead of creating a new one — closing the duplicate-charge
   * race when a customer double-clicks "تأكيد الطلب" and the second
   * request slips past the client-side ref lock.
   *
   * Recommended: a UUIDv4 generated per checkout session by the client
   * and passed through to /api/v1/orders → initiateOnlinePayment.
   */
  idempotencyKey?: string;
}

export interface MoyasarInvoiceResult {
  success: boolean;
  paymentUrl?: string;
  invoiceId?: string;
  error?: string;
}

function authHeader(): string {
  if (!MOYASAR_SECRET_KEY) {
    throw new Error('MOYASAR_SECRET_KEY not configured');
  }
  const token = Buffer.from(`${MOYASAR_SECRET_KEY}:`).toString('base64');
  return `Basic ${token}`;
}

/**
 * BUGFIX (audit 2026-09-29): sanitize the gateway error string before
 * returning it to the caller. Moyasar sometimes returns raw English
 * messages (e.g. "amount is required") and at other times returns its
 * own internal status code text ("Moyasar HTTP 502"). We don't want
 * either to surface to customers — log the raw form for ops and
 * translate the well-known shapes into friendly Arabic.
 *
 * Unrecognized payloads fall back to a generic Arabic message so a
 * payload-leak cannot accidentally surface technical detail.
 */
function sanitizeGatewayError(
  rawMessage: string | undefined,
  status: number,
): string {
  const safeMessage = (rawMessage || '').toString().slice(0, 200);
  // Log the raw gateway detail server-side before sanitising.
  logError('Moyasar gateway error (sanitised)', {
    status,
    raw: safeMessage,
  });

  const lower = safeMessage.toLowerCase();
  if (lower.includes('amount')) return 'قيمة الطلب غير صحيحة';
  if (lower.includes('currency')) return 'عملة الدفع غير مدعومة';
  if (lower.includes('callback') || lower.includes('success_url') || lower.includes('back_url')) {
    return 'إعدادات رابط الدفع غير مكتملة، يرجى التواصل مع الدعم';
  }
  if (status === 401 || status === 403) return 'تعذّر التحقق من بوابة الدفع';
  if (status === 429) return 'طلبات كثيرة على بوابة الدفع، حاول بعد قليل';
  if (status >= 500) return 'بوابة الدفع غير متاحة مؤقتاً، حاول بعد قليل';
  if (status >= 400) return 'تعذّر إنشاء الفاتورة، حاول مرة أخرى';
  // Unknown shape — keep it generic rather than echoing gateway detail.
  return 'تعذّر إتمام عملية الدفع، حاول لاحقاً';
}

/** المبلغ بالهللة (1 ريال = 100) */
export function toHalalas(sarAmount: number): number {
  return Math.max(100, Math.round(sarAmount * 100));
}

export async function createInvoice(
  request: MoyasarInvoiceRequest
): Promise<MoyasarInvoiceResult> {
  if (!MOYASAR_SECRET_KEY) {
    return { success: false, error: 'مفتاح ميسر غير مُعدّ' };
  }

  const orderIdStr = String(request.orderId);
  const amountHalalas = toHalalas(request.amount);
  const successUrl = `${SITE_URL}/checkout/success?order_id=${encodeURIComponent(orderIdStr)}`;
  const backUrl = `${SITE_URL}/checkout`;
  // Server-side webhook callback — points at the canonical Moyasar
  // webhook (HMAC-authenticated, writes to the payment_events ledger,
  // awards loyalty, fans out to vendor_orders). The legacy browser
  // callback route was retired as part of the 2026-09-29
  // production-completion audit: it duplicated state changes without
  // the ledger, silently dropping loyalty and fan-out.
  const callbackUrl = `${SITE_URL}/api/v1/payments/webhook`;

  try {
    // Pass `methods` explicitly so the hosted invoice always shows every
    // enabled channel (mada / cards / applepay / stcpay) regardless of any
    // method-restriction settings in the Moyasar dashboard. Without this
    // Moyasar falls back to the dashboard defaults and a single missing
    // toggle silently hides the option from customers.
    const response = await fetch(`${MOYASAR_API_BASE}/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(),
        Accept: 'application/json',
      },
      body: JSON.stringify({
        amount: amountHalalas,
        currency: 'SAR',
        description: request.description.slice(0, 500),
        success_url: successUrl,
        back_url: backUrl,
        callback_url: callbackUrl,
        methods: ['card', 'mada', 'applepay', 'stcpay'],
        metadata: {
          order_id: orderIdStr,
          customer_name: request.customerName?.slice(0, 100) || '',
        },
        // SECURITY (Pay-Dup): forward the idempotency key so a retried
        // create-invoice call returns the same invoice rather than
        // creating a new one. The provider enforces the window; we don't
        // need to track it client-side.
        ...(request.idempotencyKey
          ? { idempotency_key: request.idempotencyKey.slice(0, 64) }
          : {}),
      }),
    });

    const data = (await response.json()) as {
      id?: string;
      url?: string;
      message?: string;
      errors?: Record<string, string[]>;
    };

    if (!response.ok) {
      const rawMessage =
        data.message ||
        (data.errors && Object.values(data.errors).flat().join(', ')) ||
        `Moyasar HTTP ${response.status}`;
      // BUGFIX (audit 2026-09-29): surface a sanitised Arabic error
      // rather than echoing the raw gateway message. See sanitizeGatewayError.
      return { success: false, error: sanitizeGatewayError(rawMessage, response.status) };
    }

    if (!data.id || !data.url) {
      return { success: false, error: 'استجابة غير صالحة من ميسر' };
    }

    return {
      success: true,
      paymentUrl: data.url,
      invoiceId: data.id,
    };
  } catch (error: unknown) {
    // BUGFIX (audit 2026-09-29): previously this returned
    // `error.message` ("ECONNRESET" etc.) to the caller — replaced
    // with a generic Arabic message. The raw error is still logged
    // server-side.
    logError('Moyasar createInvoice error', error);
    return { success: false, error: 'تعذّر الاتصال بميسر' };
  }
}

export async function fetchInvoiceDetails(invoiceId: string): Promise<{
  success: boolean;
  status?: string;
  amountHalalas?: number;
  error?: string;
}> {
  if (!MOYASAR_SECRET_KEY) {
    return { success: false, error: 'مفتاح ميسر غير مُعدّ' };
  }

  try {
    const response = await fetch(
      `${MOYASAR_API_BASE}/invoices/${encodeURIComponent(invoiceId)}`,
      {
        headers: {
          Authorization: authHeader(),
          Accept: 'application/json',
        },
        cache: 'no-store',
      }
    );

    const data = (await response.json()) as {
      status?: string;
      amount?: number;
      message?: string;
    };

    if (!response.ok) {
      // BUGFIX (audit 2026-09-29): same sanitisation as createInvoice —
      // do not echo the raw `data.message` to the caller.
      return {
        success: false,
        error: sanitizeGatewayError(data.message || `HTTP ${response.status}`, response.status),
      };
    }

    return {
      success: true,
      status: data.status,
      amountHalalas: data.amount,
    };
  } catch (error: unknown) {
    // BUGFIX (audit 2026-09-29): the previous `error.message` could
    // surface the raw fetch failure (DNS error, ECONNREFUSED, …) to
    // callers. Replace with a friendly Arabic message.
    logError('Moyasar fetchInvoiceDetails error', error);
    return { success: false, error: 'تعذّر الاتصال ببوابة الدفع' };
  }
}

export async function fetchInvoice(invoiceId: string): Promise<{
  success: boolean;
  status?: string;
  error?: string;
}> {
  if (!MOYASAR_SECRET_KEY) {
    return { success: false, error: 'مفتاح ميسر غير مُعدّ' };
  }

  try {
    const response = await fetch(
      `${MOYASAR_API_BASE}/invoices/${encodeURIComponent(invoiceId)}`,
      {
        headers: {
          Authorization: authHeader(),
          Accept: 'application/json',
        },
        cache: 'no-store',
      }
    );

    const data = (await response.json()) as { status?: string; message?: string };

    if (!response.ok) {
      // BUGFIX (audit 2026-09-29): sanitise — do not echo raw `data.message`.
      return {
        success: false,
        error: sanitizeGatewayError(data.message || `HTTP ${response.status}`, response.status),
      };
    }

    return { success: true, status: data.status };
  } catch (error: unknown) {
    // BUGFIX (audit 2026-09-29): never echo raw fetch-failure text.
    logError('Moyasar fetchInvoice error', error);
    return { success: false, error: 'تعذّر الاتصال ببوابة الدفع' };
  }
}

export function isMoyasarConfigured(): boolean {
  return Boolean(MOYASAR_SECRET_KEY?.trim());
}

export function isMoyasarInlineConfigured(): boolean {
  return Boolean(
    MOYASAR_SECRET_KEY?.trim() && MOYASAR_PUBLISHABLE_KEY?.trim()
  );
}

export function getMoyasarPublishableKey(): string | null {
  const key = MOYASAR_PUBLISHABLE_KEY?.trim();
  return key || null;
}

export function getMoyasarSiteUrl(): string {
  return SITE_URL;
}

const DEFAULT_APPLE_PAY_LABEL = 'City Markets';

/**
 * Apple Pay merchant label shown on the payment sheet. moyasar-payment-form
 * rejects any non-printable-ASCII label ("label should be English characters
 * only") and renders "Form configuration issue!" instead of the button, so an
 * Arabic/invalid value falls back to the English brand name.
 */
export function getMoyasarApplePayLabel(): string {
  const label = process.env.MOYASAR_APPLE_PAY_LABEL?.trim();
  return label && /^[\x20-\x7E]+$/.test(label) ? label : DEFAULT_APPLE_PAY_LABEL;
}

export interface MoyasarPaymentDetails {
  success: boolean;
  id?: string;
  status?: string;
  amountHalalas?: number;
  currency?: string;
  metadata?: Record<string, string>;
  error?: string;
}

export async function fetchPayment(
  paymentId: string
): Promise<MoyasarPaymentDetails> {
  if (!MOYASAR_SECRET_KEY) {
    return { success: false, error: 'مفتاح ميسر غير مُعدّ' };
  }

  try {
    const response = await fetch(
      `${MOYASAR_API_BASE}/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: {
          Authorization: authHeader(),
          Accept: 'application/json',
        },
        cache: 'no-store',
      }
    );

    const data = (await response.json()) as {
      id?: string;
      status?: string;
      amount?: number;
      currency?: string;
      metadata?: Record<string, string>;
      message?: string;
    };

    if (!response.ok) {
      // BUGFIX (audit 2026-09-29): sanitise the error string instead
      // of leaking the raw gateway `data.message`.
      return {
        success: false,
        error: sanitizeGatewayError(data.message || `HTTP ${response.status}`, response.status),
      };
    }

    return {
      success: true,
      id: data.id,
      status: data.status,
      amountHalalas: data.amount,
      currency: data.currency,
      metadata: data.metadata,
    };
  } catch (error: unknown) {
    // BUGFIX (audit 2026-09-29): never echo raw fetch-failure text.
    logError('Moyasar fetchPayment error', error);
    return { success: false, error: 'تعذّر الاتصال ببوابة الدفع' };
  }
}

/**
 * FIX (P1-4): single source of truth for mapping a Moyasar payment
 * status to our `orders.payment_status` column value. Previously the
 * canonical webhook (`mapPaymentDbStatus`) and the inline-confirm helper
 * (`moyasar-confirm.ts`) had two different maps: `refunded` mapped to
 * `pending` in the webhook but to `failed` in inline-confirm. A refund
 * event therefore ended up with inconsistent payment_status depending
 * on which path the customer's gateway confirmed through.
 *
 * Mapping:
 *   paid, captured        → 'paid'
 *   failed, voided, refunded → 'failed'
 *   anything else         → 'pending'  (initial webhook; awaiting terminal state)
 *
 * `refunded` is treated as `failed` because it's a terminal negative
 * state from the customer's perspective (money is no longer with the
 * marketplace). The webhook's previous 'pending' mapping would have
 * left the row stuck at payment_status='pending' after a refund.
 */
export function mapMoyasarStatusToDb(remote: string): "paid" | "failed" | "pending" {
  if (remote === "paid" || remote === "captured") return "paid";
  if (remote === "failed" || remote === "voided" || remote === "refunded") return "failed";
  return "pending";
}

/**
 * FIX (P1-3): case-insensitive currency comparison shared by the
 * webhook and inline-confirm. The previous webhook code did
 * `remote.currency.toUpperCase() !== "SAR"` while confirm did
 * `payment.currency !== 'SAR'` — a lowercase `"sar"` from the
 * gateway passed confirm but failed the webhook.
 *
 * Returns `true` when the currency is SAR (or absent — gateways
 * occasionally omit currency for refund/void events).
 */
export function isSarCurrency(currency: string | undefined | null): boolean {
  if (!currency) return true;
  return currency.trim().toUpperCase() === "SAR";
}
