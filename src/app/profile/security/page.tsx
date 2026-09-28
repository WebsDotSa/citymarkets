import type { Metadata } from "next";
import Link from "next/link";
import { buildPageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = buildPageMetadata({
  title: "الأمان والخصوصية",
  description: "معلومات عن تسجيل الدخول وحماية بياناتك",
  path: "/profile/security",
  noIndex: true,
});

export default function ProfileSecurityPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12" dir="rtl">
      <h1 className="text-2xl font-bold text-secondary mb-4">الأمان والخصوصية</h1>
      <p className="text-gray-600 text-sm leading-relaxed mb-6">
        نحمي حسابك عبر تسجيل الدخول برمز تحقق لمرة واحدة (OTP) يُرسل إلى رقم جوالك. لا
        نشارك رمز التحقق مع أي طرف ثالث.
      </p>

      <ul className="list-disc list-inside text-sm text-gray-700 space-y-2 mb-8">
        <li>لا تُشارك رمز التحقق مع أي شخص يدّعي أنه من أسواق سيتي.</li>
        <li>سجّل الخروج من الأجهزة المشتركة بعد الانتهاء.</li>
        <li>راجع{" "}
          <Link href="/privacy" className="text-primary hover:underline">
            سياسة الخصوصية
          </Link>{" "}
          لمعرفة كيفية استخدام بياناتك.
        </li>
      </ul>

      <Link href="/profile" className="text-primary text-sm font-medium hover:underline">
        ← العودة للملف الشخصي
      </Link>
    </div>
  );
}
