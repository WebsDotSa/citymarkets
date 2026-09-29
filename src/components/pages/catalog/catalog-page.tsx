"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Search, X, ChevronLeft, Flame, Grid, List, ShoppingCart, User, ArrowLeft, SlidersHorizontal, Filter, Compass } from "lucide-react";
import { useCart } from "@/contexts/cart-context";
import type { Product } from "@/lib/types";
import Link from "next/link";
import Image from "next/image";
import { ProductCard } from "@/components/storefront/product-card";
// CATEGORY_GROUPS removed (legacy static data was stale — DB-derived groups
// are the only source of truth now). Catalog still supports `?category=`.
// The `?group=` URL param is ignored since none of the legacy slugs match
// the live DB. Code that referenced CATEGORY_GROUPS / getGroupForSlug now
// uses empty fallbacks so callers keep compiling without behavior change.
interface LegacyCategoryGroup {
  id: string;
  title: string;
  emoji: string;
  slugs: string[];
}
const CATEGORY_GROUPS: LegacyCategoryGroup[] = [];
const getGroupForSlug = (_slug: string): LegacyCategoryGroup | undefined => undefined;
import { getCategoryEmoji } from '@/lib/catalog';
import { CatalogPageSkeleton, ProductCardSkeleton } from "@/components/design/skeleton";
import { EmptySearch } from "@/components/design/empty-state";

function getCategoryIcon(iconUrl: string | null): string {
  return getCategoryEmoji(iconUrl);
}

export function CatalogPage() {
  const searchParams = useSearchParams();
  const { addItem } = useCart();
  const categorySlug = searchParams.get("category");
  const groupId = searchParams.get("group");
  const qParam = searchParams.get("q");
  const dealsParam = searchParams.get("deals");
  const [search, setSearch] = useState(qParam || "");
  const [selectedCategory, setSelectedCategory] = useState(categorySlug || "");
  const [sortBy, setSortBy] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [subCategories, setSubCategories] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [page, setPage] = useState(1);
  const [showSort, setShowSort] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [filterTick, setFilterTick] = useState(0);

  // Keep the URL `?q=` in lockstep with the search box so a refresh
  // (or share-link) preserves the query. We use replaceState to avoid
  // creating a new history entry on every keystroke.
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (value.trim()) url.searchParams.set("q", value);
      else url.searchParams.delete("q");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  };

  // Fetch categories
  useEffect(() => {
    fetch("/api/v1/categories")
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setCategories(res.data || []);
      })
      .catch(console.error);
  }, []);

  const activeGroup = groupId
    ? CATEGORY_GROUPS.find((g) => g.id === groupId)
    : undefined;

  // Set selected category from URL
  useEffect(() => {
    if (categorySlug) {
      setSelectedCategory(categorySlug);
    } else if (groupId && activeGroup?.slugs.length) {
      setSelectedCategory(activeGroup.slugs[0]);
    } else {
      setSelectedCategory("");
    }
    setPage(1);
    if (qParam) setSearch(qParam);
  }, [categorySlug, qParam, groupId, activeGroup]);

  // Fetch products
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedCategory) params.set("category", selectedCategory);
    else if (dealsParam === "true") params.set("deals", "true");
    if (search) params.set("search", search);
    if (sortBy) params.set("sort", sortBy);
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    if (inStockOnly) params.set("inStock", "true");
    params.set("page", page.toString());
    params.set("limit", "24");

    fetch(`/api/v1/products?${params.toString()}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setProducts(Array.isArray(res.data) ? res.data : res.data?.data || []);
          setTotal(res.pagination?.total || 0);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [selectedCategory, search, sortBy, page, dealsParam, minPrice, maxPrice, inStockOnly, filterTick]);

  // Get subcategories
  useEffect(() => {
    if (selectedCategory && categories.length > 0) {
      const parentCat = categories.find((c) => c.slug === selectedCategory);
      if (parentCat) {
        const subs = categories.filter((c) => c.parent_id === parentCat.id);
        setSubCategories(subs.length > 0 ? subs : []);
      } else {
        // Check if selected category is a subcategory
        const cat = categories.find((c) => c.slug === selectedCategory);
        if (cat?.parent_id) {
          const parent = categories.find((c) => c.id === cat.parent_id);
          if (parent) {
            const subs = categories.filter((c) => c.parent_id === parent.id);
            setSubCategories(subs.length > 0 ? subs : []);
          } else {
            setSubCategories([]);
          }
        } else {
          setSubCategories([]);
        }
      }
    } else {
      setSubCategories([]);
    }
  }, [selectedCategory, categories]);

  const selectedCat = categories.find((c) => c.slug === selectedCategory);
  const selectedCatName = selectedCat?.name_ar || selectedCategory || "جميع المنتجات";
  const selectedCatIcon = selectedCat?.icon_url;

  // Get sibling categories (for navigation)
  const siblingCategories = (() => {
    if (activeGroup && activeGroup.slugs) {
      return categories.filter((c) => activeGroup!.slugs.includes(c.slug));
    }
    const group = selectedCat ? getGroupForSlug(selectedCat.slug) : undefined;
    if (group) {
      return categories.filter((c) => group!.slugs.includes(c.slug));
    }
    if (!selectedCat) return [];
    if (selectedCat.parent_id) {
      return categories.filter((c) => c.parent_id === selectedCat.parent_id);
    }
    return categories.filter((c) => !c.parent_id).slice(0, 12);
  })();

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header - Fixed */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-600">
              <ArrowLeft className="w-6 h-6" />
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{getCategoryIcon(selectedCatIcon)}</span>
              <h1 className="font-bold text-gray-800 text-lg">{selectedCatName}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/cart" className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center relative">
              <ShoppingCart className="w-5 h-5 text-primary" />
            </Link>
          </div>
        </div>

      </div>

      {/* Search bar — visible editor for the `?q=` URL param so users
          arriving from the hero search can refine their query without
          going back to the home page. Updates the URL on every change
          via replaceState so the query is shareable + survives refresh. */}
      <div className="px-4 py-2.5 bg-white border-b border-gray-100">
        <div className="flex items-center gap-2 h-11 px-3 bg-gray-50 rounded-2xl border border-gray-200 focus-within:border-primary/40 focus-within:bg-white focus-within:shadow-sm transition-all">
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            type="search"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="ابحث في المنتجات..."
            aria-label="البحث في المنتجات"
            className="flex-1 bg-transparent outline-none text-sm text-gray-900 placeholder:text-gray-400"
          />
          {search && (
            <button
              type="button"
              onClick={() => handleSearchChange("")}
              aria-label="مسح البحث"
              className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors"
            >
              <X className="w-3.5 h-3.5 text-gray-600" />
            </button>
          )}
        </div>
      </div>

      {/* Canonical-section banner — when user is viewing this legacy
          /catalog?category= view, gently point them at the modern
          /categories/[slug] page that has breadcrumb, full sub-tree,
          and proper SEO. Sets robots to noindex already (see
          src/app/catalog/page.tsx metadata). */}
      {selectedCat?.slug && (
        <div className="bg-gradient-to-l from-primary/5 to-primary/10 border-b border-primary/10">
          <Link
            href={`/categories/${encodeURIComponent(selectedCat.slug)}`}
            className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm hover:bg-primary/10 transition-colors"
            aria-label={`تصفّح صفحة ${selectedCatName} الكاملة`}
          >
            <div className="flex items-center gap-2 text-primary font-medium">
              <Compass className="w-4 h-4" />
              <span>تصفّح صفحة {selectedCatName} الكاملة</span>
            </div>
            <ChevronLeft className="w-4 h-4 text-primary" />
          </Link>
        </div>
      )}

      {/* Sibling Categories - Horizontal Scroll */}
      {siblingCategories.length > 0 && (
        <div className="bg-white border-b">
          <div className="px-4 py-3">
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              <button
                onClick={() => setSelectedCategory("")}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  !selectedCategory ? "bg-primary text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                الكل
              </button>
              {siblingCategories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.slug)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${
                    selectedCategory === cat.slug ? "bg-primary text-white" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  <span>{getCategoryIcon(cat.icon_url)}</span>
                  <span>{cat.name_ar}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sub-categories - Horizontal Scroll */}
      {subCategories.length > 0 && (
        <div className="bg-white border-b">
          <div className="px-4 py-3">
            <p className="text-xs text-gray-400 mb-2 font-medium">الأقسام الفرعية</p>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              <button
                onClick={() => setSelectedCategory(selectedCategory.split(',')[0])}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  !selectedCategory.includes(',') ? "bg-primary text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                الكل
              </button>
              {subCategories.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setSelectedCategory(sub.slug)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    selectedCategory === sub.slug ? "bg-primary text-white" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {getCategoryIcon(sub.icon_url)} {sub.name_ar}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Results count & Sort */}
      <div className="px-4 py-3 flex items-center justify-between bg-white mt-2">
        <div>
          <p className="text-sm text-gray-500">
            {loading ? (
              "جاري التحميل..."
            ) : search ? (
              <>
                {total} نتيجة{" "}
                <span className="text-gray-400">عن "{search}"</span>
              </>
            ) : (
              `${total} منتج`
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm ${
              minPrice || maxPrice || inStockOnly
                ? "bg-primary text-white"
                : "bg-gray-100 text-gray-600"
            }`}
            aria-expanded={showFilters}
            aria-label="فلترة"
          >
            <Filter className="w-4 h-4" />
            فلتر
          </button>
          <button
            onClick={() => setShowSort(!showSort)}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-600"
          >
            <SlidersHorizontal className="w-4 h-4" />
            ترتيب
          </button>
          <div className="flex bg-gray-100 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 ${viewMode === "grid" ? "bg-primary text-white" : "text-gray-400"}`}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 ${viewMode === "list" ? "bg-primary text-white" : "text-gray-400"}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Sort Dropdown */}
      {showSort && (
        <div className="px-4 py-2 bg-white border-t flex gap-2 overflow-x-auto scrollbar-hide">
          {[
            { value: "", label: "الافتراضي" },
            { value: "price-asc", label: "السعر: الأقل أولاً" },
            { value: "price-desc", label: "السعر: الأعلى أولاً" },
            { value: "newest", label: "الأحدث" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setSortBy(opt.value);
                setShowSort(false);
              }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${
                sortBy === opt.value ? "bg-primary text-white" : "bg-gray-100 text-gray-600"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Filters Panel */}
      {showFilters && (
        <div className="px-4 py-3 bg-white border-t space-y-3">
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">نطاق السعر (ر.س)</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="من"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value.replace(/[^\d.]/g, ""))}
                className="flex-1 h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label="أقل سعر"
              />
              <span className="text-gray-400">-</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="إلى"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value.replace(/[^\d.]/g, ""))}
                className="flex-1 h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label="أعلى سعر"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={(e) => setInStockOnly(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/40"
            />
            المتوفر فقط
          </label>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setMinPrice("");
                setMaxPrice("");
                setInStockOnly(false);
              }}
              className="flex-1 h-10 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium"
            >
              إعادة ضبط
            </button>
            <button
              type="button"
              onClick={() => {
                setPage(1);
                setFilterTick((t) => t + 1);
                setShowFilters(false);
              }}
              className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-medium"
            >
              تطبيق
            </button>
          </div>
        </div>
      )}

      {/* Products Grid/List */}
      <div className="px-4 mt-2">
        {loading ? (
          <div className="grid grid-cols-3 gap-2">
            {[...Array(9)].map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : products.length > 0 ? (
          viewMode === "grid" ? (
            <div className="grid grid-cols-3 gap-2">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {products.map((product) => (
                <ProductCardList key={product.id} product={product} onAdd={() => addItem(product)} />
              ))}
            </div>
          )
        ) : (
          <EmptySearch query={search} />
        )}
      </div>

      {/* Pagination */}
      {total > 24 && (() => {
        const totalPages = Math.ceil(total / 24);
        const current = page;
        // Build a windowed page list: 1 ... [c-1, c, c+1] ... N
        const pages: (number | "ellipsis")[] = [];
        const push = (p: number | "ellipsis") => {
          if (pages[pages.length - 1] !== p) pages.push(p);
        };
        const window = new Set<number>();
        for (let i = current - 1; i <= current + 1; i++) {
          if (i >= 1 && i <= totalPages) window.add(i);
        }
        // Always include first and last
        window.add(1);
        window.add(totalPages);
        const sorted = [...window].sort((a, b) => a - b);
        for (let i = 0; i < sorted.length; i++) {
          if (i > 0 && sorted[i] - sorted[i - 1] > 1) push("ellipsis");
          push(sorted[i]);
        }

        return (
          <div className="px-4 py-6 flex items-center justify-center gap-2 flex-wrap" role="navigation" aria-label="ترقيم الصفحات">
            <button
              onClick={() => setPage(Math.max(1, current - 1))}
              disabled={current === 1}
              className="h-10 px-3 rounded-full text-sm font-medium bg-white text-gray-700 border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
              aria-label="الصفحة السابقة"
            >
              ‹ السابق
            </button>
            {pages.map((p, i) =>
              p === "ellipsis" ? (
                <span key={`e-${i}`} className="w-10 h-10 flex items-center justify-center text-gray-400">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  aria-current={p === current ? "page" : undefined}
                  className={`w-10 h-10 rounded-full text-sm font-medium ${
                    p === current
                      ? "bg-primary text-white"
                      : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {p}
                </button>
              )
            )}
            <button
              onClick={() => setPage(Math.min(totalPages, current + 1))}
              disabled={current === totalPages}
              className="h-10 px-3 rounded-full text-sm font-medium bg-white text-gray-700 border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
              aria-label="الصفحة التالية"
            >
              التالي ›
            </button>
          </div>
        );
      })()}
    </div>
  );
}

function ProductCardGrid({ product, onAdd }: { product: Product; onAdd: () => void }) {
  const [added, setAdded] = useState(false);

  const handleAdd = () => {
    onAdd();
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className="h-36 bg-gray-100 relative">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name_ar}
            fill
            sizes="(max-width: 640px) 50vw, 200px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex items-center justify-center h-full text-4xl">📦</div>
        )}
        {product.discount_price && (
          <span className="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded-full">
            خصم
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="text-xs text-gray-800 line-clamp-2 leading-tight min-h-[2.5rem]">
          {product.name_ar}
        </p>
        {product.category_name && (
          <p className="text-[10px] text-gray-400 mt-1">{product.category_name}</p>
        )}
        <div className="mt-2 flex items-center justify-between">
          <div>
            <span className="text-sm font-bold text-primary">
              {product.discount_price || product.price}ر.س
            </span>
            {product.discount_price && (
              <span className="text-[10px] text-gray-400 line-through mr-1">{product.price}</span>
            )}
          </div>
        </div>
        <button
          onClick={handleAdd}
          className={`w-full mt-2 py-2 rounded-lg text-xs font-medium transition-all ${
            added ? "bg-green-500 text-white" : "bg-primary text-white"
          }`}
        >
          {added ? "✓ أضيف" : "إضافة للسلة"}
        </button>
      </div>
    </div>
  );
}

function ProductCardList({ product, onAdd }: { product: Product; onAdd: () => void }) {
  const [added, setAdded] = useState(false);

  const handleAdd = () => {
    onAdd();
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm p-3 flex gap-3">
      <div className="relative w-24 h-24 bg-gray-100 rounded-xl flex-shrink-0 overflow-hidden">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name_ar}
            fill
            sizes="96px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex items-center justify-center h-full text-3xl">📦</div>
        )}
      </div>
      <div className="flex-1">
        <p className="text-sm text-gray-800 line-clamp-2">{product.name_ar}</p>
        {product.category_name && (
          <p className="text-xs text-gray-400 mt-1">{product.category_name}</p>
        )}
        <div className="mt-2 flex items-center justify-between">
          <div>
            <span className="text-base font-bold text-primary">
              {product.discount_price || product.price}ر.س
            </span>
            {product.discount_price && (
              <span className="text-xs text-gray-400 line-through mr-1">{product.price}</span>
            )}
          </div>
          <button
            onClick={handleAdd}
            className={`px-4 py-2 rounded-lg text-xs font-medium ${
              added ? "bg-green-500 text-white" : "bg-primary text-white"
            }`}
          >
            {added ? "✓" : "+"}
          </button>
        </div>
      </div>
    </div>
  );
}
