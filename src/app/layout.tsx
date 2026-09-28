import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, Tajawal } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "@/contexts/providers";
import { StoreChrome } from "@/components/layout/store-chrome";
import { AppInstallBanner } from "@/components/layout/app-install-banner";
import { StoreClosedBanner } from "@/components/layout/store-closed-banner";
import { PWAProvider } from "@/components/pwa-provider";
import { PageviewTracker } from "@/components/analytics/pageview-tracker";
import { GoogleAnalytics } from "@/components/analytics/google-analytics";
import { MetaPixel } from "@/components/analytics/meta-pixel";
import { MetaPixelConsent } from "@/components/analytics/meta-pixel-consent";
import { Suspense } from "react";
import { StoreFooter } from "@/components/layout/store-footer";
import { SiteJsonLd } from "@/components/seo/json-ld";
import { rootSiteMetadata } from "@/lib/seo/site";
import { WebMCPProvider } from "@/components/webmcp-provider";

// Body font — IBM Plex Sans Arabic.
// display: "optional" tells the browser to use the fallback immediately
// and skip the swap if the webfont hasn't loaded within ~100ms. This
// dramatically reduces Cumulative Layout Shift (CLS) caused by late
// font swap. The fallback (`system-ui` via the CSS variable) is a
// system Arabic font that's already visually similar. (2026-08-17
// PageSpeed Performance fix — CLS 0.67 → ~0.05 expected.)
const ibmPlex = IBM_Plex_Sans_Arabic({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["arabic"],
  variable: "--font-ibm-plex",
  display: "optional",
  preload: true,
  fallback: ["system-ui", "Tahoma", "Arial", "sans-serif"],
});

// Display font for headings — distinct from the body font (IBM Plex Sans
// Arabic) so headings carry visual weight. Tajawal is a popular Google
// Arabic display face with a stronger character than the body text.
// Not preloaded (only headings use it; CLS impact is minor compared to
// body font). display: optional same reasoning.
const tajawal = Tajawal({
  weight: ["500", "700", "800", "900"],
  subsets: ["arabic"],
  variable: "--font-tajawal",
  display: "optional",
  preload: false,
  fallback: ["system-ui", "Tahoma", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  ...rootSiteMetadata,
  manifest: "/manifest.json",
  // themeColor moved to viewport export below (Next 16 deprecation).
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "أسواق سيتي",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
    other: [
      {
        rel: "icon",
        type: "image/png",
        sizes: "192x192",
        url: "/android-chrome-192x192.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "512x512",
        url: "/android-chrome-512x512.png",
      },
    ],
  },
};

export const viewport = {
  themeColor: "#009345",
};

// SECURITY (CSP-H): we read the per-request nonce from `headers()` so
// the inline <Script> tags (Google Analytics, etc.) can satisfy the strict
// CSP issued by `proxy.ts`. If the layout were static-rendered, every
// request would ship the same nonce and the CSP guarantee would be
// meaningless. Force-dynamic keeps the render bound to the request.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // SECURITY (CSP-H): proxy.ts writes a per-request nonce to the
  // forwarded request headers. Reading it here lets us stamp every
  // inline <Script> the layout renders so the strict CSP (which
  // dropped `'unsafe-inline'` from script-src) accepts the bootstrap.
  // The nonce is a fresh random value per request, so we MUST render
  // at request time, not at build time — hence `dynamic = "force-
  // dynamic"` below.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="ar" dir="rtl" className={`${ibmPlex.variable} ${tajawal.variable}`}>
      <body className="antialiased">
        {/* Google Analytics 4 — citymarkets.sa */}
        <GoogleAnalytics measurementId="G-C44L4JEF4D" nonce={nonce} />
        {/* Meta Pixel — citymarkets.sa */}
        <MetaPixel pixelId="28736120122671302" nonce={nonce} />
        <MetaPixelConsent />
        <SiteJsonLd />
        {/* WebMCP Provider - exposes site tools to AI agents */}
        <WebMCPProvider />
        <Providers>
          <div className="min-h-screen flex flex-col bg-gray-50">
            <StoreClosedBanner />
            <AppInstallBanner />
            <StoreChrome />
            <main className="flex-1 flex min-h-0 flex-col pb-20 ai-chat-main">{children}</main>
            <StoreFooter />
          </div>
          <PWAProvider />
          <Suspense fallback={null}>
            <PageviewTracker />
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}