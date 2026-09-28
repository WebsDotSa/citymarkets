// Universal Commerce Protocol (UCP) Discovery
// https://ucp.dev/specification/overview/

import { NextResponse } from "next/server";

export const dynamic = "force-static";
export const revalidate = 86400;

const ucpDiscovery = {
  // UCP root envelope (ucp.dev spec — must contain "ucp" field at root)
  ucp: {
    version: "1.0.0",
    spec: "https://ucp.dev/specification/overview/",
  },
  protocol: "ucp",
  version: "1.0.0",

  // Service information
  service: {
    name: "City Markets",
    description: {
      en: "Saudi Arabian multi-vendor supermarket delivery platform",
      ar: "منصة توصيل سوبرماركت متعددة الموردين سعودية",
    },
    provider: "City Markets Co.",
    website: "https://citymarkets.sa",
  },
  
  // Capabilities
  capabilities: {
    // Commerce capabilities
    catalog_browsing: true,
    product_search: true,
    cart_management: true,
    order_management: true,
    payment_processing: true,
    delivery_tracking: true,
    multi_vendor: true,
    inventory_management: true,
    
    // Agent capabilities
    agent_commerce: true,
    autonomous_checkout: true,
    smart_reordering: true,
    price_monitoring: true,
    delivery_scheduling: true,
  },
  
  // API endpoints
  endpoints: {
    base: "https://citymarkets.sa/api/v1",
    catalog: "https://citymarkets.sa/api/v1/categories",
    products: "https://citymarkets.sa/api/v1/products",
    orders: "https://citymarkets.sa/api/v1/orders",
    cart: "https://citymarkets.sa/api/v1/cart",
    vendors: "https://citymarkets.sa/api/v1/vendors",
    payments: "https://citymarkets.sa/api/v1/payments",
    delivery: "https://citymarkets.sa/api/v1/delivery",
    auth: "https://citymarkets.sa/api/v1/auth",
  },
  
  // Payment methods supported
  payment_methods: [
    {
      type: "card",
      provider: "moyasar",
      supported: true,
    },
    {
      type: "cash",
      supported: true,
      label: "Cash on Delivery",
    },
    {
      type: "wallet",
      supported: false,
      coming_soon: true,
    },
  ],
  
  // Delivery capabilities
  delivery: {
    supported: true,
    same_day: true,
    scheduled: true,
    tracked: true,
    regions: ["Riyadh", "Jeddah", "Dammam", "Other Saudi regions"],
  },
  
  // Discovery documents
  documentation: {
    api_spec: "https://citymarkets.sa/openapi.json",
    api_catalog: "https://citymarkets.sa/.well-known/api-catalog",
    auth_guide: "https://citymarkets.sa/auth.md",
    guide: "https://citymarkets.sa/docs/api",
  },
  
  // Authentication
  authentication: {
    type: "oauth2",
    authorization_server: "https://citymarkets.sa/.well-known/openid-configuration",
    protected_resource: "https://citymarkets.sa/.well-known/oauth-protected-resource",
  },
  
  // Supported locales
  locales: ["ar", "en"],
  default_locale: "ar",
  currency: "SAR",
  country: "SA",
};

export async function GET() {
  return NextResponse.json(ucpDiscovery, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      Link: [
        '<https://citymarkets.sa/.well-known/api-catalog>; rel="api-catalog"',
        '<https://citymarkets.sa/openapi.json>; rel="service-desc"',
        '<https://citymarkets.sa/.well-known/openid-configuration>; rel="oauth-authorization-server"',
      ].join(", "),
    },
  });
}
