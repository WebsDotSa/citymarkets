import type { Metadata } from "next";
import Link from "next/link";
import { buildPageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = buildPageMetadata({
  title: "الشروط والأحكام",
  description: "شروط استخدام موقع أسواق سيتي",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12" dir="rtl">
      <h1 className="text-2xl font-bold text-secondary mb-4">الشروط والأحكام</h1>
      <p className="text-gray-600 text-sm leading-relaxed mb-6">
        باستخدامك لموقعنا وخدماتنا فإنك توافق على الالتزام بهذه الشروط. نحدّث هذه الصفحة عند
        الحاجة؛ يُرجى مراجعتها دورياً.
      </p>
      <ul className="list-disc list-inside text-sm text-gray-700 space-y-2 mb-8">
        <li>الأسعار والتوفر قد تتغير دون إشعار مسبق.</li>
        <li>الطلبات تخضع للتأكيد والمخزون الفعلي.</li>
        <li>أي نزاع يخضع للأنظمة المعمول بها في المملكة العربية السعودية.</li>
      </ul>
      <Link href="/" className="text-primary text-sm font-medium hover:underline">
        ← العودة للرئيسية
      </Link>
    </div>
  );
}
