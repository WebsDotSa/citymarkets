"use client";

// Storefront browser for /offers. Renders a featured carousel at the top
// (when there are featured offers) and a responsive grid below. Pure
// presentation; data is fetched server-side and passed in.

import Link from "next/link";
import { Sparkles, Tag } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { OfferCard, type OfferCardData } from "@/components/storefront/offer-card";

interface OffersBrowserProps {
  featured: OfferCardData[];
  offers: OfferCardData[];
  totalCount: number;
}

export function OffersBrowser({ featured, offers, totalCount }: OffersBrowserProps) {
  if (totalCount === 0) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4 py-16">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-pink-100 to-orange-100 flex items-center justify-center mb-4">
          <Tag className="w-10 h-10 text-pink-500" />
        </div>
        <h1 className="text-2xl font-bold text-secondary mb-2">لا توجد عروض حالياً</h1>
        <p className="text-sm text-gray-500 max-w-sm">
          عذراً، لا توجد عروض نشطة في الوقت الحالي. تابعنا للاطلاع على أحدث التخفيضات فور إطلاقها.
        </p>
        <Link
          href="/catalog"
          className="mt-6 inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-dark transition-colors"
        >
          تصفّح المنتجات
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 px-3 sm:px-4 py-6 max-w-6xl mx-auto">
      {/* Page header */}
      <PageHeader
        title="كل العروض"
        subtitle={`${totalCount} عرض نشط • خصومات محدّثة يومياً`}
        icon={<Sparkles className="w-6 h-6 text-primary" />}
      />

      {/* Featured carousel (if any) */}
      {featured.length > 0 ? (
        <section aria-label="العروض المميّزة">
          <h2 className="text-lg font-bold text-secondary mb-3 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            العروض المميّزة
          </h2>
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {featured.map((o) => (
              <OfferCard key={o.id} offer={o} variant="hero" />
            ))}
          </div>
        </section>
      ) : null}

      {/* All offers grid */}
      <section aria-label="كل العروض النشطة">
        <h2 className="text-lg font-bold text-secondary mb-3">كل العروض</h2>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {offers.map((o) => (
            <OfferCard key={o.id} offer={o} variant="standard" />
          ))}
        </div>
      </section>
    </div>
  );
}
