/**
 * بوابة دفع موحّدة: ميسر (افتراضي عند التفعيل) أو تمارا (BNPL).
 *
 * تمارا تُختار على مستوى الطلب (payment_method === 'tamara') وليست
 * مزوّداً عالمياً يحلّ محل غيره — لذا يحوي هذا الملف دالة مخصّصة
 * `initiateTamaraPayment` تُستدعى من مسار /checkout عند اختيار العميل
 * لخيار تمارا.
 */

import {
  isMoyasarConfigured,
  isMoyasarInlineConfigured,
  createInvoice,
} from './moyasar';
import {
  isTamaraConfigured,
  createCheckoutSession as createTamaraCheckout,
} from './tamara';

export type PaymentProviderId = 'moyasar' | 'tamara' | 'none';

export interface UnifiedPaymentRequest {
  amount: number;
  orderId: string | number;
  customerName: string;
  customerMobile: string;
  customerEmail?: string;
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
  /**
   * Idempotency key forwarded to Moyasar's create-invoice.
   * See MoyasarInvoiceRequest.idempotencyKey.
   */
  idempotencyKey?: string;
}

export interface UnifiedPaymentResult {
  success: boolean;
  provider?: PaymentProviderId;
  paymentUrl?: string;
  referenceId?: string;
  error?: string;
}

/** دفع ميسر داخل الموقع (MPF) بدل صفحة الفاتورة */
export function isMoyasarInlineCheckoutEnabled(): boolean {
  return getPaymentProvider() === 'moyasar' && isMoyasarInlineConfigured();
}

export function getPaymentProvider(): PaymentProviderId {
  if (isMoyasarConfigured()) return 'moyasar';
  return 'none';
}

export async function initiateOnlinePayment(
  request: UnifiedPaymentRequest
): Promise<UnifiedPaymentResult> {
  const provider = getPaymentProvider();

  if (provider === 'none') {
    return {
      success: false,
      provider: 'none',
      error: 'بوابة الدفع غير مُعدّة',
    };
  }

  const orderIdStr = String(request.orderId);
  const desc = `طلب سيتي ماركت #${orderIdStr.slice(-8)}`;
  const result = await createInvoice({
    amount: request.amount,
    orderId: orderIdStr,
    description: desc,
    customerName: request.customerName,
    idempotencyKey: request.idempotencyKey,
  });
  return {
    success: result.success,
    provider: 'moyasar',
    paymentUrl: result.paymentUrl,
    referenceId: result.invoiceId,
    error: result.error,
  };
}

/**
 * هل تمارا مُفعّلة (TAMARA_API_TOKEN موجود)؟
 * يُستخدم لإظهار/إخفاء خيار تمارا في واجهة checkout.
 */
export function isTamaraEnabled(): boolean {
  return isTamaraConfigured();
}

/**
 * ابدأ جلسة دفع تمارا (BNPL).
 * يُستدعى مباشرة من /api/v1/checkout عند اختيار payment_method === 'tamara'.
 * يعيد رابط Tamara المُستضاف حيث يختار العميل خطة التقسيط ويُكمل
 * المصادقة. نجاح تمارا يأتي عبر الـ webhook + صفحة success.
 */
export async function initiateTamaraPayment(args: {
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
  instalments?: number;
  idempotencyKey?: string;
}): Promise<UnifiedPaymentResult> {
  if (!isTamaraConfigured()) {
    return {
      success: false,
      provider: 'tamara',
      error: 'بوابة تمارا غير مُفعّلة — أضف TAMARA_API_TOKEN في .env.local',
    };
  }
  const result = await createTamaraCheckout({
    orderId: args.orderId,
    totalSar: args.totalSar,
    description: args.description,
    customerName: args.customerName,
    customerEmail: args.customerEmail,
    customerPhone: args.customerPhone,
    shippingAddress: args.shippingAddress,
    items: args.items,
    instalments: args.instalments,
    idempotencyKey: args.idempotencyKey,
  });
  return {
    success: result.success,
    provider: 'tamara',
    paymentUrl: result.paymentUrl,
    referenceId: result.checkoutId,
    error: result.error,
  };
}