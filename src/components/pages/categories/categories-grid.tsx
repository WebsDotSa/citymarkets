"use client";

/**
 * RootGrid + CategoryCard
 *
 * The main grid of sub-category cards for the currently-active root.
 * Each child renders as a card with image + name + product count, plus
 * (when it has grandchildren) a small pill rail for depth-3 navigation.
 *
 * State: parent owns which sub-category is selected so the products panel
 * can fetch in aggregate vs direct mode accordingly.
 */

import Link from "next/link";
import { ChevronLeft, X } from "lucide-react";
import type { CategoryTreeNode } from '@/lib/catalog';
import {
  getCategoryEmoji,
  resolveCategoryImageSrc,
} from '@/lib/catalog';
import { emojiForCategoryName } from '@/lib/catalog';

interface RootGridProps {
  root: CategoryTreeNode;
  query: string;
  selectedChildSlug: string | null;
  onSelectChildSlug: (slug: string | null) => void;
}

export function RootGrid({
  root,
  query,
  selectedChildSlug,
  onSelectChildSlug,
}: RootGridProps) {
  const filterActive = selectedChildSlug != null;
  return (
    <section aria-labelledby={`root-${root.id}`} className="mt-4 md:mt-0">
      <header className="flex items-end justify-between gap-3 mb-3 px-1 flex-wrap">
        <div>
          <h2
            id={`root-${String(root.id)}`}
            className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight"
          >
            {root.name_ar}
          </h2>
          <p className="text-2xs text-gray-500 mt-0.5" dir="ltr">
            {root.children.length}{" "}
            {root.children.length === 1 ? "قسم فرعي" : "أقسام فرعية"} ·{" "}
            {root.descendantCount.toLocaleString("en-US")} منتج
          </p>
        </div>
        <div className="flex items-center gap-2">
          {filterActive ? (
            <button
              type="button"
              onClick={() => onSelectChildSlug(null)}
              className="inline-flex items-center gap-1 text-xs sm:text-sm font-bold text-gray-600 hover:text-gray-900 transition-colors"
            >
              <span>إلغاء التصفية</span>
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          ) : null}
          <Link
            href={`/categories/${encodeURIComponent(root.slug)}`}
            className="inline-flex items-center gap-1 text-xs sm:text-sm font-bold text-primary hover:text-primary-dark transition-colors"
          >
            <span>عرض كل المنتجات</span>
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      </header>

      {root.children.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-12 bg-white rounded-2xl">
          لا توجد أقسام فرعية في هذا التصنيف حالياً.
        </p>
      ) : (
        <ul
          role="list"
          aria-label="أقسام فرعية — اضغط للتصفية"
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-2.5 sm:gap-3"
        >
          {(root.children as CategoryTreeNode[]).map((child, idx) => {
            const isActive = child.slug === selectedChildSlug;
            return (
              <li key={String(child.id)}>
                <CategoryCard
                  node={child}
                  query={query}
                  priority={idx < 4}
                  isActive={isActive}
                  onToggle={() =>
                    onSelectChildSlug(isActive ? null : child.slug)
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface CategoryCardProps {
  node: CategoryTreeNode;
  query: string;
  priority: boolean;
  isActive: boolean;
  onToggle: () => void;
}

function CategoryCard({
  node,
  query,
  priority,
  isActive,
  onToggle,
}: CategoryCardProps) {
  const src = resolveCategoryImageSrc(node.icon_url);
  const emoji = getCategoryEmoji(
    node.icon_url,
    emojiForCategoryName(node.name_ar),
  );
  const productCount = node.product_count ?? 0;
  const hasGrandchildren = node.children.length > 0;

  return (
    <article
      className={`relative rounded-2xl bg-white border overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5 ${
        isActive
          ? "border-primary ring-2 ring-primary/30 shadow-md"
          : "border-gray-100 shadow-xs"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={isActive}
        aria-label={`${node.name_ar} — ${productCount} منتج${
          isActive ? " (محدد)" : ""
        }`}
        className="w-full text-start p-3 sm:p-3.5"
      >
        <div className="flex flex-col items-center text-center gap-2">
          <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-white overflow-hidden shrink-0 flex items-center justify-center">
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt=""
                loading={priority ? "eager" : "lazy"}
                decoding="async"
                className="w-full h-full object-contain"
              />
            ) : (
              <span
                className="text-2xl drop-shadow-sm select-none"
                aria-hidden="true"
              >
                {emoji}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0 w-full">
            <p className="text-sm font-bold text-gray-900 leading-tight line-clamp-2">
              {highlight(node.name_ar, query)}
            </p>
            <p className="text-2xs text-gray-500 mt-0.5" dir="ltr">
              {productCount.toLocaleString("en-US")} منتج
            </p>
          </div>
        </div>
      </button>

      {hasGrandchildren ? (
        <div className="px-3 pb-3 pt-0 border-t border-gray-100 mt-1">
          <ul
            role="list"
            className="flex flex-wrap gap-1.5 pt-2.5"
            aria-label={`أقسام ${node.name_ar}`}
          >
            {node.children.slice(0, 4).map((g) => (
              <li key={String(g.id)}>
                <Link
                  href={`/categories/${encodeURIComponent(g.slug)}`}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-50 hover:bg-gray-100 ring-1 ring-gray-200/60 px-2.5 py-1 text-tiny font-bold text-gray-700 transition-colors"
                >
                  <span>{g.name_ar}</span>
                  <span className="text-gray-400 tabular-nums" dir="ltr">
                    {g.product_count ?? 0}
                  </span>
                </Link>
              </li>
            ))}
            {node.children.length > 4 ? (
              <li>
                <Link
                  href={`/categories/${encodeURIComponent(node.slug)}`}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-50 ring-1 ring-gray-200/60 px-2.5 py-1 text-tiny font-bold text-gray-500 hover:bg-gray-100"
                >
                  +{node.children.length - 4}
                </Link>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

/* ------------------------------------------------------------------------- */
/* Search highlight (used by CategoryCard)                                  */
/* ------------------------------------------------------------------------- */

function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-200/70 text-gray-900 rounded px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}
