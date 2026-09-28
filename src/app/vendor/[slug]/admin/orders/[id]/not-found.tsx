import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buildPageMetadata } from "@/lib/seo/site";

interface NotFoundProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: NotFoundProps): Promise<Metadata> {
  const { slug } = await params;
  return buildPageMetadata({
    title: "الطلب غير موجود",
    description: "الطلب الذي تبحث عنه غير متاح أو تابع لمتجر آخر.",
    path: `/vendor/${slug}/admin/orders`,
    noIndex: true,
  });
}

/**
 * Renders when the vendor hits `/vendor/<slug>/admin/orders/<id>` for a
 * child order that does not belong to their `vendor_id`. The API returns
 * 404, the client page surfaces a soft "not found" UI, but Next.js still
 * emits a proper HTTP 404 for crawlers + a friendly page for direct
 * visits that bypass the client.
 */
export default async function VendorOrderNotFound({ params }: NotFoundProps) {
  const { slug } = await params;
  return (
    <div
      className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center"
      dir="rtl"
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-8 max-w-md">
        <h1 className="text-xl font-bold text-slate-900 mb-2">الطلب غير موجود</h1>
        <p className="text-sm text-slate-500 mb-6">
          هذا الطلب غير متاح لمتجرك. ربما تم حذفه أو تابع لمتجر آخر.
        </p>
        <Link
          href={`/vendor/${slug}/admin/orders`}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primaryDark transition"
        >
          <ArrowRight className="w-4 h-4 rotate-180" />
          العودة إلى قائمة الطلبات
        </Link>
      </div>
    </div>
  );
}