// Markdown for Agents — home of the /md tree.
//
// Catch-all `[...path]` route in /md/[...path]/route.ts handles
// /md/<anything>. The /md URL itself has no path segment so Next.js
// would 404 unless we also expose a bare route. This file imports the
// shared markdown body from the catch-all route and serves it at /md.

import { NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-static";
export const revalidate = 86400;

const SITE_URL = getSiteUrl();

const markdownBody = `# City Markets (citymarkets.sa)

> Saudi Arabian multi-vendor supermarket delivery platform. Browse 4,000+ products from local stores and have them delivered within 45 minutes in Riyadh.

## About

City Markets (أسواق سيتي) is an online grocery and supermarket marketplace serving Saudi Arabia. Customers can browse fresh produce, dairy, pantry staples, household essentials, and personal care items from multiple local stores in a single checkout. Orders are fulfilled by local vendors and delivered to the customer's door.

- **Headquarters:** Riyadh, Saudi Arabia
- **Coverage:** Riyadh + all Saudi cities
- **Delivery time:** 30–60 minutes in Riyadh, 1–3 days elsewhere
- **Payment methods:** Cash on delivery, Mada, Visa, Mastercard, Apple Pay, Tamara

## Navigation

- [Homepage](https://citymarkets.sa/)
- [Categories](https://citymarkets.sa/categories)
- [Catalog](https://citymarkets.sa/catalog)
- [Special Offers](https://citymarkets.sa/offers)
- [Vendors](https://citymarkets.sa/vendors)
- [Help](https://citymarkets.sa/help)
- [Terms](https://citymarkets.sa/terms)
- [Privacy](https://citymarkets.sa/privacy)

## Agent & API Discovery

This site is **agent-ready**. The following endpoints are designed for autonomous AI agents to discover and integrate with our commerce platform:

- [Agent Card (A2A)](https://citymarkets.sa/.well-known/agent-card.json) — A2A protocol manifest
- [MCP Server Card](https://citymarkets.sa/.well-known/mcp/server-card.json) — Model Context Protocol server
- [ACP Discovery](https://citymarkets.sa/.well-known/acp.json) — Agentic Commerce Protocol
- [ACP Canonical](https://citymarkets.sa/.well-known/acp/config.json) — ACP config.json
- [UCP Manifest](https://citymarkets.sa/.well-known/ucp/manifest.json) — Universal Commerce Protocol
- [AP2 Mandates](https://citymarkets.sa/.well-known/ap2/mandates.json) — Agent Payments Protocol
- [x402 Discovery](https://citymarkets.sa/.well-known/x402) — x402 payment protocol
- [Auth.md](https://citymarkets.sa/auth.md) — Authentication guide
- [API Catalog](https://citymarkets.sa/.well-known/api-catalog) — API endpoint catalog
- [OpenID Discovery](https://citymarkets.sa/.well-known/openid-configuration) — OAuth/OIDC config
- [OAuth Protected Resource](https://citymarkets.sa/.well-known/oauth-protected-resource) — RFC 9728
- [Agent Skills Index](https://citymarkets.sa/.well-known/agent-skills/index.json) — Skill catalog
- [OpenAPI Spec](https://citymarkets.sa/openapi.json) — Full OpenAPI 3.1 document
- [llms.txt](https://citymarkets.sa/llms.txt) — LLM-friendly site manifest
- [Sitemap](https://citymarkets.sa/sitemap.xml) — XML sitemap

## Public REST API (v1)

All public read endpoints accept \`Accept: application/json\` (default) and \`Accept: text/markdown\` (returns this Markdown view).

| Method | Path | Description |
|--------|------|-------------|
| GET    | \`/api/v1/categories\` | Browse product categories tree |
| GET    | \`/api/v1/products\` | List/search products (query params: \`q\`, \`category\`, \`featured\`, \`on_offer\`, \`limit\`) |
| GET    | \`/api/v1/products/{id}\` | Get product details |
| GET    | \`/api/v1/vendors\` | List partner stores/vendors |
| GET    | \`/api/v1/offers\` | Active special offers (query: \`featured\`, \`limit\`) |
| GET    | \`/api/v1/banners\` | Homepage hero banners |

## Authentication

The customer API uses Twilio Verify for phone-based OTP authentication:

1. \`POST /api/v1/auth/twilio/send\` — body \`{"phone":"5XXXXXXXX"}\`
2. \`POST /api/v1/auth/twilio/verify\` — body \`{"phone":"5XXXXXXXX","code":"123456"}\`
3. Server returns \`customer_session\` HTTP-only cookie.

See [auth.md](https://citymarkets.sa/auth.md) for the full flow including the \`agent_auth\` block (WorkOS Auth.md integration) and the ID-JAG assertion exchange.

## Markdown for Agents

This page is served at \`/md\` and \`/md/<path>\` with \`Content-Type: text/markdown\`. Cloudflare's *Markdown for Agents* feature is enabled on this zone — bots that send \`Accept: text/markdown\` may receive a Markdown rendering of any page. See [Cloudflare docs](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/).

## Contact

- **Customer support:** +966-53-044-4976 (WhatsApp preferred)
- **Email:** info@citymarkets.sa
- **Owner/operator:** City Markets Co., Riyadh
`;

function countMarkdownTokens(body: string): number {
  return Math.ceil(body.length / 4);
}

export async function GET() {
  return new NextResponse(markdownBody, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "x-markdown-tokens": String(countMarkdownTokens(markdownBody)),
      Vary: "Accept",
      Link: [
        `<${SITE_URL}/.well-known/api-catalog>; rel="api-catalog"`,
        `<${SITE_URL}/auth.md>; rel="service-doc"; type="text/markdown"`,
        `<${SITE_URL}/llms.txt>; rel="alternate"; type="text/markdown"`,
      ].join(", "),
    },
  });
}
