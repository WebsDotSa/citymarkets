import type { Metadata } from "next";
import Link from "next/link";
import { LocationSheetTrigger } from "@/components/location/location-sheet-trigger";
import { buildPageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = buildPageMetadata({
  title: "المساعدة والدعم",
  description: "أسئلة شائعة وقنوات التواصل مع أسواق سيتي",
  path: "/help",
});

export default function HelpPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12" dir="rtl">
      <h1 className="text-2xl font-bold text-secondary mb-4">المساعدة والدعم</h1>
      <p className="text-gray-600 text-sm leading-relaxed mb-6">
        نساعدك في الطلبات، التوصيل، والدفع. راجع الأسئلة الشائعة أدناه.
      </p>

      <section className="space-y-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="font-semibold text-secondary mb-1">كيف أتابع طلبي؟</h2>
          <p className="text-sm text-gray-600">
            بعد تسجيل الدخول، انتقل إلى{" "}
            <Link href="/orders" className="text-primary hover:underline">
              طلباتي
            </Link>{" "}
            لمتابعة الحالة.
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="font-semibold text-secondary mb-1">تسجيل الدخول</h2>
          <p className="text-sm text-gray-600">
            نستخدم رمز تحقق عبر الرسائل النصية. من صفحة{" "}
            <Link href="/auth/login" className="text-primary hover:underline">
              تسجيل الدخول
            </Link>
            .
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="font-semibold text-secondary mb-1">التوصيل والعناوين</h2>
          <p className="text-sm text-gray-600">
            أضف أو عدّل عناوين التوصيل من{" "}
            <LocationSheetTrigger className="text-primary hover:underline">
              عناويني
            </LocationSheetTrigger>
            .
          </p>
        </div>
      </section>

      <Link href="/" className="text-primary text-sm font-medium hover:underline">
        ← العودة للرئيسية
      </Link>
    </div>
  );
}