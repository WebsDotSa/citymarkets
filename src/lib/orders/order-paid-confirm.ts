/**
 * Post-payment confirmation message.
 *
 * The legacy `sendOrderConfirmationSms` (src/lib/twilio-messaging.ts:69)
 * fires the moment an order is created. This module fires AFTER the
 * payment gateway confirms the payment (webhook path). It is the place
 * where we can speak to the customer about what just happened — the
 * "your payment succeeded" message — and where we can layer the
 * personalised recovered-abandoned-cart line for users who bounced on
 * earlier checkouts and finally returned.
 *
 * Behaviour:
 *   - If `recovered_from_abandoned_count` is 0 (the common case), the
 *     customer just gets the standard confirmation text.
 *   - If `recovered_from_abandoned_count` is > 0, we append a friendly
 *     line acknowledging the recovery. The base message stays neutral
 *     so the customer doesn't feel monitored.
 *
 * The SMS path mirrors `sendOrderConfirmationSms`; the WhatsApp path
 * mirrors `buildOrderPreparingWhatsAppMessage` (src/lib/utils.ts:67) so
 * admins reaching for the customer from /admin/orders/[id] see the
 * same tone.
 *
 * Each send is best-effort: failures are logged but never thrown, so a
 * flaky Twilio/WhatsApp relay can never block the gateway's webhook
 * response (which would trigger provider-side retries + duplicate
 * processing).
 */

import { error as logError, warn as logWarn } from "@/lib/logger";

interface PaidConfirmArgs {
  phone: string | null;
  customer_name?: string | null;
  order_id: string | number;
  total: number;
  recovered_from_abandoned_count?: number;
}

const RECOVERY_LINE =
  "\nنلاحظ إنه عندك {count} سلات سابقة على موقعنا — يسعدنا رجوعك! 🎉";

/**
 * Format the post-payment confirmation body. Pure function so it can be
 * unit-tested and reused for the WhatsApp flow without duplicating the
 * recovery logic.
 */
export function buildOrderPaidConfirmationBody(args: PaidConfirmArgs): string {
  const total = Number(args.total).toFixed(2);
  const orderNum = String(args.order_id);
  const recovered = Math.max(0, Math.floor(args.recovered_from_abandoned_count ?? 0));

  const base =
    `أسواق سيتي: تم تأكيد دفع طلبك #${orderNum} بمبلغ ${total} ر.س. ` +
    `شكراً لتسوقك معنا.`;

  if (recovered <= 0) return base;

  const recovery = RECOVERY_LINE.replace("{count}", String(recovered));
  return `${base}\n${recovery.trim()}`;
}

/**
 * Fire-and-forget SMS confirmation after a successful gateway payment.
 * No-op if `phone` is missing or Twilio is not configured (logs a warning).
 */
export async function sendOrderPaidConfirmationSms(args: PaidConfirmArgs): Promise<void> {
  if (!args.phone) return;

  try {
    const { isTwilioMessagingConfigured, twilioSendSms } = await import(
      "@/lib/twilio-messaging"
    );
    if (!isTwilioMessagingConfigured()) return;

    const body = buildOrderPaidConfirmationBody(args);
    const result = await twilioSendSms(args.phone, body);
    if (!result.ok) {
      logWarn("order-paid-confirm: sms skipped", {
        orderId: args.order_id,
        error: result.error,
      });
    }
  } catch (err) {
    logError("order-paid-confirm: sms failed", {
      orderId: args.order_id,
      err: (err as Error)?.message,
    });
  }
}
