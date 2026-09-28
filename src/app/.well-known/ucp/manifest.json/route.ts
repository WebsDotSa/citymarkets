// Universal Commerce Protocol (UCP) canonical discovery endpoint.
// Spec: https://ucp.dev
// Path: /.well-known/ucp/manifest.json (canonical per adamsilvaconsulting.com)
//
// Note: we ALSO serve /.well-known/ucp for backwards compatibility.

import { NextResponse } from "next/server";

export const dynamic = "force-static";
export const revalidate = 86400;

const SITE_URL = "https://citymarkets.sa";

const ucpManifest = {
  // UCP root envelope
  ucp_version: "2026-01",
  protocol: "ucp",
  version: "1.0.0",
  spec: "https://ucp.dev/specification/overview/",

  // Organization
  organization: {
    name: "City Markets Co.",
    url: SITE_URL,
    locale: "ar-SA",
    country: "SA",
    currency: "SAR",
  },

  // Service info
  service: {
    name: "City Markets",
    description: {
      en: "Saudi Arabian multi-vendor supermarket delivery platform",
      ar: "منصة توصيل سوبرماركت متعددة الموردين سعودية",
    },
    provider: "City Markets Co.",
    website: SITE_URL,
  },

  // Capabilities as ARRAY (Cloudflare scanner-validated shape)
  capabilities: [
    {
      type: "service",
      id: "catalog",
      name: "Catalog Browse",
      enabled: true,
      endpoints: ["/categories", "/products", "/vendors"],
    },
    {
      type: "service",
      id: "cart",
      name: "Cart Management",
      enabled: true,
      endpoints: ["/cart"],
    },
    {
      type: "service",
      id: "orders",
      name: "Order Management",
      enabled: true,
      endpoints: ["/orders"],
    },
    {
      type: "service",
      id: "payments",
      name: "Payment Processing",
      enabled: true,
      endpoints: ["/payments"],
    },
    {
      type: "service",
      id: "delivery",
      name: "Delivery",
      enabled: true,
      endpoints: ["/delivery"],
    },
    {
      type: "feature",
      id: "agent_commerce",
      name: "Agent Commerce",
      enabled: true,
    },
    {
      type: "feature",
      id: "autonomous_checkout",
      name: "Autonomous Checkout",
      enabled: true,
    },
  ],

  transports: ["REST", "MCP", "A2A"],

  endpoints: {
    base: `${SITE_URL}/api/v1`,
    catalog: `${SITE_URL}/api/v1/categories`,
    products: `${SITE_URL}/api/v1/products`,
    orders: `${SITE_URL}/api/v1/orders`,
    cart: `${SITE_URL}/api/v1/cart`,
    vendors: `${SITE_URL}/api/v1/vendors`,
    payments: `${SITE_URL}/api/v1/payments`,
    delivery: `${SITE_URL}/api/v1/delivery`,
    auth: `${SITE_URL}/api/v1/auth`,
  },

  payment_methods: [
    { type: "card", provider: "moyasar", supported: true },
    { type: "apple_pay", supported: true },
    { type: "google_pay", supported: true },
    { type: "cod", supported: true, label: "Cash on Delivery" },
  ],

  delivery: {
    supported: true,
    same_day: true,
    scheduled: true,
    tracked: true,
    regions: ["Riyadh", "Jeddah", "Dammam", "Other Saudi regions"],
  },

  documentation: {
    api_spec: `${SITE_URL}/openapi.json`,
    api_catalog: `${SITE_URL}/.well-known/api-catalog`,
    auth_guide: `${SITE_URL}/auth.md`,
    llms_txt: `${SITE_URL}/llms.txt`,
    guide: `${SITE_URL}/docs/api`,
  },

  authentication: {
    type: "oauth2",
    authorization_server: `${SITE_URL}/.well-known/openid-configuration`,
    protected_resource: `${SITE_URL}/.well-known/oauth-protected-resource`,
  },

  locales: ["ar", "en"],
  default_locale: "ar",
  currency: "SAR",
  country: "SA",
};

export async function GET() {
  return NextResponse.json(ucpManifest, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      Link: [
        `<${SITE_URL}/.well-known/api-catalog>; rel="api-catalog"`,
        `<${SITE_URL}/openapi.json>; rel="service-desc"`,
        `<${SITE_URL}/.well-known/openid-configuration>; rel="oauth-authorization-server"`,
      ].join(", "),
    },
  });
}
