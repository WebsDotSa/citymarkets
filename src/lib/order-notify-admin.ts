import {
  getNotificationSettings,
  fillOrderNotificationTemplate,
} from "@/lib/app-settings";
import { buildWhatsAppUrl } from "@/lib/utils";
import { query } from "@/lib/db";
import { error as logError } from "@/lib/logger";

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

    await query(
      `INSERT INTO payment_events (order_id, event_type, payload)
       VALUES ($1, 'admin_notify_new_order', $2::jsonb)`,
      [order.id, JSON.stringify({ whatsapp_url: whatsappUrl, message })]
    ).catch(() => {});

    return { whatsappUrl };
  } catch (e) {
    logError("notifyAdminNewOrder failed", e, { orderId: order.id });
    return { whatsappUrl: null };
  }
}
