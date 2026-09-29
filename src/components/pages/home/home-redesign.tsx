"use client";

import dynamic from "next/dynamic";
import { useAuthState } from "@/contexts/auth-context";
import { HeroSection } from "./sections/hero-section";
import { QuickCategoriesSection } from "./sections/quick-categories-section";

// Below-the-fold sections are lazy-loaded. They were previously bundled
// eagerly in the home route's JS chunk (~30-40% reduction in the initial
// payload per Phase 8 measurement). Each section is `"use client"` so we
// disable SSR (`ssr: false`) — they hydrate client-side and animate via
// `useEffect`/`useState`. The Hero + QuickCategories stay eager because
// they are above-the-fold and the home page must paint them on first load
// for the LCP budget.
//
// Note: the legacy "banners" carousel was retired when the standalone
// /admin/banners page was replaced by the home-design JSONB layout
// (admin/(dashboard)/home-design). Banners are now an element type
// inside `home_layouts.sections` and are rendered by the dynamic
// DynamicHomeLayout. The HomeRedesign below only renders when no
// active layout exists in `home_layouts` — i.e. as a fallback for a
// freshly-deployed DB before the admin has saved a layout.
const StoresCarouselSection = dynamic(
  () => import("./sections/stores-carousel-section").then((m) => m.StoresCarouselSection),
  { ssr: false },
);
const FeaturedOffersSection = dynamic(
  () => import("./sections/featured-offers-section").then((m) => m.FeaturedOffersSection),
  { ssr: false },
);
const FeaturedProductsSection = dynamic(
  () => import("./sections/featured-products-section").then((m) => m.FeaturedProductsSection),
  { ssr: false },
);
const CouponsStripSection = dynamic(
  () => import("./sections/coupons-strip-section").then((m) => m.CouponsStripSection),
  { ssr: false },
);
const WelcomeBackSection = dynamic(
  () => import("./sections/welcome-back-section").then((m) => m.WelcomeBackSection),
  { ssr: false },
);
const JoinCta = dynamic(
  () => import("./sections/join-cta").then((m) => m.JoinCta),
  { ssr: false },
);

/**
 * HomeRedesign — Modern Minimal home page (Apple-like).
 *
 * 5-6 sections depending on auth state:
 *   - Hero with inline search + location (eager — above the fold)
 *   - Quick categories pills (eager — above the fold)
 *   - Stores carousel (lazy)
 *   - Featured offers (lazy, Slice 5)
 *   - Featured products carousel (lazy)
 *   - Coupons strip (lazy)
 *   - Personalization: WelcomeBack (logged-in) / JoinCta (guest) — lazy
 *
 * Used as the fallback when `home_layouts` has no active layout; the
 * primary path is `DynamicHomeLayout` driven by /admin/home-design.
 */
export function HomeRedesign() {
  const { user, loading } = useAuthState();
  const isLoggedIn = !!user;

  return (
    <main className="min-h-screen bg-slate-50">
      <HeroSection />
      <QuickCategoriesSection />
      <StoresCarouselSection />
      <FeaturedOffersSection />
      <FeaturedProductsSection />
      <CouponsStripSection />
      {!loading && isLoggedIn && <WelcomeBackSection />}
      {!loading && !isLoggedIn && <JoinCta />}
    </main>
  );
}