"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useParams } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { useCartActions } from "@/contexts/cart-context";
import { vendorProductToCartProduct } from '@/lib/catalog';
import { SafeImage } from "@/components/ui/safe-image";
import { vendorTypeLabel, vendorTypeIcon } from '@/lib/catalog';

interface Vendor {
  id: string;
  slug: string;
  name: string;
  nameEn?: string;
  description?: string;
  logo?: string;
  banner?: string;
  type: string;
  primaryColor: string;
  contact: {
    phone?: string;
    whatsapp?: string;
  };
  address?: string;
  openTime: string;
  closeTime: string;
  isOpen: boolean;
  settings: {
    deliveryMode: string;
    minOrder: number;
    acceptsCod: boolean;
    acceptsOnlinePayment: boolean;
  };
}

interface Product {
  id: string;
  name: string;
  nameEn?: string;
  images: string[];
  price: number;
  discountPrice?: number;
  inStock: boolean;
  stock?: number;
}

const SORT_OPTIONS = [
  { value: "default", label: "الافتراضي" },
  { value: "price-asc", label: "السعر: الأقل أولاً" },
  { value: "price-desc", label: "السعر: الأعلى أولاً" },
  { value: "name", label: "الاسم" },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]["value"];

export default function VendorPage() {
  const params = useParams();
  const slug = params.slug as string;
  const router = useRouter();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"products" | "info">("products");
  const [addingToCart, setAddingToCart] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortValue>("default");
  const [onlyInStock, setOnlyInStock] = useState(false);
  const { showToast } = useToast();
  const { addItem: addToCartContext } = useCartActions();

  useEffect(() => {
    fetchVendorData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function fetchVendorData() {
    try {
      const [vendorRes, productsRes] = await Promise.all([
        fetch(`/api/v1/vendors/${slug}`),
        fetch(`/api/v1/vendors/${slug}/products`),
      ]);

      if (!vendorRes.ok) {
        throw new Error("المتجر غير موجود");
      }

      const vendorData = await vendorRes.json();
      const productsData = await productsRes.json();

      setVendor(vendorData.vendor);
      setProducts(productsData.products || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ في تحميل المتجر");
    } finally {
      setLoading(false);
    }
  }

  async function addToCart(product: Product) {
    setAddingToCart(product.id);
    try {
      const mapped = vendorProductToCartProduct(product, {
        vendorId: vendor?.id ?? "",
        vendorSlug: vendor?.slug ?? "",
        vendorName: vendor?.name ?? null,
      });
      addToCartContext(mapped, 1);
      window.dispatchEvent(new Event("cartUpdated"));
      showToast(`تمت إضافة "${product.name}" إلى السلة`, "success");
    } finally {
      setAddingToCart(null);
    }
  }

  const filteredProducts = useMemo(() => {
    let list = products;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (onlyInStock) {
      list = list.filter((p) => p.inStock);
    }
    const sorted = [...list];
    switch (sortBy) {
      case "price-asc":
        sorted.sort((a, b) => (a.discountPrice ?? a.price) - (b.discountPrice ?? b.price));
        break;
      case "price-desc":
        sorted.sort((a, b) => (b.discountPrice ?? b.price) - (a.discountPrice ?? a.price));
        break;
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name, "ar"));
        break;
    }
    return sorted;
  }, [products, searchQuery, onlyInStock, sortBy]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="h-56 sm:h-72 bg-slate-200 animate-pulse" />
        <div className="max-w-6xl mx-auto px-4 -mt-12 relative">
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-white border-4 border-white shadow-lg animate-pulse" />
          <div className="mt-4 h-6 w-40 bg-slate-200 rounded animate-pulse" />
          <div className="mt-2 h-4 w-60 bg-slate-200 rounded animate-pulse" />
        </div>
        <div className="max-w-6xl mx-auto px-4 mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl overflow-hidden">
              <div className="aspect-square bg-slate-100 animate-pulse" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-slate-100 rounded animate-pulse" />
                <div className="h-3 w-2/3 bg-slate-100 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !vendor) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-5xl">
            🏪
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">المتجر غير موجود</h1>
          <p className="text-slate-600 mb-6">{error}</p>
          <Link
            href="/vendors"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white font-bold rounded-2xl hover:opacity-90 transition-opacity"
          >
            عرض جميع المتاجر
          </Link>
        </div>
      </div>
    );
  }

  const featuredProducts = filteredProducts.slice(0, 4);

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* ── Hero Banner ── */}
      <div
        className="relative h-56 sm:h-72 lg:h-80 overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${vendor.primaryColor} 0%, ${vendor.primaryColor}cc 100%)`,
        }}
      >
        {vendor.banner && (
          <SafeImage
            src={vendor.banner}
            alt={vendor.name}
            fill
            sizes="100vw"
            className="object-cover opacity-90"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10" />

        {/* Top actions */}
        <div className="absolute top-4 inset-x-4 flex items-center justify-between z-10">
          <button
            onClick={() => router.back()}
            aria-label="رجوع"
            className="w-10 h-10 rounded-full bg-white/95 backdrop-blur-md flex items-center justify-center shadow-md hover:bg-white transition-colors"
          >
            <svg className="w-5 h-5 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            {vendor.contact.whatsapp && (
              <a
                href={`https://wa.me/${vendor.contact.whatsapp.replace(/[^0-9]/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="تواصل عبر واتساب"
                className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md hover:bg-emerald-600 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.7-.9-2.9-1.5-4-3.5-.3-.5.3-.5.9-1.6.1-.2.1-.4 0-.5-.1-.1-.7-1.5-.9-2.1-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3z"/>
                  <path d="M20.5 3.5C18.3 1.2 15.3 0 12.1 0 5.5 0 .1 5.4.1 12c0 2.1.6 4.2 1.6 6L0 24l6.2-1.6c1.7.9 3.7 1.4 5.7 1.4h.1c6.6 0 12-5.4 12-12 .1-3.2-1.2-6.2-3.5-8.3zM12 21.8h-.1c-1.8 0-3.6-.5-5.1-1.4l-.4-.2-3.7 1 1-3.6-.2-.4c-1-1.6-1.6-3.4-1.6-5.3 0-5.4 4.4-9.8 9.9-9.8 2.6 0 5.1 1 7 2.9 1.9 1.9 2.9 4.4 2.9 7-.1 5.5-4.5 9.8-9.7 9.8z"/>
                </svg>
              </a>
            )}
            {vendor.contact.phone && (
              <a
                href={`tel:${vendor.contact.phone}`}
                aria-label="اتصال"
                className="w-10 h-10 rounded-full bg-white/95 backdrop-blur-md text-slate-700 flex items-center justify-center shadow-md hover:bg-white transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
              </a>
            )}
          </div>
        </div>

        {/* Vendor name overlay on banner */}
        <div className="absolute bottom-4 inset-x-4 z-10">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur-md mb-2"
            style={{ background: "rgba(255,255,255,0.92)", color: vendor.primaryColor }}
          >
            <span>{vendorTypeIcon(vendor.type)}</span>
            <span>{vendorTypeLabel(vendor.type)}</span>
          </span>
          <h1 className="text-white text-2xl sm:text-3xl font-black drop-shadow-md tracking-tight">
            {vendor.name}
          </h1>
          {vendor.nameEn && (
            <p className="text-white/80 text-sm font-medium mt-0.5">{vendor.nameEn}</p>
          )}
        </div>
      </div>

      {/* ── Info Card (overlapping banner) ── */}
      <div className="max-w-6xl mx-auto px-4 -mt-14 relative z-10">
        <div className="bg-white rounded-2xl shadow-md border border-slate-100 p-4">
          <div className="flex items-start gap-3">
            <div
              className="shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-white border-4 shadow-sm flex items-center justify-center overflow-hidden -mt-12"
              style={{ borderColor: vendor.primaryColor }}
            >
              <SafeImage
                src={vendor.logo}
                alt={vendor.name}
                fill
                sizes="96px"
                className="object-contain"
                vendorSlug={vendor.slug}
              />
            </div>

            <div className="flex-1 min-w-0 pt-1">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    vendor.isOpen ? "bg-emerald-500 animate-pulse" : "bg-red-500"
                  }`}
                />
                <span className="text-xs font-bold text-slate-700">
                  {vendor.isOpen
                    ? "مفتوح الآن"
                    : `مغلق · يفتح ${vendor.openTime}`}
                </span>
              </div>
              {vendor.description && (
                <p className="mt-1.5 text-[13px] text-slate-600 line-clamp-2">
                  {vendor.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                  </svg>
                  {vendor.openTime} - {vendor.closeTime}
                </span>
                {vendor.settings.acceptsCod && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded-full">
                    💵 الدفع عند الاستلام
                  </span>
                )}
                {vendor.settings.acceptsOnlinePayment && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded-full">
                    💳 دفع إلكتروني
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="mt-5 border-b border-slate-200 sticky top-16 bg-slate-50/95 backdrop-blur-md z-20 -mx-4 px-4">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab("products")}
              className={`relative pb-3 text-sm font-bold transition-colors ${
                activeTab === "products"
                  ? "text-slate-900"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              المنتجات
              <span className="ms-1.5 text-xs text-slate-400 font-bold tabular-nums" dir="ltr">
                {products.length}
              </span>
              {activeTab === "products" && (
                <span
                  className="absolute inset-x-0 bottom-0 h-0.5 rounded-full"
                  style={{ background: vendor.primaryColor }}
                />
              )}
            </button>
            <button
              onClick={() => setActiveTab("info")}
              className={`relative pb-3 text-sm font-bold transition-colors ${
                activeTab === "info"
                  ? "text-slate-900"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              معلومات المتجر
              {activeTab === "info" && (
                <span
                  className="absolute inset-x-0 bottom-0 h-0.5 rounded-full"
                  style={{ background: vendor.primaryColor }}
                />
              )}
            </button>
          </div>
        </div>

        {/* ── Content ── */}
        {activeTab === "products" ? (
          <div className="mt-4">
            {/* Featured products carousel */}
            {featuredProducts.length > 0 && !searchQuery && (
              <section aria-label="منتجات مميزة" className="mb-6">
                <div className="flex items-end justify-between gap-3 mb-3 px-1">
                  <div>
                    <h2 className="text-lg font-black text-slate-900 tracking-tight">
                      ⭐ الأكثر طلباً
                    </h2>
                  </div>
                </div>
                <div className="flex gap-3 overflow-x-auto scrollbar-none py-1 px-0.5 -mx-4 px-4"
                     style={{ scrollSnapType: "x mandatory" }}>
                  {featuredProducts.map((p) => (
                    <Link
                      key={`feat-${p.id}`}
                      href={`/vendors/${slug}/products/${p.id}`}
                      className="shrink-0 w-[160px] sm:w-[180px] bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-all"
                      style={{ scrollSnapAlign: "center" }}
                    >
                      <div className="relative aspect-square bg-slate-100">
                        <SafeImage
                          src={p.images[0]}
                          alt={p.name}
                          fill
                          sizes="180px"
                          className="object-cover"
                          vendorSlug={vendor.slug}
                        />
                      </div>
                      <div className="p-2.5">
                        <p className="text-xs font-bold text-slate-900 line-clamp-2 min-h-[2.4em]">
                          {p.name}
                        </p>
                        <p className="mt-1 text-sm font-black text-primary tabular-nums" dir="ltr">
                          {(p.discountPrice ?? p.price).toFixed(2)} <span className="text-[10px]">ر.س</span>
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Search + Sort toolbar */}
            <div className="mb-3 flex items-center gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث في المنتجات..."
                  className="w-full h-10 px-10 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.34-4.34" />
                  <circle cx="11" cy="11" r="8" />
                </svg>
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortValue)}
                className="h-10 px-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-primary"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3 flex items-center gap-2 text-xs">
              <button
                onClick={() => setOnlyInStock(!onlyInStock)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bold transition-colors ${
                  onlyInStock
                    ? "bg-emerald-500 text-white"
                    : "bg-white border border-slate-200 text-slate-600 hover:border-emerald-300"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${onlyInStock ? "bg-white" : "bg-emerald-500"}`} />
                المتوفر فقط
              </button>
              <span className="text-slate-500 tabular-nums" dir="ltr">
                {filteredProducts.length} نتيجة
              </span>
            </div>

            {filteredProducts.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-2xl border border-slate-100">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 text-3xl">
                  🔍
                </div>
                <p className="text-slate-700 font-bold mb-1">
                  {searchQuery ? "لا توجد نتائج للبحث" : "لا توجد منتجات حالياً"}
                </p>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="text-sm text-primary hover:underline mt-2 inline-block"
                  >
                    مسح البحث
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.map((product) => {
                  const hasDiscount =
                    product.discountPrice !== undefined &&
                    product.discountPrice < product.price;
                  return (
                    <div
                      key={product.id}
                      className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100 hover:shadow-md transition-all group"
                    >
                      <Link href={`/vendors/${slug}/products/${product.id}`}>
                        <div className="relative aspect-square bg-slate-100 overflow-hidden">
                          <SafeImage
                            src={product.images[0]}
                            alt={product.name}
                            fill
                            sizes="(max-width: 640px) 50vw, 240px"
                            className="object-cover group-hover:scale-105 transition-transform duration-300"
                            vendorSlug={vendor.slug}
                          />
                          {hasDiscount && (
                            <span
                              className="absolute top-2 right-2 text-[10px] font-black px-2 py-0.5 rounded-full text-white shadow-sm"
                              style={{ background: vendor.primaryColor }}
                            >
                              خصم
                            </span>
                          )}
                          {!product.inStock && (
                            <div className="absolute inset-0 bg-black/55 flex items-center justify-center backdrop-blur-[1px]">
                              <span className="text-white text-xs font-bold bg-black/60 px-2.5 py-1 rounded-full">
                                نفذت الكمية
                              </span>
                            </div>
                          )}
                        </div>
                      </Link>
                      <div className="p-3">
                        <Link href={`/vendors/${slug}/products/${product.id}`}>
                          <h3 className="font-bold text-[13px] text-slate-900 line-clamp-2 mb-1.5 min-h-[2.6em] hover:text-primary transition-colors">
                            {product.name}
                          </h3>
                        </Link>
                        <div className="flex items-end justify-between gap-2">
                          <div>
                            {hasDiscount ? (
                              <div className="flex flex-col">
                                <span className="text-primary font-black text-sm tabular-nums" dir="ltr">
                                  {product.discountPrice!.toFixed(2)} <span className="text-[10px]">ر.س</span>
                                </span>
                                <span className="text-[10px] text-slate-400 line-through tabular-nums" dir="ltr">
                                  {product.price.toFixed(2)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-primary font-black text-sm tabular-nums" dir="ltr">
                                {product.price.toFixed(2)} <span className="text-[10px]">ر.س</span>
                              </span>
                            )}
                          </div>
                          {product.inStock && (
                            <button
                              onClick={() => addToCart(product)}
                              disabled={addingToCart === product.id}
                              aria-label={`أضف ${product.name} للسلة`}
                              className="w-9 h-9 rounded-full text-white flex items-center justify-center hover:opacity-90 transition-all active:scale-90 disabled:opacity-50 shadow-sm"
                              style={{ background: vendor.primaryColor }}
                            >
                              {addingToCart === product.id ? (
                                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3} aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                </svg>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {vendor.description && (
              <div className="bg-white rounded-2xl p-4 border border-slate-100">
                <h3 className="font-bold text-slate-900 mb-2">عن المتجر</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{vendor.description}</p>
              </div>
            )}
            {vendor.address && (
              <div className="bg-white rounded-2xl p-4 border border-slate-100">
                <h3 className="font-bold text-slate-900 mb-2 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
                  </svg>
                  العنوان
                </h3>
                <p className="text-sm text-slate-600">{vendor.address}</p>
              </div>
            )}
            <div className="bg-white rounded-2xl p-4 border border-slate-100">
              <h3 className="font-bold text-slate-900 mb-2 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                </svg>
                أوقات العمل
              </h3>
              <p className="text-sm text-slate-600">
                يومياً من <span dir="ltr" className="font-bold tabular-nums">{vendor.openTime}</span> إلى{" "}
                <span dir="ltr" className="font-bold tabular-nums">{vendor.closeTime}</span>
              </p>
            </div>
            <div className="bg-white rounded-2xl p-4 border border-slate-100">
              <h3 className="font-bold text-slate-900 mb-3">طرق الدفع</h3>
              <div className="flex flex-wrap gap-2">
                {vendor.settings.acceptsCod && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-100 rounded-full text-xs font-bold text-slate-700">
                    💵 الدفع عند الاستلام
                  </span>
                )}
                {vendor.settings.acceptsOnlinePayment && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-100 rounded-full text-xs font-bold text-slate-700">
                    💳 بطاقة / آبل باي
                  </span>
                )}
              </div>
            </div>
            {vendor.settings.minOrder > 0 && (
              <div className="bg-white rounded-2xl p-4 border border-slate-100">
                <h3 className="font-bold text-slate-900 mb-2">الحد الأدنى للطلب</h3>
                <p className="text-sm text-slate-600 tabular-nums" dir="ltr">
                  {vendor.settings.minOrder} ر.س
                </p>
              </div>
            )}
            {vendor.contact.phone && (
              <a
                href={`tel:${vendor.contact.phone}`}
                className="block bg-white rounded-2xl p-4 border border-slate-100 hover:border-primary transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    📞
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">اتصل بنا</p>
                    <p className="font-bold text-slate-900 tabular-nums" dir="ltr">
                      {vendor.contact.phone}
                    </p>
                  </div>
                </div>
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
