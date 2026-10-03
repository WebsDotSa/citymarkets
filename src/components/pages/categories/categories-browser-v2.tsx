"use client";

/**
 * CategoriesBrowserV2
 *
 * Top-level component for the redesigned /categories page. Owns the
 * page state (search query, active root, selected child) and delegates
 * rendering to the focused sub-components:
 *
 *   • PageHero            — search box + hybrid category/product results
 *   • MainCatsImageStrip  — sticky horizontal root picker
 *   • RootGrid            — child cards (with depth-3 pills)
 *   • ProductsPanel       — aggregate vs direct product fetch
 *   • EmptyState / FooterNote
 *
 * Sub-components live in sibling files to keep this wrapper under
 * the 800-line soft cap while staying behavior-preserving.
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │  🔍 Search  · 11 roots · 138 subcategories       │
 *   ├────────────┬─────────────────────────────────────┤
 *   │  Roots     │  Active root: المقاضي (27)          │
 *   │  (sticky)  │  ┌──┐┌──┐┌──┐┌──┐ ┌──┐┌──┐┌──┐┌──┐ │
 *   │  🥬 خضار   │  │  ││  ││  ││  │ │  ││  ││  ││  │ │
 *   │  🥛 ألبان  │  └──┘└──┘└──┘└──┘ └──┘└──┘└──┘└──┘ │
 *   │  🛒 مقاضي  │  Each card: name + product count    │
 *   │  🍫 سناك   │  Cards with children show pill rail │
 *   │  ...        │  for depth-3 navigation            │
 *   └────────────┴─────────────────────────────────────┘
 *
 * Marketing display order is the order the data is passed in — set on
 * the server in page.tsx. Search filters roots AND children
 * simultaneously. On mobile, the sidebar collapses into a horizontal
 * pill rail at the top.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Search } from "lucide-react";
import type { CategoryTreeNode } from '@/lib/catalog';
import {
  useDeliveryLocationActions,
  useDeliveryLocationState,
} from "@/contexts/delivery-location-context";
import { shortAddressLabel } from '@/lib/delivery';
import { safeFetchJson } from "@/lib/safe-fetch";
import type { SearchedProduct } from "./categories-helpers";
import { PageHero } from "./categories-page-hero";
import { MainCatsImageStrip } from "./categories-strip";
import { RootGrid } from "./categories-grid";
import { ProductsPanel } from "./categories-products-panel";

export interface CategoriesBrowserV2Props {
  /** Tree of root categories in marketing display order. */
  initialTree: CategoryTreeNode[];
  totalRoots: number;
  totalChildren: number;
  totalProducts: number;
}

export function CategoriesBrowserV2({
  initialTree,
  totalRoots,
  totalChildren,
  totalProducts,
}: CategoriesBrowserV2Props) {
  const { openSheet } = useDeliveryLocationActions();
  const { selectedAddress } = useDeliveryLocationState();
  const [query, setQuery] = useState("");
  const [activeRootId, setActiveRootId] = useState<string | null>(
    initialTree[0] ? String(initialTree[0].id) : null,
  );

  // Sub-category filter for the products panel. `null` = aggregate mode
  // (pulls products from the active root AND all its descendants via
  // include_children=1, then dedups by id client-side as a safety net).
  // When set to a child slug, only that sub-category's products are
  // fetched directly (no include_children).
  const [selectedChildSlug, setSelectedChildSlug] = useState<string | null>(
    null,
  );

  // When the active root changes, reset the sub-category filter so the
  // new root starts in aggregate mode.
  useEffect(() => {
    setSelectedChildSlug(null);
  }, [activeRootId]);

  // Hybrid product+category search. Categories are filtered instantly from
  // the in-memory tree. Products are fetched from /api/v1/products with a
  // debounce so we don't hammer the API while the user is still typing.
  const [productMatches, setProductMatches] = useState<{
    items: SearchedProduct[];
    loading: boolean;
  }>({ items: [], loading: false });

  // Filter the tree against the search box. Roots that match are kept
  // and shown highlighted; roots that don't match are kept if they have
  // a child that matches (so the user can still find the parent).
  const { filteredRoots, searchHits } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return { filteredRoots: initialTree, searchHits: 0 };
    }
    let hits = 0;
    const out = initialTree
      .map((root) => {
        const rootHit =
          root.name_ar.toLowerCase().includes(q) ||
          (root.name_en ?? "").toLowerCase().includes(q);
        const matchedChildren = root.children.filter(
          (c) =>
            c.name_ar.toLowerCase().includes(q) ||
            (c.name_en ?? "").toLowerCase().includes(q),
        );
        if (rootHit) {
          hits += 1 + root.children.length;
          return root;
        }
        if (matchedChildren.length > 0) {
          hits += matchedChildren.length;
          // Re-build a tree node keeping the existing identity.
          return Object.assign({}, root, {
            children: matchedChildren,
          }) as CategoryTreeNode;
        }
        return null;
      })
      .filter((r): r is CategoryTreeNode => r !== null);
    return { filteredRoots: out, searchHits: hits };
  }, [initialTree, query]);

  // Auto-select first filtered root if current selection is filtered out
  useEffect(() => {
    if (!activeRootId) return;
    if (!filteredRoots.find((r) => String(r.id) === activeRootId)) {
      setActiveRootId(filteredRoots[0] ? String(filteredRoots[0].id) : null);
    }
  }, [filteredRoots, activeRootId]);

  // Debounced product search. Categories are filtered locally (instant);
  // products are fetched from /api/v1/products so we don't pretend to know
  // what the catalog holds. AbortController cancels in-flight requests when
  // the query changes or the component unmounts.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setProductMatches({ items: [], loading: false });
      return;
    }
    const ctrl = new AbortController();
    setProductMatches((p) => ({ items: p.items, loading: true }));
    const timer = setTimeout(async () => {
      const res = await safeFetchJson<{
        data: Array<{
          id: string;
          name_ar: string;
          image_url: string | null;
          price: number | string;
          discount_price: number | string | null;
          stock_qty: number;
          category_name: string | null;
          category_slug: string | null;
        }>;
      }>(`/api/v1/products?search=${encodeURIComponent(q)}&limit=8`, {
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      const items: SearchedProduct[] = (res?.data ?? []).map((p) => ({
        id: String(p.id),
        name_ar: p.name_ar,
        image_url: p.image_url,
        price: Number(p.price) || 0,
        discount_price:
          p.discount_price != null ? Number(p.discount_price) : null,
        category_name: p.category_name,
        category_slug: p.category_slug,
        in_stock: Number(p.stock_qty) > 0,
      }));
      setProductMatches({ items, loading: false });
    }, 220);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const activeRoot = useMemo(
    () =>
      filteredRoots.find((r) => String(r.id) === activeRootId) ??
      filteredRoots[0] ??
      null,
    [filteredRoots, activeRootId],
  );

  const handleClearQuery = useCallback(() => setQuery(""), []);
  const handleSelectRoot = useCallback((id: string) => setActiveRootId(id), []);
  const handleSelectChildSlug = useCallback(
    (slug: string | null) => setSelectedChildSlug(slug),
    [],
  );

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-gray-100 text-slate-900 pb-24 md:pb-12 font-['IBM_Plex_Sans_Arabic','system-ui',sans-serif]"
    >
      <PageHero
        tree={initialTree}
        query={query}
        onQuery={setQuery}
        onOpenLocation={openSheet}
        locationLabel={shortAddressLabel(selectedAddress)}
        productMatches={productMatches}
        searchHits={searchHits}
        totalRoots={totalRoots}
        totalChildren={totalChildren}
        totalProducts={totalProducts}
      />

      {/* Main categories as a visual showcase. On mobile it scrolls
          horizontally; on desktop it's a responsive grid. The wrapper
          keeps role="navigation" + aria-label so existing tests pass,
          but renders medium image cards instead of text pills. */}
      <MainCatsImageStrip
        roots={filteredRoots}
        activeId={activeRootId}
        onSelect={handleSelectRoot}
        totalProducts={totalProducts}
      />

      <div className="px-0 sm:px-6 max-w-6xl mx-auto">
        <main
          id="categories-results"
          aria-live="polite"
          className="px-4 sm:px-0"
        >
          {activeRoot ? (
            <>
              <RootGrid
                key={`grid-${String(activeRoot.id)}`}
                root={activeRoot}
                query={query}
                selectedChildSlug={selectedChildSlug}
                onSelectChildSlug={handleSelectChildSlug}
              />
              <ProductsPanel
                key={`products-${String(activeRoot.id)}`}
                root={activeRoot}
                selectedChildSlug={selectedChildSlug}
              />
            </>
          ) : (
            <EmptyState
              query={query}
              onClear={handleClearQuery}
            />
          )}
        </main>
      </div>

      <FooterNote
        totalRoots={totalRoots}
        totalChildren={totalChildren}
        totalProducts={totalProducts}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Empty + footer (kept inline — both are tiny and used only here)          */
/* ------------------------------------------------------------------------- */

function EmptyState({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}) {
  return (
    <div className="text-center py-16 bg-white rounded-2xl mt-4">
      <div className="mx-auto w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
        <Search className="w-6 h-6 text-slate-400" aria-hidden="true" />
      </div>
      <h3 className="text-base font-bold text-slate-900 mb-1">لا توجد نتائج</h3>
      <p className="text-sm text-slate-500 mb-4">
        لا توجد نتائج مطابقة لـ «{query}»
      </p>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary-dark"
      >
        مسح البحث
      </button>
    </div>
  );
}

function FooterNote({
  totalRoots,
  totalChildren,
  totalProducts,
}: {
  totalRoots: number;
  totalChildren: number;
  totalProducts: number;
}) {
  return (
    <footer className="mt-12 mb-4 text-center text-xs text-slate-400">
      <p>
        {totalRoots} قسم رئيسي · {totalChildren} قسم فرعي ·{" "}
        <span dir="ltr" className="font-bold">
          {totalProducts.toLocaleString("en-US")}
        </span>{" "}
        منتج
      </p>
      <p className="mt-1 opacity-70">
        © {new Date().getFullYear()} أسواق سيتي · جميع الحقوق محفوظة
      </p>
    </footer>
  );
}
