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
const BannersCarouselSection = dynamic(
  () => import("./sections/banners-carousel-section").then((m) => m.BannersCarouselSection),
  { ssr: false },
);
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
 *   - Banners carousel (lazy)
 *   - Stores carousel (lazy)
 *   - Featured offers (lazy, Slice 5)
 *   - Featured products carousel (lazy)
 *   - Coupons strip (lazy)
 *   - Personalization: WelcomeBack (logged-in) / JoinCta (guest) — lazy
 */
export function HomeRedesign() {
  const { user, loading } = useAuthState();
  const isLoggedIn = !!user;

  return (
    <main className="min-h-screen bg-slate-50">
      <HeroSection />
      <QuickCategoriesSection />
      <BannersCarouselSection />
      <StoresCarouselSection />
      <FeaturedOffersSection />
      <FeaturedProductsSection />
      <CouponsStripSection />
      {!loading && isLoggedIn && <WelcomeBackSection />}
      {!loading && !isLoggedIn && <JoinCta />}
    </main>
  );
}