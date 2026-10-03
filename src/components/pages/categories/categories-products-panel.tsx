"use client";

/**
 * ProductsPanel
 *
 * Fetches + renders the products for the active root category. Two modes:
 *
 *   • Aggregate (no sub-category selected)  → fetch root + every descendant
 *     in one call (include_children=1), dedup by id as a safety net.
 *   • Direct (sub-category selected)        → fetch that sub-category only,
 *     no include_children.
 *
 * Parent passes `key` so a root change remounts this component and resets
 * scroll + loading state. Retry button bumps a nonce to force re-fetch.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Package, RefreshCcw } from "lucide-react";
import type { CategoryTreeNode } from '@/lib/catalog';
import type { Product } from "@/lib/types";
import { safeFetchJson } from "@/lib/safe-fetch";
import { ProductCard } from "@/components/storefront/product-card";
import {
  dedupeById,
  mapApiItemToProduct,
  type ProductsApiItem,
} from "./categories-helpers";

interface ProductsPanelProps {
  root: CategoryTreeNode;
  selectedChildSlug: string | null;
}

export function ProductsPanel({
  root,
  selectedChildSlug,
}: ProductsPanelProps) {
  const children = root.children ?? [];
  const selectedChild =
    selectedChildSlug != null
      ? children.find((c) => c.slug === selectedChildSlug) ?? null
      : null;

  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the retry button to force the fetch effect to re-run
  // without the caller having to own refetch wiring.
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchAggregate = async (): Promise<Product[]> => {
      // Pull root + every descendant in a single call. The recursive
      // CTE in /api/v1/products handles tree walking, so the round-trip
      // is one request.
      const url = `/api/v1/products?category=${encodeURIComponent(
        root.slug,
      )}&include_children=1&limit=12`;
      const res = await safeFetchJson<{
        success: boolean;
        data: ProductsApiItem[];
        pagination: { total: number };
      }>(url);
      if (!res) return [];
      return (res.data ?? []).map(mapApiItemToProduct);
    };

    const fetchDirect = async (childSlug: string): Promise<Product[]> => {
      const url = `/api/v1/products?category=${encodeURIComponent(
        childSlug,
      )}&limit=24`;
      const res = await safeFetchJson<{
        success: boolean;
        data: ProductsApiItem[];
        pagination: { total: number };
      }>(url);
      if (!res) return [];
      return (res.data ?? []).map(mapApiItemToProduct);
    };

    (async () => {
      try {
        if (selectedChildSlug == null) {
          // Aggregate mode: one request covers root + descendants. The
          // products_unified view assigns each product to a single
          // category_id, so duplicates shouldn't occur, but we dedup
          // by id explicitly as a defensive measure in case future
          // migrations union overlapping slices.
          const merged = await fetchAggregate();
          if (cancelled) return;
          const deduped = dedupeById(merged);
          setProducts(deduped);
          setTotal(deduped.length);
          setError(null);
        } else {
          // Direct mode: fetch the sub-category's products only.
          const list = await fetchDirect(selectedChildSlug);
          if (cancelled) return;
          setProducts(list);
          setTotal(list.length);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String((e as Error)?.message ?? e));
          setProducts([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [root.slug, selectedChildSlug, retryNonce]);

  const showAllHref = `/categories/${encodeURIComponent(root.slug)}`;
  const mode: "aggregate" | "direct" =
    selectedChildSlug == null ? "aggregate" : "direct";

  return (
    <section
      aria-labelledby={`products-${root.id}`}
      aria-label="منتجات القسم"
      className="mt-6 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5"
    >
      <header className="flex items-end justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2
            id={`products-${String(root.id)}`}
            className="text-lg sm:text-xl font-black text-gray-900 tracking-tight"
          >
            منتجات
            {selectedChild ? (
              <span className="text-gray-500"> · {selectedChild.name_ar}</span>
            ) : null}
          </h2>
          <p
            className="text-2xs sm:text-xs text-gray-500 mt-0.5"
            aria-live="polite"
            dir="ltr"
          >
            {loading
              ? "جارٍ التحميل…"
              : `${total.toLocaleString("en-US")} منتج`}
            {mode === "aggregate" && children.length > 0
              ? " · من كل الأقسام الفرعية"
              : selectedChild
                ? ` · من ${selectedChild.name_ar}`
                : ""}
          </p>
        </div>
        <Link
          href={showAllHref}
          className="inline-flex items-center gap-1 text-xs sm:text-sm font-bold text-primary hover:text-primary-dark transition-colors"
        >
          <span>عرض كل المنتجات</span>
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </Link>
      </header>

      {error ? (
        <ProductsErrorState
          message={error}
          onRetry={() => setRetryNonce((n) => n + 1)}
        />
      ) : loading ? (
        <ProductsSkeleton />
      ) : products.length === 0 ? (
        <ProductsEmptyState mode={mode} />
      ) : (
        <>
          <ul
            role="list"
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
          >
            {products.map((p, i) => (
              <li key={p.id}>
                <ProductCard product={p} priority={i < 4} />
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-center">
            <Link
              href={
                selectedChild
                  ? `/categories/${encodeURIComponent(selectedChild.slug)}`
                  : showAllHref
              }
              className="inline-flex items-center gap-1.5 px-5 h-10 rounded-2xl bg-white border border-gray-200 text-xs sm:text-sm font-bold text-gray-900 hover:bg-gray-50 transition-colors"
            >
              <span>المزيد من المنتجات</span>
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Panel states                                                              */
/* ------------------------------------------------------------------------- */

function ProductsSkeleton() {
  return (
    <ul
      role="list"
      aria-label="يتم تحميل المنتجات"
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="rounded-2xl bg-gray-100 animate-pulse h-56" />
      ))}
    </ul>
  );
}

function ProductsEmptyState({ mode }: { mode: "aggregate" | "direct" }) {
  return (
    <div className="text-center py-10 px-4">
      <div className="mx-auto w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
        <Package className="w-5 h-5 text-gray-400" aria-hidden="true" />
      </div>
      <p className="text-sm font-bold text-gray-700 mb-1">لا توجد منتجات</p>
      <p className="text-xs text-gray-500">
        {mode === "direct"
          ? "لا توجد منتجات في هذا القسم الفرعي حالياً."
          : "لا توجد منتجات في هذا القسم الرئيسي حالياً."}
      </p>
    </div>
  );
}

function ProductsErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="text-center py-10 px-4">
      <div className="mx-auto w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center mb-3">
        <RefreshCcw
          className="w-5 h-5 text-rose-500"
          aria-hidden="true"
        />
      </div>
      <p className="text-sm font-bold text-gray-700 mb-1">
        تعذّر تحميل المنتجات
      </p>
      <p className="text-xs text-gray-500 mb-3 break-all">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-primary text-white text-xs font-bold hover:bg-primary-dark transition-colors"
      >
        <RefreshCcw className="w-3.5 h-3.5" aria-hidden="true" />
        إعادة المحاولة
      </button>
    </div>
  );
}
