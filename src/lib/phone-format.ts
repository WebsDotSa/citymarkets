/** تحويل أرقام السعودية إلى E.164 لـ Twilio (+9665xxxxxxxx) */
export function normalizeSaudiToE164(phone: string): string | null {
  const raw = phone.trim().replace(/\s+/g, "");
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("966") && digits.length >= 12) {
    return `+${digits}`;
  }
  if (digits.startsWith("0") && digits.length >= 10) {
    return `+966${digits.slice(1)}`;
  }
  if (digits.length === 9 && digits.startsWith("5")) {
    return `+966${digits}`;
  }
  if (digits.length === 10 && digits.startsWith("5")) {
    return `+966${digits}`;
  }
  return null;
}

/** تخزين موحّد في قاعدة البيانات (مثل +9665xxxxxxxx) */
export function phoneForDb(e164: string): string {
  return e164.startsWith("+") ? e164 : `+${e164.replace(/^\+/, "")}`;
}
