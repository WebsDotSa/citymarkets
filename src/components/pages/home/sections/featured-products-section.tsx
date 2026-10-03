"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ProductCard } from "@/components/storefront/product-card";
import type { Product } from "@/lib/types";
import { ProductCardSkeleton } from "@/components/design/skeleton";

function SectionHeader({ title, subtitle, link }: { title: string; subtitle?: string; link?: string }) {
  return (
    <div className="flex items-end justify-between mb-5">
      <div>
        <h2 className="text-xl sm:text-2xl font-black tracking-tight text-gray-900">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500 mt-1 font-normal">{subtitle}</p>}
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

export function FeaturedProductsSection() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/v1/products?featured=true&limit=12", { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => {
        if (ac.signal.aborted) return;
        if (d.success) {
          const p = d.data;
          setProducts(Array.isArray(p) ? p : p?.data || []);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  return (
    <section className="py-8 sm:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          title="منتجات مميزة"
          subtitle="اختيارنا المميز لك"
          link="/catalog?featured=true"
        />

        {/* min-h reserves space to avoid CLS shift when products load */}
        <div className="relative -mx-4 sm:mx-0 min-h-[380px]">
          <div
            className="flex gap-4 overflow-x-auto px-4 sm:px-0 pb-4 scrollbar-hide"
            style={{ scrollSnapType: "x mandatory" }}
          >
            {loading
              ? [...Array(5)].map((_, i) => (
                  <div key={i} className="w-56 sm:w-64 flex-shrink-0" style={{ scrollSnapAlign: "start" }}>
                    <ProductCardSkeleton />
                  </div>
                ))
              : products.map((p) => (
                  <div
                    key={p.id}
                    className="w-56 sm:w-64 flex-shrink-0"
                    style={{ scrollSnapAlign: "start" }}
                  >
                    <ProductCard product={p} />
                  </div>
                ))}
          </div>
        </div>
      </div>
    </section>
  );
}