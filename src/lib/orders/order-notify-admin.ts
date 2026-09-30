import {
  getNotificationSettings,
  fillOrderNotificationTemplate,
} from "@/lib/app-settings";
import { buildWhatsAppUrl } from "@/lib/format";
import { error as logError, info as logInfo } from "@/lib/logger";

/** إشعار المدير بطلب جديد (واتساب — رابط جاهز للفتح) */
export async function notifyAdminNewOrder(order: {
  id: string | number;
  total: number;
  customerName?: string | null;
}): Promise<{ whatsappUrl: string | null }> {
  try {
    const settings = await getNotificationSettings();
    if (!settings.notify_new_order || !settings.whatsapp_admin_phone) {
      return { whatsappUrl: null };
    }

    const message = fillOrderNotificationTemplate(settings.message_template, {
      order_id: order.id,
      customer: order.customerName || "عميل",
      total: Number(order.total).toFixed(2),
    });

    const whatsappUrl = buildWhatsAppUrl(settings.whatsapp_admin_phone, message);

    // Audit: log to structured logger (NOT payment_events ledger — that
    // table is reserved for payment-gateway events keyed by invoice_id,
    // gateway, and event_type. Admin-notification audits are not payment
    // events; an earlier version wrote here with the wrong column shape
    // and a silent .catch, which masked the failure and polluted the
    // canonical ledger on any schema reconciliation).
    logInfo("[notify-admin] new-order whatsapp url built", {
      orderId: order.id,
      hasUrl: Boolean(whatsappUrl),
    });

    return { whatsappUrl };
  } catch (e) {
    logError("notifyAdminNewOrder failed", e, { orderId: order.id });
    return { whatsappUrl: null };
  }
}
