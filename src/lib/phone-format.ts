/** تحويل أرقام السعودية إلى E.164 لـ Twilio (+9665xxxxxxxx) */
export function normalizeSaudiToE164(phone: string): string | null {
  const raw = phone.trim().replace(/\s+/g, "");
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  // أرقام الجوال السعودية هي 9 أرقام بعد رمز الدولة (+966).
  // نقبل الأشكال التالية فقط:
  //   - 05XXXXXXXX  (10 أرقام، يبدأ بـ 0)
  //   - 5XXXXXXXX   (9 أرقام، يبدأ بـ 5)
  //   - 9665XXXXXXXX (12 أرقام، بدون +)
  //   - +9665XXXXXXXX (مع +)
  if (digits.startsWith("966") && digits.length === 12 && digits.startsWith("9665")) {
    return `+${digits}`;
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return `+966${digits.slice(1)}`;
  }
  if (digits.length === 9 && digits.startsWith("5")) {
    return `+966${digits}`;
  }
  return null;
}

/** تخزين موحّد في قاعدة البيانات (مثل +9665xxxxxxxx) */
export function phoneForDb(e164: string): string {
  return e164.startsWith("+") ? e164 : `+${e164.replace(/^\+/, "")}`;
}
