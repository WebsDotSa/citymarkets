import type { Metadata } from "next";
import { HomeRedesign } from "@/components/pages/home/home-redesign";
import { DynamicHomeLayout } from "@/components/storefront/home/dynamic-home-layout";
import { buildPageMetadata } from "@/lib/seo/site";
import { HomePageJsonLd } from "@/components/seo/home-json-ld";
import { FaqJsonLd, BreadcrumbJsonLd } from "@/components/seo/faq-json-ld";
import { pool } from "@/lib/db";
import {
  HOME_LAYOUT_VERSION,
  type PublicHomeLayout,
  type Section,
} from '@/lib/catalog/home-layout-types';
import { getCachedHomeLayout } from '@/lib/catalog/home-layout-cache';

export const metadata: Metadata = buildPageMetadata({
  title: "أسواق سيتي | منصة التسوق الذكية المتعددة المتاجر في السعودية",
  description:
    "اكتشف أحدث العروض وأكبر تشكيلة من المنتجات الطازجة والمواد الغذائية عبر أسواق سيتي — منصة تسوّق أونلاين تجمع لك آلاف المتاجر المحلية مع توصيل سريع إلى باب بيتك في جميع مدن المملكة.",
  path: "/",
});

// Force dynamic so each request can pick the right device layout.
// Next.js will still cache downstream fetches; this just opts out of ISR.
export const dynamic = "force-dynamic";

/**
 * Server-side seed of the home layout for the mobile device.
 *
 * - If the admin has saved a non-empty mobile layout, we pass it down so
 *   the first paint already shows the dynamic sections (no flash).
 * - If the layout is empty or missing, we pass `null` and the client
 *   component falls back to <HomeRedesign /> — same UX as today.
 *
 * The desktop layout is fetched client-side after hydration (we can't
 * know the viewport server-side without UA sniffing).
 */
async function loadInitialMobileLayout(): Promise<PublicHomeLayout | null> {
  // In-process cache via @/lib/home-layout-cache — admin PUT calls
  // invalidateHomeLayout() so edits propagate within ~0ms; the 60s TTL
  // is a safety net for missed invalidations. The home page itself
  // stays `force-dynamic` for the per-request CSP nonce (see layout.tsx),
  // but the DB read for the layout no longer fires on every reload.
  return getCachedHomeLayout("mobile", HOME_LAYOUT_VERSION, async () => {
    try {
      const result = await pool.query<{
        sections: Section[];
        updated_at: string;
      }>(
        `SELECT sections, updated_at FROM home_layouts
         WHERE device_type = 'mobile' AND is_active = TRUE
         LIMIT 1`,
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      const sections = Array.isArray(row.sections) ? row.sections : [];
      if (sections.length === 0) return null;
      return {
        device_type: "mobile",
        sections,
        version: HOME_LAYOUT_VERSION,
        updated_at: new Date(row.updated_at).toISOString(),
      };
    } catch {
      // Don't break the home page if the layout table is unavailable.
      return null;
    }
  });
}

export default async function HomePage() {
  const initialLayout = await loadInitialMobileLayout();
  return (
    <>
      <HomePageJsonLd />
      <FaqJsonLd pageUrl="/" />
      <BreadcrumbJsonLd items={[{ name: "الرئيسية", url: "/" }]} />
      <DynamicHomeLayout initialLayout={initialLayout} fallback={<HomeRedesign />} />
    </>
  );
}