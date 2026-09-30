// Agentic Commerce Protocol (ACP) canonical discovery endpoint.
// Spec: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
// Path: /.well-known/acp/config.json (canonical per adamsilvaconsulting.com/spec table)
//
// Note: we ALSO serve /.well-known/acp.json for backwards compatibility
// with scanners that hard-code the old path. Both return the same body.

import { getSiteUrl } from "@/lib/seo/site";
import { NextResponse } from "next/server";

export const dynamic = "force-static";
export const revalidate = 86400;

const SITE_URL = getSiteUrl();

const acpConfig = {
  // ACP envelope — per rfc.discovery.md the protocol block is an
  // OBJECT with name, version, supported_versions. Cloudflare scanner
  // validates this exact shape.
  protocol: {
    name: "acp",
    version: "2026-04-17",
    supported_versions: ["2026-04-17", "2025-09-29"],
  },

  // Seller info
  organization: {
    name: "City Markets Co.",
    url: SITE_URL,
    contact_email: "acp@citymarkets.sa",
    locale: "ar-SA",
    country: "SA",
    currency: "SAR",
  },

  // API base + transports. rfc.discovery.md example uses ["rest"].
  api_base_url: `${SITE_URL}/api/v1`,
  transports: ["rest", "https", "mcp"],

  // Capabilities.services — per spec, ARRAY OF STRINGS naming each
  // service. Rich descriptors moved under `service_details` for agents
  // that want endpoint URLs.
  capabilities: {
    services: [
      "checkout",
      "catalog",
      "cart",
      "orders",
      "payments",
      "delivery",
    ],
    service_details: [
      {
        id: "catalog",
        name: "Catalog Browse",
        enabled: true,
        endpoints: ["/categories", "/products", "/vendors"],
      },
      {
        id: "cart",
        name: "Cart Management",
        enabled: true,
        endpoints: ["/cart"],
      },
      {
        id: "orders",
        name: "Order Management",
        enabled: true,
        endpoints: ["/orders"],
      },
      {
        id: "payments",
        name: "Payment Processing",
        enabled: true,
        endpoints: ["/payments"],
      },
      {
        id: "delivery",
        name: "Delivery Management",
        enabled: true,
        endpoints: ["/delivery", "/delivery-addresses"],
      },
    ],
  },

  // Checkout endpoints (ACP spec 2026-04-17)
  checkout: {
    create: `${SITE_URL}/api/v1/checkout`,
    update: `${SITE_URL}/api/v1/checkout`,
    complete: `${SITE_URL}/api/v1/checkout/complete`,
    get: `${SITE_URL}/api/v1/checkout`,
  },

  // Payment integration (Moyasar + Apple Pay / Google Pay / COD)
  payments: {
    provider: "moyasar",
    methods: ["card", "apple_pay", "google_pay", "cod"],
    currency: "SAR",
    shared_payment_token_compatible: true,
  },

  // Discovery endpoints
  discovery: {
    api_catalog: `${SITE_URL}/.well-known/api-catalog`,
    openapi: `${SITE_URL}/openapi.json`,
    oauth_config: `${SITE_URL}/.well-known/openid-configuration`,
    protected_resource: `${SITE_URL}/.well-known/oauth-protected-resource`,
    ucp: `${SITE_URL}/.well-known/ucp/manifest.json`,
    mcp_server: `${SITE_URL}/.well-known/mcp/server-card.json`,
    agent_skills: `${SITE_URL}/.well-known/agent-skills/index.json`,
    agent_card: `${SITE_URL}/.well-known/agent-card.json`,
    auth_guide: `${SITE_URL}/auth.md`,
    llms_txt: `${SITE_URL}/llms.txt`,
  },
};

export async function GET() {
  return NextResponse.json(acpConfig, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      Link: [
        `<${SITE_URL}/.well-known/api-catalog>; rel="api-catalog"`,
        `<${SITE_URL}/openapi.json>; rel="service-desc"`,
        `<${SITE_URL}/auth.md>; rel="service-doc"; type="text/markdown"`,
      ].join(", "),
    },
  });
}
