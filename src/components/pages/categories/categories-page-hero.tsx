"use client";

/**
 * PageHero
 *
 * Top section of the /categories page. Holds the location pill, the search
 * box, and (when the user types ≥ 2 chars) the hybrid product+category
 * results panel that gives instant feedback.
 *
 * Pure presentational — parent owns `query` and the matching product state.
 */

import { useMemo } from "react";
import Link from "next/link";
import {
  Search,
  MapPin,
  ChevronDown,
  Sparkles,
  X,
  ChevronLeft,
  Package,
  ArrowRight,
} from "lucide-react";
import type { CategoryTreeNode } from '@/lib/catalog';
import {
  collectCategoryMatches,
  type SearchedProduct,
} from "./categories-helpers";

interface PageHeroProps {
  tree: CategoryTreeNode[];
  query: string;
  onQuery: (q: string) => void;
  onOpenLocation: () => void;
  locationLabel: string;
  productMatches: { items: SearchedProduct[]; loading: boolean };
  searchHits: number;
  totalRoots: number;
  totalChildren: number;
  totalProducts: number;
}

export function PageHero({
  tree,
  query,
  onQuery,
  onOpenLocation,
  locationLabel,
  productMatches,
  searchHits,
  totalRoots,
  totalChildren,
  totalProducts,
}: PageHeroProps) {
  const trimmedQuery = query.trim();
  const showHybridPanel = trimmedQuery.length >= 2;
  const showProductEmpty =
    showHybridPanel &&
    !productMatches.loading &&
    productMatches.items.length === 0;
  const showProductOk = showHybridPanel && productMatches.items.length > 0;

  return (
    <section
      aria-label="بحث الأقسام"
      className="relative pt-4 sm:pt-6 pb-5 sm:pb-6 bg-white border-b border-slate-100/80"
    >
      <div className="px-4 sm:px-6 max-w-6xl mx-auto">
        {/* Top row: promo banner next to location pill, both on the start
            side (right in RTL). They sit side-by-side on every screen
            size — no wrapping, no new line, even on narrow phones. */}
        <div className="flex items-center gap-2 sm:gap-3 flex-nowrap min-w-0">
          <div className="inline-flex shrink-0 items-center gap-1.5 sm:gap-2 rounded-full border border-dashed border-amber-300 bg-amber-50/80 text-amber-900 px-2.5 sm:px-3 py-1.5 text-tiny sm:text-xs font-bold whitespace-nowrap">
            <Sparkles
              className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-600 shrink-0"
              aria-hidden="true"
            />
            <span className="truncate">سيتوفر التوصيل السريع قريباً</span>
            <span aria-hidden="true" className="shrink-0">
              ⚡
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenLocation}
            className="inline-flex shrink min-w-0 items-center gap-1.5 max-w-full rounded-full bg-slate-50 hover:bg-slate-100 border border-slate-200/80 px-2.5 sm:px-3 py-1.5 text-tiny sm:text-xs font-bold text-slate-700 transition-colors"
            aria-label="تغيير موقع التوصيل"
          >
            <span className="inline-flex shrink-0 items-center justify-center w-5 h-5 rounded-full bg-gradient-to-l from-[#009345] to-[#00B359] text-white">
              <MapPin className="w-3 h-3" aria-hidden="true" />
            </span>
            <span className="truncate flex-1 min-w-0">{locationLabel}</span>
            <ChevronDown
              className="w-3 h-3 opacity-60 shrink-0"
              aria-hidden="true"
            />
          </button>
        </div>

        {/* Headline + count chips */}
        <div className="mt-4 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              تصفّح كل الأقسام
            </h1>
            <p className="text-2xs sm:text-xs text-slate-500 mt-1">
              ابحث عن المنتجات والأقسام في مكان واحد
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2 text-2xs text-slate-500 font-bold">
            <span className="rounded-full bg-slate-50 border border-slate-200 px-3 py-1.5">
              {totalRoots} قسم رئيسي
            </span>
            <span className="rounded-full bg-slate-50 border border-slate-200 px-3 py-1.5">
              {totalChildren} قسم فرعي
            </span>
            <span
              className="rounded-full bg-slate-50 border border-slate-200 px-3 py-1.5"
              dir="ltr"
            >
              {totalProducts.toLocaleString("en-US")} منتج
            </span>
          </div>
        </div>

        {/* Prominent search */}
        <div className="mt-4 relative">
          <label htmlFor="categories-search" className="sr-only">
            ابحث عن المنتجات والأقسام
          </label>
          <input
            id="categories-search"
            role="searchbox"
            type="search"
            inputMode="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="ابحث عن منتج أو قسم… مثل: تفاح، حليب، بهارات"
            className="w-full h-14 sm:h-16 pe-14 ps-14 rounded-2xl bg-white border-2 border-slate-200/80 text-sm sm:text-base font-semibold text-slate-900 placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#009345]/30 focus:border-[#009345]/50 transition-all"
          />
          <span
            className="absolute right-4 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-l from-[#009345] to-[#00B359] text-white shadow-md shadow-[#009345]/20"
            aria-hidden="true"
          >
            <Search className="w-5 h-5" />
          </span>
          {query ? (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="مسح البحث"
              className="absolute left-4 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <span
              className="absolute left-4 top-1/2 -translate-y-1/2 hidden sm:inline text-tiny font-bold text-slate-400 select-none"
              aria-hidden="true"
            >
              ⌘K
            </span>
          )}
        </div>

        {/* Hybrid product+category results panel — only when user has typed */}
        {showHybridPanel ? (
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            <CategoryMatchesCard
              tree={tree}
              trimmedQuery={trimmedQuery}
              searchHits={searchHits}
            />
            <ProductMatchesCard
              trimmedQuery={trimmedQuery}
              productMatches={productMatches}
              showProductOk={showProductOk}
              showProductEmpty={showProductEmpty}
            />
          </div>
        ) : null}

        {query && searchHits > 0 && !showHybridPanel ? (
          <p className="mt-2 text-xs text-slate-500" aria-live="polite">
            {searchHits} نتيجة مطابقة في {totalRoots} قسم
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Hero sub-cards                                                            */
/* ------------------------------------------------------------------------- */

function CategoryMatchesCard({
  tree,
  trimmedQuery,
  searchHits,
}: {
  tree: CategoryTreeNode[];
  trimmedQuery: string;
  searchHits: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-2xs font-black text-slate-500 uppercase tracking-wider">
          الأقسام
        </p>
        <span
          className="text-tiny text-slate-400 tabular-nums"
          dir="ltr"
        >
          {searchHits}
        </span>
      </div>
      {searchHits > 0 ? (
        <CategoryMatchList query={trimmedQuery} tree={tree} />
      ) : (
        <p className="text-xs text-slate-400 py-3">
          لا توجد أقسام مطابقة لـ «{trimmedQuery}»
        </p>
      )}
    </div>
  );
}

function ProductMatchesCard({
  trimmedQuery,
  productMatches,
  showProductOk,
  showProductEmpty,
}: {
  trimmedQuery: string;
  productMatches: { items: SearchedProduct[]; loading: boolean };
  showProductOk: boolean;
  showProductEmpty: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-2xs font-black text-slate-500 uppercase tracking-wider">
          المنتجات
        </p>
        {productMatches.loading ? (
          <span className="text-tiny text-slate-400">يبحث…</span>
        ) : (
          <span
            className="text-tiny text-slate-400 tabular-nums"
            dir="ltr"
          >
            {productMatches.items.length}
          </span>
        )}
      </div>
      {showProductOk ? (
        <ProductMatchesList
          items={productMatches.items}
          trimmedQuery={trimmedQuery}
        />
      ) : showProductEmpty ? (
        <p className="text-xs text-slate-400 py-3">
          لا توجد منتجات مطابقة لـ «{trimmedQuery}»
        </p>
      ) : (
        <p className="text-xs text-slate-400 py-3">يبحث في المنتجات…</p>
      )}
      <Link
        href={`/catalog?search=${encodeURIComponent(trimmedQuery)}`}
        className="mt-2 inline-flex items-center gap-1 text-2xs font-bold text-[#009345] hover:text-[#007A38]"
      >
        عرض كل النتائج
        <ArrowRight className="w-3 h-3" aria-hidden="true" />
      </Link>
    </div>
  );
}

function ProductMatchesList({
  items,
  trimmedQuery,
}: {
  items: SearchedProduct[];
  trimmedQuery: string;
}) {
  return (
    <ul role="list" className="space-y-1 max-h-56 overflow-y-auto">
      {items.map((p) => (
        <li key={p.id}>
          <Link
            href={`/products/${p.id}`}
            className="flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <div className="relative w-10 h-10 rounded-lg bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
              {p.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.image_url}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <Package className="w-4 h-4 text-slate-400" aria-hidden="true" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-800 truncate">
                {highlightInline(p.name_ar, trimmedQuery)}
              </p>
              <p className="text-tiny text-slate-400 truncate">
                {p.category_name ?? "—"}
              </p>
            </div>
            <div className="text-left shrink-0">
              {p.discount_price != null ? (
                <>
                  <p
                    className="text-2xs font-black text-[#009345]"
                    dir="ltr"
                  >
                    {p.discount_price.toFixed(2)} ر.س
                  </p>
                  <p
                    className="text-tiny text-slate-400 line-through"
                    dir="ltr"
                  >
                    {p.price.toFixed(2)}
                  </p>
                </>
              ) : (
                <p
                  className="text-2xs font-black text-slate-700"
                  dir="ltr"
                >
                  {p.price.toFixed(2)} ر.س
                </p>
              )}
              {!p.in_stock ? (
                <p className="text-[9px] font-bold text-amber-600 mt-0.5">
                  نفد المخزون
                </p>
              ) : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------------- */
/* Category match list                                                       */
/* ------------------------------------------------------------------------- */

function CategoryMatchList({
  query,
  tree,
}: {
  query: string;
  tree: CategoryTreeNode[];
}) {
  const matches = useMemo(
    () => collectCategoryMatches(tree, query),
    [tree, query],
  );
  return (
    <ul role="list" className="space-y-1 max-h-56 overflow-y-auto">
      {matches.slice(0, 8).map((m) => (
        <li key={`${m.kind}-${m.id}`}>
          <Link
            href={`/categories/${encodeURIComponent(m.slug)}`}
            className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <span
              className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-50 text-sm shrink-0"
              aria-hidden="true"
            >
              {m.emoji}
            </span>
            <span className="flex-1 min-w-0">
              <span className="text-xs font-bold text-slate-800 block truncate">
                {highlightInline(m.name_ar, query)}
              </span>
              <span className="text-tiny text-slate-400">
                {m.kind === "root" ? "قسم رئيسي" : "قسم فرعي"}
              </span>
            </span>
            <ChevronLeft
              className="w-3.5 h-3.5 text-slate-300 shrink-0"
              aria-hidden="true"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------------- */
/* Inline highlight (used only by the hero — exported locally to keep the  */
/* helper co-located with the only place that calls it).                     */
/* ------------------------------------------------------------------------- */

function highlightInline(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-200/70 text-slate-900 rounded px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

// Type-only re-export so callers that need the query-driven search panel
// can keep importing `SearchedProduct` from this file.
export type { SearchedProduct };
