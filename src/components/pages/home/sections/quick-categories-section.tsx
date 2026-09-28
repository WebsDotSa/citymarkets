"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, Sparkles } from "lucide-react";
import type { CategoryRow } from "@/lib/types";
import { CategoryCardSkeleton } from "@/components/design/skeleton";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  link?: string;
  linkText?: string;
}

function SectionHeader({ title, subtitle, link, linkText }: SectionHeaderProps) {
  return (
    <div className="flex items-end justify-between mb-5">
      <div>
        <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-slate-500 mt-1 font-normal">{subtitle}</p>
        )}
      </div>
      {link && (
        <Link
          href={link}
          className="flex items-center gap-1 text-sm font-bold text-primary hover:text-primary-dark transition-colors"
        >
          {linkText || "عرض الكل"}
          <ChevronLeft className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}

export function QuickCategoriesSection() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/v1/categories", { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => {
        if (ac.signal.aborted) return;
        // root categories only (no parent), sorted by sort_order
        const roots = (d?.data || [])
          .filter((c: CategoryRow) => !c.parent_id)
          .sort((a: CategoryRow, b: CategoryRow) => (a.sort_order || 0) - (b.sort_order || 0))
          .slice(0, 10);
        setCategories(roots);
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
          title="تصفح حسب القسم"
          subtitle="اختر القسم اللي تبيه"
          link="/categories"
        />

        {loading ? (
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 gap-3">
            {[...Array(8)].map((_, i) => (
              <CategoryCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 gap-3">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/categories/${encodeURIComponent(cat.slug)}`}
                className="group flex flex-col items-center p-3 sm:p-4 bg-white rounded-3xl shadow-sm hover:shadow-md border border-slate-100 hover:-translate-y-0.5 transition-all duration-300"
              >
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-primary-light to-green-100 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform duration-300">
                  {cat.icon_url ? (
                    <Image
                      src={cat.icon_url}
                      alt={cat.name_ar}
                      width={28}
                      height={28}
                      className="object-contain"
                    />
                  ) : (
                    <Sparkles className="w-5 h-5 text-primary" />
                  )}
                </div>
                <span className="text-xs sm:text-sm font-medium text-slate-900 text-center line-clamp-2 leading-tight">
                  {cat.name_ar}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}