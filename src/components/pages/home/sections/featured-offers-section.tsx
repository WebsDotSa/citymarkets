"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { OfferCard, type OfferCardData } from "@/components/storefront/offer-card";
import { ProductCard } from "@/components/storefront/product-card";
import type { Product as ProductType } from "@/lib/types";
import { ProductCardSkeleton } from "@/components/design/skeleton";

function SectionHeader({ title, subtitle, link }: { title: string; subtitle?: string; link?: string }) {
  return (
    <div className="flex items-end justify-between mb-5">
      <div>
        <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-1 font-normal">{subtitle}</p>}
      </div>
      {link && (
        <Link href={link} className="flex items-center gap-1 text-sm font-bold text-primary hover:text-primary-dark transition-colors">
          عرض الكل
          <ChevronLeft className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}

export function FeaturedOffersSection() {
  const [offers, setOffers] = useState<OfferCardData[]>([]);
  const [deals, setDeals] = useState<ProductType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([
      fetch("/api/v1/offers?featured=true&limit=6", { signal: ac.signal }).then((r) => r.json()),
      fetch("/api/v1/products?on_offer=true&limit=6", { signal: ac.signal }).then((r) => r.json()),
    ])
      .then(([offersRes, dealsRes]) => {
        if (ac.signal.aborted) return;
        if (offersRes.success) setOffers(offersRes.data || []);
        if (dealsRes.success) {
          const d = dealsRes.data;
          setDeals(Array.isArray(d) ? d : d?.data || []);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  if (!loading && offers.length === 0 && deals.length === 0) return null;

  return (
    <section className="py-8 sm:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          title="عروض حصرية"
          subtitle="خصومات قوية لفترة محدودة"
          link="/offers"
        />

        {offers.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {offers.slice(0, 6).map((o) => (
              <OfferCard key={o.id} offer={o} variant="hero" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 min-h-[280px]">
            {loading
              ? [...Array(6)].map((_, i) => <ProductCardSkeleton key={i} />)
              : deals.slice(0, 6).map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </div>
    </section>
  );
}