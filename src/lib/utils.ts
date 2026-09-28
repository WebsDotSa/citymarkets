import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number | string | null | undefined): string {
  const num = typeof price === 'number' ? price : parseFloat(price || '0');
  return `${num.toFixed(2)} ر.س`;
}

export function formatDate(
  date: string | Date | null | undefined,
  locale: string = "ar-SA"
): string {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

/** عرض رقم الطلب بأمان (معرّف قد يكون number من PostgreSQL) */
export function formatOrderId(id: string | number | null | undefined): string {
  const raw = String(id ?? "").replace(/\D/g, "");
  if (!raw) return "00000000";
  return raw.padStart(8, "0").slice(-8);
}

/** رابط خرائط جوجل لعرض موقع */
export function googleMapsPlaceUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** رابط اتجاهات جوجل من الموقع الحالي إلى العميل */
export function googleMapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function parseCoords(
  lat: unknown,
  lng: unknown
): { lat: number; lng: number } | null {
  const la = typeof lat === "number" ? lat : parseFloat(String(lat ?? ""));
  const ln = typeof lng === "number" ? lng : parseFloat(String(lng ?? ""));
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la === 0 && ln === 0) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}

/** تحويل رقم سعودي إلى صيغة wa.me (9665xxxxxxxx) */
export function normalizeSaudiPhoneForWhatsApp(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("966") && digits.length >= 11) return digits;
  if (digits.startsWith("05") && digits.length === 10) return `966${digits.slice(1)}`;
  if (digits.startsWith("5") && digits.length === 9) return `966${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `966${digits.slice(1)}`;
  return digits.length >= 9 ? digits : null;
}

export function buildOrderPreparingWhatsAppMessage(options: {
  customerName?: string;
  orderId?: string | number | null;
}): string {
  const name = options.customerName?.trim();
  const greeting = name ? `مرحباً ${name}،` : "مرحباً،";
  const orderNum = formatOrderId(options.orderId);
  return `${greeting}

شكراً لطلبك من أسواق سيتي.

رقم طلبك: #${orderNum}
ونحن الآن نقوم بتجهيز طلبك. سنبلّغك فور الانطلاق للتوصيل.

فريق أسواق سيتي
https://citymarkets.sa`;
}

export function buildWhatsAppUrl(phone: string, message: string): string | null {
  const normalized = normalizeSaudiPhoneForWhatsApp(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function coerceAmount(value: unknown): number {
  const n =
    typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

export interface ParsedOrderItem {
  id?: string | number;
  product_id?: string | number;
  name_ar?: string;
  price?: number;
  quantity?: number;
  image_url?: string | null;
}

export function parseOrderItems(items: unknown): ParsedOrderItem[] {
  if (Array.isArray(items)) return items as ParsedOrderItem[];
  if (typeof items === "string" && items.trim()) {
    try {
      const parsed = JSON.parse(items) as unknown;
      return Array.isArray(parsed) ? (parsed as ParsedOrderItem[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizeOrdersListPayload(data: {
  success?: boolean;
  data?: unknown;
  orders?: unknown;
}): unknown[] {
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.orders)) return data.orders;
  return [];
}

export function formatPhone(phone: string): string {
  // Saudi phone format: 05XX XXX XXXX
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)} ${cleaned.slice(5)}`;
  }
  return phone;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generate a random ID (simple client-side)
export function generateId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).substring(2, 15);
}
