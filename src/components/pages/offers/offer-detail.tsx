"use client";

// Offer detail page. Renders the offer hero, countdown, description,
// and a grid of products that the offer resolves to (per the offer's
// targets — pulled from the server with their pre-computed effective
// price from products_unified_with_offers).

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Sparkles } from "lucide-react";
import { OfferCountdown } from "@/components/storefront/offer-countdown";
import { ProductCard } from "@/components/storefront/product-card";
import type { ActiveOfferInfo, Product } from "@/lib/types";

interface OfferDetailData {
  id: string;
  title_ar: string;
  title_en: string | null;
  description_ar: string | null;
  description_en: string | null;
  image_url: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  max_discount: number | null;
  min_order: number | null;
  starts_at: string;
  ends_at: string;
  is_featured: boolean;
}

interface OfferProduct {
  id: string;
  name_ar: string;
  price: number;
  discount_price: number | null;
  image_url: string | null;
  stock_qty: number | string;
  category_id: string | number | null;
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_slug: string | null;
  active_offer: ActiveOfferInfo | null;
  effective_price: number | null;
}

interface OfferDetailProps {
  offer: OfferDetailData;
  products: OfferProduct[];
}

function discountLabel(o: OfferDetailData): string {
  return o.discount_type === "percentage"
    ? `خصم ${o.discount_value}٪`
    : `خصم ${o.discount_value} ر.س`;
}

export function OfferDetail({ offer, products }: OfferDetailProps) {
  return (
    <div className="px-3 sm:px-4 py-6 max-w-6xl mx-auto space-y-6">
      {/* Back */}
      <Link
        href="/offers"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-primary transition-colors"
      >
        <ArrowRight className="w-4 h-4" />
        العودة لكل العروض
      </Link>

      {/* Hero */}
      <div className="relative rounded-3xl overflow-hidden shadow-md bg-gray-100">
        <div className="relative aspect-[16/9] sm:aspect-[21/9]">
          {offer.image_url ? (
            <Image
              src={offer.image_url}
              alt={offer.title_ar}
              fill
              priority
              sizes="(max-width: 768px) 100vw, 1200px"
              className="object-cover"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="absolute top-3 end-3 flex flex-wrap items-center gap-2">
            {offer.is_featured ? (
              <span className="inline-flex items-center gap-1 bg-amber-400 text-amber-900 text-[11px] font-bold px-2 py-1 rounded-full">
                <Sparkles className="w-3 h-3" />
                مميّز
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 bg-red-500 text-white text-[11px] font-bold px-2 py-1 rounded-full">
              {discountLabel(offer)}
            </span>
          </div>
          <div className="absolute bottom-0 inset-x-0 p-4 sm:p-6 text-white">
            <h1 className="text-xl sm:text-3xl font-bold leading-tight mb-3 max-w-2xl">
              {offer.title_ar}
            </h1>
            <OfferCountdown endsAt={offer.ends_at} />
          </div>
        </div>
      </div>

      {/* Description */}
      {(offer.description_ar || offer.description_en) && (
        <section className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-base font-bold text-secondary mb-2">تفاصيل العرض</h2>
          {offer.description_ar ? (
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
              {offer.description_ar}
            </p>
          ) : null}
          {offer.description_en ? (
            <p
              className="text-sm text-gray-500 leading-relaxed whitespace-pre-line mt-3"
              dir="ltr"
            >
              {offer.description_en}
            </p>
          ) : null}
        </section>
      )}

      {/* Products */}
      <section>
        <h2 className="text-lg font-bold text-secondary mb-3 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          المنتجات المشمولة
          <span className="text-xs font-normal text-gray-500">
            ({products.length} منتج)
          </span>
        </h2>

        {products.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
            <p className="text-sm text-gray-500">لا توجد منتجات في هذا العرض حالياً</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {products.map((p) => (
              <ProductCard key={p.id} product={p as unknown as Product} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
