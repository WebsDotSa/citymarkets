import { NON_ELECTRONIC_METHODS } from "@/lib/payments/payment-methods";

/** طلبات تُحسب في «إيرادات مدفوعة إلكترونياً»: تم التأكيد + ليس نقداً/محفظة/تحويل بنكي */
export const REVENUE_ORDER_STATUS = "confirmed" as const;
export const REVENUE_PAYMENT_STATUS = "paid" as const;

export function isElectronicPaymentMethod(
  method: string | null | undefined
): boolean {
  const key = String(method ?? "")
    .trim()
    .toLowerCase();
  if (!key || NON_ELECTRONIC_METHODS.has(key)) return false;
  return true;
}

export function countsAsElectronicRevenue(order: {
  status?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
}): boolean {
  return (
    String(order.status ?? "") === REVENUE_ORDER_STATUS &&
    isElectronicPaymentMethod(order.payment_method)
  );
}

/** شرط SQL لاستخدامه في استعلامات الإيرادات */
export const SQL_REVENUE_ELIGIBLE = `
  o.status = 'confirmed'
  AND COALESCE(LOWER(TRIM(o.payment_method)), '') NOT IN ('cash', 'wallet', 'bank_transfer', '')
`;
