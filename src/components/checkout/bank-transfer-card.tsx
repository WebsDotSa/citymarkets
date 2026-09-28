"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { BankIcon } from "@/components/icons/payment";
import { BANK_TRANSFER_DETAILS } from "@/lib/payment-methods";

/**
 * Compact card that surfaces the canonical Al Rajhi bank account in the
 * checkout picker. Rendered only when `bank_transfer` is the active
 * payment method — the customer needs to see the IBAN and the
 * account-holder name before tapping "تأكيد الطلب".
 *
 * Operator decision (2026-09-20): the canonical details below are
 * duplicated in `migrations/056_payment_methods_bank_transfer.sql`
 * (DB seed) and in `src/lib/payment-methods.ts` (canonical constant).
 * Keep all three in sync if the IBAN ever changes.
 */
export function BankTransferCard() {
  const [copied, setCopied] = useState(false);

  const copyIban = async () => {
    try {
      await navigator.clipboard.writeText(BANK_TRANSFER_DETAILS.account_iban);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API rejected (insecure context, denied perm, etc.) —
      // fail silently. The customer can still copy by hand.
    }
  };

  return (
    <div
      dir="rtl"
      className="mt-4 rounded-2xl border border-primary-200 bg-primary-50/40 p-4 space-y-3"
      data-testid="bank-transfer-card"
    >
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-primary text-white flex items-center justify-center">
          <BankIcon />
        </div>
        <div>
          <p className="font-bold text-sm text-gray-900">
            التحويل البنكي — {BANK_TRANSFER_DETAILS.bank_name}
          </p>
          <p className="text-xs text-gray-500">
            حوّل المبلغ على الحساب التالي ثم أرسل الإيصال عبر الواتساب
          </p>
        </div>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex items-start justify-between gap-2">
          <dt className="text-gray-500 shrink-0">اسم الحساب</dt>
          <dd className="font-semibold text-gray-900 text-left">
            {BANK_TRANSFER_DETAILS.account_name}
          </dd>
        </div>

        <div className="flex items-start justify-between gap-2">
          <dt className="text-gray-500 shrink-0">رقم الآيبان</dt>
          <dd className="flex items-center gap-2">
            <span
              dir="ltr"
              className="font-mono font-bold text-primary-700 tracking-wider text-sm"
            >
              {BANK_TRANSFER_DETAILS.account_iban}
            </span>
            <button
              type="button"
              onClick={copyIban}
              aria-label="نسخ رقم الآيبان"
              className="inline-flex items-center gap-1 text-xs text-primary-700 hover:text-primary-800 px-2 py-1 rounded-lg bg-white border border-primary-200"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3" /> تم النسخ
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" /> نسخ
                </>
              )}
            </button>
          </dd>
        </div>
      </dl>

      <div className="rounded-xl bg-white border border-primary-100 p-3 text-xs text-gray-600 leading-relaxed">
        <p className="font-semibold text-primary-700 mb-1">خطوات الطلب:</p>
        <ol className="list-decimal list-inside space-y-1 marker:text-primary-500">
          <li>اختر &quot;تحويل بنكي&quot; ثم أكّد الطلب.</li>
          <li>حوّل المبلغ كاملاً على الحساب أعلاه من تطبيق البنك.</li>
          <li>
            أرسل صورة الإيصال عبر واتساب على الرقم المسجّل في حسابك لتفعيل
            الطلب.
          </li>
        </ol>
      </div>
    </div>
  );
}