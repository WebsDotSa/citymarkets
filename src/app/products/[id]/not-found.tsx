import type { Metadata } from "next";
import Link from "next/link";
import { buildPageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = buildPageMetadata({
  title: "منتج غير موجود",
  description: "المنتج الذي تبحث عنه غير متوفر. تصفح الكتالوج لاكتشاف منتجات أخرى.",
  path: "/catalog",
  noIndex: true,
});

export default function ProductNotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center" dir="rtl">
      <h1 className="text-xl font-bold text-secondary mb-2">المنتج غير موجود</h1>
      <p className="text-gray-500 text-sm mb-6">
        ربما أُزيل المنتج أو لم يعد متاحاً. جرّب البحث في الكتالوج.
      </p>
      <Link
        href="/catalog"
        className="px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors"
      >
        تصفح المنتجات
      </Link>
    </div>
  );
}