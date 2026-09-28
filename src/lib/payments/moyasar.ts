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
  const callbackUrl = `${SITE_URL}/api/v1/payments/moyasar/callback`;

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
      const errMsg =
        data.message ||
        (data.errors && Object.values(data.errors).flat().join(', ')) ||
        `Moyasar HTTP ${response.status}`;
      return { success: false, error: errMsg };
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
    const message = error instanceof Error ? error.message : 'خطأ في الاتصال بميسر';
    logError('Moyasar createInvoice error', error);
    return { success: false, error: message };
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
      return { success: false, error: data.message || `HTTP ${response.status}` };
    }

    return {
      success: true,
      status: data.status,
      amountHalalas: data.amount,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'fetch failed';
    return { success: false, error: message };
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
      return { success: false, error: data.message || `HTTP ${response.status}` };
    }

    return { success: true, status: data.status };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'fetch failed';
    return { success: false, error: message };
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

export function getMoyasarApplePayLabel(): string {
  return process.env.MOYASAR_APPLE_PAY_LABEL?.trim() || 'سيتي ماركت';
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
      return { success: false, error: data.message || `HTTP ${response.status}` };
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
    const message = error instanceof Error ? error.message : 'fetch failed';
    return { success: false, error: message };
  }
}
