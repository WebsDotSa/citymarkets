/**
 * Tamara — Buy Now Pay Later (BNPL) checkout session provider.
 *
 * Tamara is a Saudi-based "pay in 3 or 4" provider. The flow is:
 *   1. Server calls POST /checkout with order details + customer info.
 *      Tamara returns a `checkout_id` + `payment_url` that we redirect the
 *      customer to.
 *   2. Customer authenticates with Tamara on their hosted page, picks an
 *      instalment plan, and confirms.
 *   3. Tamara POSTs a webhook to our backend (see /api/v1/payments/tamara/webhook)
 *      with the order status (`approved`, `declined`, `expired`).
 *   4. After the customer finishes on Tamara, they land back on our
 *      `success_url` with `?order_id=...&paymentStatus=approved` so the
 *      checkout success page can show the right banner.
 *
 * Sandbox: https://api-sandbox.tamara.co  (no real money, test cards).
 * Live:    https://api.tamara.co
 *
 * Docs: https://docs.tamara.co/
 */

import { error as logError, warn as logWarn } from '@/lib/logger';
import { verifyWebhookToken } from './webhook-secrets';

const TAMARA_API_BASE =
  process.env.TAMARA_API_BASE_URL ||
  (process.env.TAMARA_ENV === 'live'
    ? 'https://api.tamara.co'
    : 'https://api-sandbox.tamara.co');

const TAMARA_API_TOKEN = process.env.TAMARA_API_TOKEN?.trim() || null;
const TAMARA_WEBHOOK_TOKEN = process.env.TAMARA_WEBHOOK_TOKEN?.trim() || null;

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
  'https://citymarkets.sa';

export interface TamaraCheckoutRequest {
  orderId: string;
  totalSar: number;
  description: string;
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  shippingAddress?: {
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postalCode?: string;
  };
  items: Array<{ name: string; quantity: number; unitPriceSar: number }>;
  /** Number of instalments — Tamara supports 2, 3, 4, 5, 6, 12. Default 3. */
  instalments?: number;
  /** Merchant-supplied idempotency token for safe retries. */
  idempotencyKey?: string;
}

export interface TamaraCheckoutResult {
  success: boolean;
  paymentUrl?: string;
  checkoutId?: string;
  error?: string;
}

export function isTamaraConfigured(): boolean {
  return Boolean(TAMARA_API_TOKEN);
}

export function getTamaraWebhookToken(): string | null {
  return TAMARA_WEBHOOK_TOKEN;
}

export interface TamaraOrderStatus {
  success: boolean;
  status?: string;
  amount?: number;
  currency?: string;
  error?: string;
}

/**
 * Create a Tamara checkout session. Returns the hosted payment URL the
 * customer should be redirected to. The merchant URL is wired to our
 * checkout success page so the customer lands back where they started.
 *
 * NB: Tamara's API rejects orders under ~50 SAR — they enforce a
 * minimum checkout amount for BNPL. We surface the error verbatim so
 * the customer sees "المبلغ أقل من الحد الأدنى لتمارا" instead of a
 * generic 500.
 */
export async function createCheckoutSession(
  request: TamaraCheckoutRequest
): Promise<TamaraCheckoutResult> {
  if (!TAMARA_API_TOKEN) {
    return {
      success: false,
      error: 'بوابة تمارا غير مُفعّلة — أضف TAMARA_API_TOKEN في .env.local',
    };
  }

  const totalHalalas = Math.max(100, Math.round(request.totalSar * 100));
  const [firstName, ...rest] = (request.customerName || 'عميل').split(' ');
  const lastName = rest.join(' ') || firstName;

  const instalments = request.instalments ?? 3;

  // Tamara requires a country_code for the addresses. Saudi Arabia is
  // our only market — fix the value rather than guess from the form.
  const baseAddress = {
    first_name: firstName.slice(0, 50),
    last_name: lastName.slice(0, 50),
    line1: (request.shippingAddress?.line1 || 'Riyadh').slice(0, 200),
    line2: (request.shippingAddress?.line2 || '').slice(0, 200),
    city: (request.shippingAddress?.city || 'Riyadh').slice(0, 50),
    region: (request.shippingAddress?.region || 'Riyadh Region').slice(0, 50),
    postal_code: (request.shippingAddress?.postalCode || '11564').slice(0, 20),
    country_code: 'SA',
  };

  const payload = {
    order_reference_id: request.orderId.slice(0, 64),
    total_amount: {
      amount: totalHalalas,
      currency: 'SAR',
    },
    description: request.description.slice(0, 500),
    country_code: 'SA',
    payment_type: 'PAY_BY_INSTALMENTS',
    instalments,
    locale: 'ar_SA',
    customer: {
      first_name: baseAddress.first_name,
      last_name: baseAddress.last_name,
      email: (request.customerEmail || `${firstName.toLowerCase()}@citymarkets.sa`).slice(0, 100),
      phone_number: request.customerPhone.replace(/[^0-9+]/g, '').slice(0, 30) || '0500000000',
    },
    shipping_address: baseAddress,
    billing_address: baseAddress,
    merchant_url: {
      success: `${SITE_URL}/checkout/success?order_id=${encodeURIComponent(request.orderId)}&paymentStatus=approved`,
      failure: `${SITE_URL}/checkout/error?order_id=${encodeURIComponent(request.orderId)}`,
      cancel: `${SITE_URL}/checkout?order_id=${encodeURIComponent(request.orderId)}`,
      notification: `${SITE_URL}/api/v1/payments/tamara/webhook`,
    },
    items: (request.items.length > 0 ? request.items : [
      { name: request.description, quantity: 1, unitPriceSar: request.totalSar },
    ]).map((it) => ({
      name: it.name.slice(0, 200),
      type: 'physical',
      sku: 'cm-' + request.orderId.replace(/-/g, '').slice(0, 12),
      quantity: it.quantity,
      unit_price: {
        amount: Math.max(100, Math.round(it.unitPriceSar * 100)),
        currency: 'SAR',
      },
      total_amount: {
        amount: Math.max(100, Math.round(it.unitPriceSar * it.quantity * 100)),
        currency: 'SAR',
      },
      discount_amount: { amount: 0, currency: 'SAR' },
    })),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${TAMARA_API_TOKEN}`,
  };
  if (request.idempotencyKey) {
    headers['Idempotency-Key'] = request.idempotencyKey.slice(0, 64);
  }

  try {
    const response = await fetch(`${TAMARA_API_BASE}/checkout`, {
      method: 'POST',
      headers,
      cache: 'no-store',
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data: {
      checkout_id?: string;
      payment_url?: string;
      status?: string;
      message?: string;
      errors?: Record<string, string[] | string>;
    };
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text.slice(0, 200) || `HTTP ${response.status}` };
    }

    if (!response.ok) {
      const msg =
        data.message ||
        (data.errors && Object.values(data.errors).flat().join(', ')) ||
        `Tamara HTTP ${response.status}`;
      logWarn('Tamara create-checkout rejected', { status: response.status, msg });
      return { success: false, error: msg };
    }

    if (!data.checkout_id || !data.payment_url) {
      return { success: false, error: 'استجابة غير صالحة من تمارا' };
    }

    return {
      success: true,
      checkoutId: data.checkout_id,
      paymentUrl: data.payment_url,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل الاتصال بتمارا';
    logError('Tamara create-checkout error', error);
    return { success: false, error: message };
  }
}

/**
 * Fetch the current status of a Tamara order (e.g. for the success page
 * to confirm the payment went through). Returns the raw status string
 * from Tamara — the caller maps it to our internal enum.
 */
export async function fetchOrderStatus(
  checkoutId: string
): Promise<TamaraOrderStatus> {
  if (!TAMARA_API_TOKEN) {
    return { success: false, error: 'تمارا غير مُعدّ' };
  }
  try {
    const response = await fetch(
      `${TAMARA_API_BASE}/orders/${encodeURIComponent(checkoutId)}`,
      {
        headers: {
          Authorization: `Bearer ${TAMARA_API_TOKEN}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      }
    );
    const data = (await response.json()) as {
      status?: string;
      total_amount?: { amount?: number; currency?: string };
      message?: string;
    };
    if (!response.ok) {
      return { success: false, error: data.message || `HTTP ${response.status}` };
    }
    return {
      success: true,
      status: data.status,
      amount: data.total_amount?.amount,
      currency: data.total_amount?.currency,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'fetch failed';
    return { success: false, error: message };
  }
}

/**
 * Verify a Tamara webhook signature. Tamara sends an `Authorization`
 * header of the form `Bearer <webhook_token>`. We compare it against
 * the active secret registry in the `webhook_secrets` table, with
 * fallback to the legacy single env-var `TAMARA_WEBHOOK_TOKEN`.
 *
 * SECURITY (F5): Previously this returned `true` when no token was
 * configured (dev convenience). Combined with `ALLOW_INSECURE_WEBHOOK=1`
 * accidentally reaching production, that allowed forged webhooks. We now
 * hard-fail unless a token is configured (via DB row or env) — callers
 * that genuinely need unsigned webhooks for local dev should mock this
 * function in their test harness instead of relying on the production
 * code path.
 *
 * P0-2 (security Phase 1, 2026-10-03): now async to support the DB
 * lookup. Tests that mock this function must mock it as async.
 */
export async function verifyWebhookSignature(
  authorizationHeader: string | null,
): Promise<boolean> {
  if (!authorizationHeader) return false;

  // The header may be "Bearer <token>" or just "<token>". Match the
  // behaviour of the route handler (which slices "Bearer " prefix).
  const token = authorizationHeader.startsWith('Bearer ')
    ? authorizationHeader.slice(7).trim()
    : authorizationHeader.trim();

  if (!token) return false;

  // SECURITY (F5): if neither the DB nor the env has a secret
  // configured, refuse. The dev escape hatch ALLOW_INSECURE_WEBHOOK
  // is intentionally NOT honoured here — Tamara integration has no
  // historical need for it, and the previous behaviour was exploitable
  // in production. Tests should stub this function.
  const hasAnySecret =
    !!process.env.TAMARA_WEBHOOK_TOKEN ||
    // We can't cheaply know if the DB has a row without querying; the
    // helper handles that and returns ok=false in either case.
    false;
  if (!hasAnySecret) {
    throw new Error(
      'TAMARA_WEBHOOK_TOKEN is not configured. Refusing to accept unsigned webhooks. ' +
        'Set the env var or stub this function in your test harness.',
    );
  }

  const result = await verifyWebhookToken('tamara', token);
  return result.ok;
}