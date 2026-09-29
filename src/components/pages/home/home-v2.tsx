"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Product, CategoryRow } from "@/lib/types";
import { buildDynamicGroups } from '@/lib/catalog';
import { useCart } from "@/contexts/cart-context";
import { useAuthState } from "@/contexts/auth-context";
import { useDeliveryLocationActions } from "@/contexts/delivery-location-context";
import { ProductCard } from "@/components/storefront/product-card";
import { OfferCard, type OfferCardData } from "@/components/storefront/offer-card";
import { CategoryCard } from "@/components/design/category-card";
import { HeroBanner, StaticHero, PromoStrip } from "@/components/design/hero-banner";
import { StoresShowcase } from "@/components/pages/home/stores-showcase";
import { PartnerCta } from "@/components/pages/home/sections/partner-cta";
import { Button } from "@/components/design/button";
import { ProductCardSkeleton, CategoryCardSkeleton } from "@/components/design/skeleton";
import { EmptyCart } from "@/components/design/empty-state";
import {
  ShoppingCart,
  Heart,
  Flame,
  Sparkles,
  ChevronLeft,
  Star,
  Truck,
  Shield,
  Clock,
  Percent,
  Gift,
  ArrowLeft,
  Plus,
  Minus,
  MapPin,
  Search,
} from "lucide-react";

interface Banner {
  id: string;
  image_url: string;
  link_type: string;
  link_value: string | null;
}

// Quick Action Pills
const QUICK_ACTIONS = [
  { label: "عروض اليوم", icon: Flame, href: "/offers", color: "from-orange-500 to-red-500" },
  { label: "الأكثر مبيعاً", icon: Star, href: "/catalog?sort=best_selling", color: "from-yellow-500 to-orange-500" },
  { label: "جديدنا", icon: Sparkles, href: "/catalog?new=true", color: "from-primary-500 to-teal-500" },
  { label: "نقاط الولاء", icon: Gift, href: "/loyalty", color: "from-purple-500 to-pink-500" },
];

// Section Header Component
interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  link?: string;
  linkText?: string;
}

function SectionHeader({ title, subtitle, link, linkText }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-gray-900">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {link && (
        <Link
          href={link}
          className="flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-dark transition-colors"
        >
          {linkText || "عرض الكل"}
          <ChevronLeft className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}

// Category Card Component
function CategoryCardItem({ category, emoji }: { category: CategoryRow; emoji: string }) {
  return (
    <CategoryCard
      id={category.id}
      name_ar={category.name_ar}
      slug={category.slug}
      icon_url={category.icon_url}
      emoji={emoji}
    />
  );
}

// Main Home Content
export function HomeContentV2() {
  const { user } = useAuthState();
  const { openSheet } = useDeliveryLocationActions();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [deals, setDeals] = useState<Product[]>([]);
  const [featuredOffers, setFeaturedOffers] = useState<OfferCardData[]>([]);
  const [featured, setFeatured] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const featuredRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Abort in-flight requests on unmount so navigating away mid-fetch
    // doesn't set state on an unmounted component.
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    Promise.all([
      fetch("/api/v1/categories", opts).then((r) => r.json()),
      fetch("/api/v1/banners", opts).then((r) => r.json()),
      // Slice 5: prefer the new /api/v1/offers endpoint for the home
      // hero carousel. Falls back to /products?on_offer=true if the
      // offers endpoint is empty (e.g. during initial rollout before
      // the admin seeds any offers).
      fetch("/api/v1/offers?featured=true&limit=6", opts).then((r) => r.json()),
      fetch("/api/v1/products?on_offer=true&limit=12", opts).then((r) => r.json()),
      fetch("/api/v1/products?featured=true&limit=8", opts).then((r) => r.json()),
    ])
      .then(([catRes, bannerRes, offersRes, dealsRes, featRes]) => {
        if (catRes.success) setCategories(catRes.data || []);
        if (bannerRes.success) setBanners(bannerRes.data || []);
        if (offersRes.success) {
          setFeaturedOffers(offersRes.data || []);
        }
        if (dealsRes.success) {
          const d = dealsRes.data;
          setDeals(Array.isArray(d) ? d : d?.data || []);
        }
        if (featRes.success) {
          const f = featRes.data;
          setFeatured(Array.isArray(f) ? f : f?.data || []);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.slug, c])),
    [categories]
  );

  const scrollFeatured = (direction: "left" | "right") => {
    if (featuredRef.current) {
      const scrollAmount = 300;
      featuredRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Stores showcase — featured vendors (قهوة / هدايا / عبايات / ...).
          Sits above the hero carousel per the home-page brief. The
          component fetches /api/v1/vendors directly and returns null
          when there are no featured stores, so the section vanishes on
          fresh installs without it. */}
      <StoresShowcase />

      {/* Become a partner — public path to /vendors/register so aspiring
          merchants can apply without admin hand-holding. Placed right
          under the existing stores showcase so visitors see live
          stores FIRST (social proof) then a CTA to join. */}
      <PartnerCta />

      {/* Hero Section with Banners */}
      {banners.length > 0 && (
        <section className="px-4 pt-4">
          <HeroBanner banners={banners} />
        </section>
      )}

      {/* Quick Actions */}
      <section className="px-4 mt-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.label}
                href={action.href}
                className={`flex items-center gap-3 p-4 rounded-2xl bg-gradient-to-l ${action.color} text-white shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5`}
              >
                <Icon className="w-6 h-6" />
                <span className="font-semibold text-sm">{action.label}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Promo Strip */}
      <section className="px-4 mt-4">
        <PromoStrip />
      </section>

      {/* Location Banner */}
      <section className="px-4 mt-4">
        <button
          type="button"
          onClick={openSheet}
          className="w-full flex items-center gap-3 p-4 rounded-2xl bg-white border border-gray-100 hover:border-primary-200 hover:shadow-md transition-all"
        >
          <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
            <MapPin className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 text-right">
            <p className="font-semibold text-gray-900">حدد موقع التوصيل</p>
            <p className="text-sm text-gray-500">لمعرفة المنتجات المتاحة في منطقتك</p>
          </div>
          <ChevronLeft className="w-5 h-5 text-gray-400" />
        </button>
      </section>

      {/* Featured Products — always rendered (even when loading) so the
          section reserves its vertical space in SSR and avoids a CLS
          shift when products finish loading. The skeleton state below
          fills the same height as the real product cards. (2026-08-17
          PageSpeed Performance fix — was contributing CLS=0.531.) */}
      <section className="mt-6">
          <div className="px-4">
            <SectionHeader
              title="منتجات مميزة"
              subtitle="اختيارنا المميز لك"
              link="/catalog?featured=true"
            />
          </div>
          <div className="relative">
            <div
              ref={featuredRef}
              className="flex gap-4 overflow-x-auto px-4 pb-4 scrollbar-hide min-h-[320px]"
              style={{ scrollSnapType: "x mandatory" }}
            >
              {loading
                ? [...Array(4)].map((_, i) => <ProductCardSkeleton key={i} className="w-64 flex-shrink-0" />)
                : featured.map((product) => (
                    <div key={product.id} className="w-64 flex-shrink-0" style={{ scrollSnapAlign: "start" }}>
                      <ProductCard product={product} />
                    </div>
                  ))}
            </div>
            {featured.length > 4 && (
              <>
                <button
                  onClick={() => scrollFeatured("left")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white shadow-lg rounded-full flex items-center justify-center hover:bg-gray-50 z-10 hidden sm:flex"
                >
                  <ChevronLeft className="w-5 h-5 text-gray-700 rotate-180" />
                </button>
                <button
                  onClick={() => scrollFeatured("right")}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white shadow-lg rounded-full flex items-center justify-center hover:bg-gray-50 z-10 hidden sm:flex"
                >
                  <ChevronLeft className="w-5 h-5 text-gray-700" />
                </button>
              </>
            )}
          </div>
        </section>

      {/* Category Groups (built from API root categories) */}
      {buildDynamicGroups(categories).map((group) => {
        if (group.children.length === 0) return null;
        return (
          <section key={group.id} className="mt-6">
            <div className="px-4">
              <SectionHeader
                title={group.title}
                link={`/categories/${encodeURIComponent(group.rootCategory.slug)}`}
              />
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3 px-4">
              {group.children.slice(0, 8).map((cat) => (
                <CategoryCardItem key={cat.id} category={cat} emoji={group.emoji} />
              ))}
            </div>
          </section>
        );
      })}

      {/* Slice 5 — Featured Offers carousel.
          Renders the new OfferCard component. Falls back to the
          legacy discount_price-only ProductCard list when the offers
          endpoint returns nothing (so the home page never collapses to
          an empty state). */}
      {(featuredOffers.length > 0 || deals.length > 0) && (
        <section className="mt-6">
          <div className="px-4">
            <SectionHeader
              title="عروض حصرية"
              subtitle="خصومات لا تفوتك"
              link="/offers"
            />
          </div>
          {featuredOffers.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-4">
              {featuredOffers.map((o) => (
                <OfferCard key={o.id} offer={o} variant="hero" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 px-4 min-h-[280px]">
              {loading
                ? [...Array(5)].map((_, i) => <ProductCardSkeleton key={i} />)
                : deals.slice(0, 10).map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
            </div>
          )}
        </section>
      )}

      {/* CTA Section */}
      <section className="mt-8 px-4 pb-24">
        <StaticHero
          title={user ? "اطلب الآن!" : "هل لديك حساب؟"}
          subtitle={user 
            ? "اطلب الآن واستمتع بتوصيل سريع!" 
            : "سجل الآن واحصل على خصم 10% على طلبك الأول"}
          ctaLabel={user ? "تصفح المنتجات" : "سجل الآن"}
          ctaHref={user ? "/catalog" : "/auth/login"}
        />
      </section>
    </div>
  );
}
