// Raw /robots.txt route.
//
// Next.js ships a built-in /robots.txt generator via app/robots.ts that
// uses the MetadataRoute.Robots type — but that type DOES NOT expose
// any field for the Content-Signals directives (IETF
// draft-romm-aipref-contentsignals), which Cloudflare
// isitagentready.com specifically validates inside the robots.txt body.
//
// To satisfy both:
//   - /robots.txt (this route) — serves raw text with Content-Signal
//     directives so scanners reading the body detect them. Wins because
//     Next.js routes take precedence over the MetadataRoute generator
//     when a route.ts exists for the same path.
//   - app/robots.ts — keeps the structured rules for crawlers that read
//     the standard allow/disallow format. The Content-Signal is also
//     sent as an HTTP header by next.config.mjs (Pitfall-122 / 2026-08-17).

import { NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-static";
export const revalidate = 86400;

const SITE_URL = getSiteUrl();

const robotsTxt = `# City Markets robots.txt
# https://citymarkets.sa/robots.txt
#
# Content-Signals (IETF draft-romm-aipref-contentsignals):
# Declared at the top so Cloudflare isitagentready.com and other
# scanners that parse the BODY can detect AI usage preferences
# without depending on the Content-Signal response header.

Content-Signal: ai-train=no, search=yes, ai-input=yes

User-Agent: *
Allow: /
Allow: /catalog
Allow: /categories
Allow: /products/
Allow: /terms
Allow: /privacy
Allow: /help
Allow: /contact
Allow: /about
Disallow: /admin/
Disallow: /api/
Disallow: /checkout
Disallow: /cart
Disallow: /profile
Disallow: /orders
Disallow: /ai-chat
Disallow: /spin-wheel
Disallow: /profile/
Disallow: /wishlist
Disallow: /auth/

# AI / agent crawlers are explicitly welcomed to the public catalog,
# products, and agent discovery endpoints (so they can read auth.md,
# .well-known/, sitemap.xml, and the public read API).
User-Agent: GPTBot
Allow: /
Allow: /.well-known/
Allow: /api/v1/catalog
Allow: /api/v1/products
Allow: /api/v1/categories
Allow: /auth.md
Allow: /llms.txt
Disallow: /admin/

User-Agent: ClaudeBot
Allow: /
Allow: /.well-known/
Allow: /api/v1/catalog
Allow: /api/v1/products
Allow: /api/v1/categories
Allow: /auth.md
Allow: /llms.txt
Disallow: /admin/

User-Agent: PerplexityBot
Allow: /
Allow: /.well-known/
Allow: /api/v1/catalog
Allow: /api/v1/products
Allow: /api/v1/categories
Allow: /auth.md
Allow: /llms.txt
Disallow: /admin/

User-Agent: Google-Extended
Allow: /
Allow: /.well-known/
Allow: /api/v1/catalog
Allow: /api/v1/products
Allow: /api/v1/categories
Allow: /auth.md
Allow: /llms.txt
Disallow: /admin/

Sitemap: ${SITE_URL}/sitemap.xml
Sitemap: ${SITE_URL}/sitemap-images.xml
`;

export async function GET() {
  return new NextResponse(robotsTxt, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
      "Content-Signal": "ai-train=no, search=yes, ai-input=yes",
    },
  });
}
