import { query } from "@/lib/db";

export type NotificationSettings = {
  whatsapp_admin_phone: string;
  notify_new_order: boolean;
  message_template: string;
};

export type InventorySettings = {
  low_stock_threshold: number;
};

/**
 * Store open/closed toggle (admin-controlled).
 *
 * When `is_open = false` the storefront shows a sticky top banner and
 * the checkout endpoint refuses new orders. The `message` is shown
 * verbatim in the banner; admins can override the default copy.
 */
export type StoreStatusSettings = {
  is_open: boolean;
  message: string;
  updated_by?: string | null;
};

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  whatsapp_admin_phone: "",
  notify_new_order: true,
  message_template:
    "طلب جديد #{order_id} — {customer} — {total} ر.س — أسواق سيتي",
};

const DEFAULT_INVENTORY: InventorySettings = {
  low_stock_threshold: 5,
};

export const DEFAULT_STORE_STATUS: StoreStatusSettings = {
  is_open: true,
  message:
    "الموقع مغلق مؤقتاً — لا يمكن الشراء الآن عبر الموقع، يمكنكم التسوق من التطبيق أو العودة لاحقاً",
  updated_by: null,
};

export async function getAppSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const res = await query(`SELECT value FROM app_settings WHERE key = $1`, [
      key,
    ]);
    if (res.rows.length === 0) return fallback;
    return { ...fallback, ...(res.rows[0].value as T) };
  } catch {
    return fallback;
  }
}

export async function setAppSetting(
  key: string,
  value: Record<string, unknown>
): Promise<void> {
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  return getAppSetting("notifications", DEFAULT_NOTIFICATIONS);
}

export async function getInventorySettings(): Promise<InventorySettings> {
  return getAppSetting("inventory", DEFAULT_INVENTORY);
}

export async function getStoreStatusSettings(): Promise<StoreStatusSettings> {
  return getAppSetting("store_status", DEFAULT_STORE_STATUS);
}

export function fillOrderNotificationTemplate(
  template: string,
  vars: { order_id: string | number; customer: string; total: string }
): string {
  return template
    .replace(/\{order_id\}/g, String(vars.order_id))
    .replace(/\{customer\}/g, vars.customer)
    .replace(/\{total\}/g, vars.total);
}
