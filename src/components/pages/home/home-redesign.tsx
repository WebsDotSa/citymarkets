"use client";

import { useAuthState } from "@/contexts/auth-context";
import { HeroSection } from "./sections/hero-section";
import { BannersCarouselSection } from "./sections/banners-carousel-section";
import { StoresCarouselSection } from "./sections/stores-carousel-section";
import { QuickCategoriesSection } from "./sections/quick-categories-section";
import { FeaturedOffersSection } from "./sections/featured-offers-section";
import { FeaturedProductsSection } from "./sections/featured-products-section";
import { CouponsStripSection } from "./sections/coupons-strip-section";
import { WelcomeBackSection } from "./sections/welcome-back-section";
import { JoinCta } from "./sections/join-cta";

/**
 * HomeRedesign — Modern Minimal home page (Apple-like).
 *
 * 5-6 sections depending on auth state:
 *   - Hero with inline search + location
 *   - Quick categories pills
 *   - Featured offers (Slice 5)
 *   - Featured products carousel
 *   - Coupons strip
 *   - Personalization: WelcomeBack for logged-in, JoinCta for guests
 */
export function HomeRedesign() {
  const { user, loading } = useAuthState();
  const isLoggedIn = !!user;

  return (
    <main className="min-h-screen bg-slate-50">
      <HeroSection />
      <BannersCarouselSection />
      <StoresCarouselSection />
      <QuickCategoriesSection />
      <FeaturedOffersSection />
      <FeaturedProductsSection />
      <CouponsStripSection />
      {!loading && isLoggedIn && <WelcomeBackSection />}
      {!loading && !isLoggedIn && <JoinCta />}
    </main>
  );
}