"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChevronLeft,
  Filter,
  FolderOpen,
  Plus,
  RefreshCcw,
  SlidersHorizontal,
} from "lucide-react";
import { ProductCard } from "@/components/storefront/product-card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/design/empty-state";
import { ProductCardSkeleton } from "@/components/design/skeleton";
import { BRAND } from "@/lib/brand-theme";
import {
  getCategoryEmoji,
  resolveCategoryImageSrc,
} from '@/lib/catalog';
import { emojiForCategoryName } from '@/lib/catalog';
import { mapApiItemToProduct } from './categories-helpers';
import type { Product, CategoryRow } from "@/lib/types";
import type { ProductsApiItem } from './categories-helpers';

type Sort = "popular" | "price-asc" | "price-desc" | "newest";

const PAGE_SIZE = 24;
type ProductApiResponse = {
  success: boolean;
  data: ProductsApiItem[];
  pagination: { total: number; page: number; totalPages: number };
};

export interface CategoryDetailClientProps {
  slug: string;
  category: CategoryRow;
  parent: CategoryRow | null;
  children: CategoryRow[];
  siblings: CategoryRow[];
}

export function CategoryDetailClient({
  slug,
  category,
  parent,
  children,
  siblings,
}: CategoryDetailClientProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sort, setSort] = useState<Sort>("popular");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const hasChildren = children.length > 0;

  const productHref = useMemo(
    () => `/api/v1/products?category=${encodeURIComponent(slug)}`,
    [slug]
  );

  const fetchPage = async (
    p: number,
    append: boolean,
    sortKey: Sort,
    stockOnly: boolean
  ) => {
    const url = new URL(productHref, window.location.origin);
    url.searchParams.set("page", String(p));
    url.searchParams.set("limit", String(PAGE_SIZE));
    if (hasChildren) url.searchParams.set("include_children", "1");
    if (sortKey === "price-asc") url.searchParams.set("sort", "price-asc");
    else if (sortKey === "price-desc") url.searchParams.set("sort", "price-desc");
    else if (sortKey === "newest") url.searchParams.set("sort", "newest");
    if (stockOnly) url.searchParams.set("inStock", "true");

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: ProductApiResponse = await res.json();
    if (!json.success) throw new Error("API returned success=false");

    const mapped: Product[] = json.data.map(mapApiItemToProduct);

    setProducts((prev) => (append ? [...prev, ...mapped] : mapped));
    setTotal(json.pagination.total);
    setTotalPages(json.pagination.totalPages);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(1);  // Reset page when filters/sort change
    fetchPage(1, false, sort, inStockOnly).catch((e) => {
      if (!cancelled) setError(String(e?.message ?? e));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    // Admin check (best-effort, silent on failure)
    fetch("/api/admin/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) {
          setIsAdmin(Boolean(d?.success && (d?.data?.admin || d?.admin)));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, sort, inStockOnly]);

  const loadMore = async () => {
    if (loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      await fetchPage(next, true, sort, inStockOnly);
      setPage(next);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoadingMore(false);
    }
  };

  const totalLabel = useMemo(() => {
    if (loading) return "جارٍ التحميل…";
    return `${total.toLocaleString("en-US")} منتج`;
  }, [total, loading]);

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* Sticky breadcrumb header — positioned below HeaderV2 (which is 64px/80px) */}
      <div className="sticky top-[64px] sm:top-20 z-20 bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <ol
          aria-label="مسار التنقل"
          className="px-4 pt-3 pb-2 flex items-center gap-1.5 text-2xs text-gray-500 overflow-x-auto scrollbar-hide"
        >
          <li>
            <Link href="/categories" className="hover:text-primary font-bold whitespace-nowrap">
              الرئيسية
            </Link>
          </li>
          {parent ? (
            <>
              <li aria-hidden="true" className="text-gray-300">
                /
              </li>
              <li>
                <Link
                  href={`/categories/${encodeURIComponent(parent.slug)}`}
                  className="hover:text-primary font-bold whitespace-nowrap"
                >
                  {parent.name_ar}
                </Link>
              </li>
            </>
          ) : null}
          {parent ? (
            <li aria-hidden="true" className="text-gray-300">
              /
            </li>
          ) : null}
          <li>
            <span className="text-gray-900 font-bold whitespace-nowrap" aria-current="page">
              {category.name_ar}
            </span>
          </li>
        </ol>
      </div>

      {/* Hero */}
      <header className="relative px-5 pt-6 pb-8 bg-white border-b border-gray-100">
        <div className="flex items-start gap-4">
          <CategoryIcon category={category} parent={parent} />
          <div className="flex-1 min-w-0">
            <p className="text-2xs font-bold uppercase tracking-widest text-primary">
              {hasChildren ? "قسم رئيسي" : "قسم فرعي"}
            </p>
            <h1 className="mt-1 text-2xl font-black text-gray-900 leading-tight">
              {category.name_ar}
            </h1>
            {parent ? (
              <Link
                href={`/categories/${encodeURIComponent(parent.slug)}`}
                className="mt-1 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-primary"
              >
                <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                <span>ضمن {parent.name_ar}</span>
              </Link>
            ) : null}
            <p
              className="mt-2 text-xs text-gray-500"
              aria-live="polite"
            >
              {totalLabel}
              {hasChildren
                ? ` • ${children.length} قسم فرعي`
                : siblings.length > 0
                  ? ` • ${siblings.length} قسم مشابه`
                  : ""}
            </p>
          </div>
        </div>

        {category.description_ar ? (
          <p className="mt-4 text-sm text-gray-700 leading-relaxed">
            {category.description_ar}
          </p>
        ) : null}

        {isAdmin ? (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-between gap-2">
            <p className="text-2xs text-amber-900 font-bold">إجراءات المسؤول</p>
            <Link
              href={`/admin/products?new=1&category=${encodeURIComponent(category.slug)}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white shadow-sm"
              style={{ backgroundColor: BRAND.primary }}
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              إضافة منتج
            </Link>
          </div>
        ) : null}
      </header>

      {/* Sub-category chips OR sibling rail */}
      {hasChildren ? (
        <SubCategoryRail
          parent={category}
          children={children}
          currentSlug={category.slug}
        />
      ) : siblings.length > 0 ? (
        <SiblingRail parent={parent} siblings={siblings} currentSlug={category.slug} />
      ) : null}

      {/* Toolbar — positioned below breadcrumb (64+40px = 104px on mobile, 80+40px = 120px on sm+) */}
      <div className="sticky top-[104px] sm:top-[120px] z-10 bg-gray-50/95 backdrop-blur-sm border-b border-gray-100">
        <div className="px-4 py-3 flex items-center gap-2 overflow-x-auto scrollbar-hide">
          <SortPill current={sort} onChange={setSort} />
          <StockToggle value={inStockOnly} onChange={setInStockOnly} />
          <span className="ms-auto text-2xs text-gray-500 font-bold whitespace-nowrap">
            {total} منتج
          </span>
        </div>
      </div>

      {/* Products */}
      <section
        aria-label="منتجات القسم"
        className="px-4 py-4"
      >
        {error ? (
          <ErrorState message={error} onRetry={() => {
            setError(null);
            setLoading(true);
            fetchPage(1, false, sort, inStockOnly).catch((e) => setError(String(e?.message ?? e))).finally(() => setLoading(false));
          }} />
        ) : loading ? (
          <ProductGridSkeleton />
        ) : products.length === 0 ? (
          <div className="space-y-6">
            <EmptyState
              icon="orders"
              title="لا توجد منتجات"
              description="ترقّب العروض الجديدة قريباً، أو تصفّح قسم آخر."
              actionLabel="تصفّح الأقسام"
              actionHref="/categories"
            />
            {siblings.length > 0 ? (
              <SiblingRail
                parent={parent}
                siblings={siblings}
                currentSlug={category.slug}
              />
            ) : null}
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {products.map((p, i) => (
                <li key={p.id}>
                  <ProductCard product={p} priority={i < 4} />
                </li>
              ))}
            </ul>
            {page < totalPages ? (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 px-6 h-11 rounded-2xl bg-white border border-gray-200 text-sm font-bold text-gray-900 hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {loadingMore ? (
                    <RefreshCcw className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>{loadingMore ? "جارٍ التحميل…" : "عرض المزيد"}</span>
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function CategoryIcon({ category, parent }: { category: CategoryRow; parent: CategoryRow | null }) {
  const src = resolveCategoryImageSrc(category.icon_url);
  const fallback = getCategoryEmoji(
    category.icon_url,
    emojiForCategoryName(category.name_ar)
  );
  if (!src && !fallback) return null;
  return (
    <div
      className="w-20 h-20 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm border border-gray-100"
      style={{
        background:
          "linear-gradient(135deg, rgba(0,147,69,0.10), rgba(0,147,69,0.04))",
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="max-w-14 max-h-14 object-contain"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="text-4xl" aria-hidden="true">
          {fallback}
        </span>
      )}
    </div>
  );
}

function SubCategoryRail({
  parent,
  children,
  currentSlug,
}: {
  parent: CategoryRow;
  children: CategoryRow[];
  currentSlug: string;
}) {
  return (
    <nav
      aria-label="الأقسام الفرعية"
      className="bg-white border-b border-gray-100"
    >
      <div className="px-4 py-3 flex items-center justify-between mb-1">
        <p className="text-2xs font-bold text-gray-500">
          الأقسام الفرعية لـ {parent.name_ar}
        </p>
        <Link
          href={`/categories/${encodeURIComponent(parent.slug)}`}
          className="text-2xs font-bold text-primary"
        >
          عرض الكل
        </Link>
      </div>
      <ul className="px-4 pb-3 flex gap-2 overflow-x-auto scrollbar-hide">
        <li className="flex-shrink-0">
          <Link
            href={`/categories/${encodeURIComponent(parent.slug)}`}
            className="px-3 py-2 rounded-xl bg-primary text-white text-xs font-bold whitespace-nowrap"
            aria-current={parent.slug === currentSlug ? "page" : undefined}
          >
            كل منتجات {parent.name_ar}
          </Link>
        </li>
        {children.map((c) => {
          const active = c.slug === currentSlug;
          return (
            <li key={c.id} className="flex-shrink-0">
              <Link
                href={`/categories/${encodeURIComponent(c.slug)}`}
                className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap border transition ${
                  active
                    ? "bg-primary text-white border-primary"
                    : "bg-white text-gray-700 border-gray-200 hover:border-primary hover:text-primary"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {c.name_ar}
                {c.product_count ? (
                  <span
                    className={`ms-1.5 text-tiny ${active ? "opacity-80" : "text-gray-400"}`}
                    dir="ltr"
                  >
                    ({c.product_count})
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SiblingRail({
  parent,
  siblings,
  currentSlug,
}: {
  parent: CategoryRow | null;
  siblings: CategoryRow[];
  currentSlug: string;
}) {
  return (
    <nav
      aria-label={parent ? `أقسام مشابهة في ${parent.name_ar}` : "أقسام مشابهة"}
      className="bg-white border-b border-gray-100"
    >
      <div className="px-4 py-3 flex items-center justify-between mb-1">
        <p className="text-2xs font-bold text-gray-500">
          {parent ? `أقسام أخرى في ${parent.name_ar}` : "أقسام مشابهة"}
        </p>
        {parent ? (
          <Link
            href={`/categories/${encodeURIComponent(parent.slug)}`}
            className="text-2xs font-bold text-primary"
          >
            عرض الكل
          </Link>
        ) : null}
      </div>
      <ul className="px-4 pb-3 flex gap-2 overflow-x-auto scrollbar-hide">
        {siblings.map((c) => {
          const active = c.slug === currentSlug;
          return (
            <li key={c.id} className="flex-shrink-0">
              <Link
                href={`/categories/${encodeURIComponent(c.slug)}`}
                className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap border transition ${
                  active
                    ? "bg-primary text-white border-primary"
                    : "bg-white text-gray-700 border-gray-200 hover:border-primary hover:text-primary"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true">
                    {getCategoryEmoji(c.icon_url, emojiForCategoryName(c.name_ar))}
                  </span>
                  {c.name_ar}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SortPill({ current, onChange }: { current: Sort; onChange: (s: Sort) => void }) {
  const opts: Array<{ key: Sort; label: string }> = [
    { key: "popular", label: "الأكثر طلباً" },
    { key: "price-asc", label: "السعر ↑" },
    { key: "price-desc", label: "السعر ↓" },
    { key: "newest", label: "الأحدث" },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {opts.map((o) => (
        <Chip
          key={o.key}
          label={o.label}
          selected={o.key === current}
          onClick={() => onChange(o.key)}
          size="sm"
        />
      ))}
    </div>
  );
}

function StockToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Chip
      label="متوفر فقط"
      selected={value}
      onClick={() => onChange(!value)}
      variant="outlined"
      size="sm"
    />
  );
}

function ProductGridSkeleton() {
  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i}>
          <ProductCardSkeleton />
        </li>
      ))}
    </ul>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="my-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3">
      <ArrowRight className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0 rotate-180" aria-hidden="true" />
      <div className="flex-1">
        <p className="text-sm font-bold text-red-900">تعذّر تحميل المنتجات</p>
        <p className="text-xs text-red-700 mt-1">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-red-700 hover:text-red-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded-lg px-2 py-1"
        >
          <RefreshCcw className="w-3.5 h-3.5" aria-hidden="true" />
          إعادة المحاولة
        </button>
      </div>
    </div>
  );
}
