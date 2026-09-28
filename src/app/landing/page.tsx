import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/site";

// /landing is referenced in sitemap-sources.ts but the actual route is
// /landing-page. Rather than issuing a Server Component redirect (which
// proxy.ts can swallow and turn into 200), emit a canonical link to the
// real URL and noindex the duplicate so search engines consolidate the
// ranking signal at /landing-page.
export const metadata: Metadata = buildPageMetadata({
  title: "الصفحة الرئيسية",
  path: "/landing-page",
  noIndex: true,
});

export default function LandingAliasPage() {
  // Empty body — the canonical link above tells crawlers the real URL.
  // Users following old marketing links will continue from /landing-page.
  return null;
}
