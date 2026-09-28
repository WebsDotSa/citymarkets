// Agentic Commerce Protocol (ACP) Discovery
// https://agenticcommerce.dev
// https://github.com/agentic-commerce-protocol/agentic-commerce-protocol

import { NextResponse } from "next/server";

export const dynamic = "force-static";
export const revalidate = 86400;

const acpDiscovery = {
  // ACP canonical envelope — per rfc.discovery.md the protocol block is
  // an OBJECT containing name, version, and supported_versions. The
  // Cloudflare scanner validates this exact shape.
  protocol: {
    name: "acp",
    version: "2026-04-17",
    supported_versions: ["2026-04-17", "2025-09-29"],
  },

  // API base URL
  api_base_url: "https://citymarkets.sa/api/v1",

  // Supported transports — rfc.discovery.md example uses ["rest"]. We
  // also advertise "mcp" because the spec says MCP binding can be
  // declared here. (MAY requirement per the RFC.)
  transports: ["rest", "https", "mcp"],

  // Capabilities — per spec, `services` is an ARRAY OF STRINGS naming
  // each service the seller supports (e.g. "checkout", "catalog").
  // The scanner specifically validates this shape. We provide rich
  // service descriptors under `capabilities.service_details` for
  // consumers that want endpoint URLs / vendor lists.
  capabilities: {
    // REQUIRED — array of strings. Matches the rfc.discovery.md
    // example shape that the scanner validates against.
    services: [
      "checkout",
      "catalog",
      "cart",
      "orders",
      "payments",
      "delivery",
      "vendors",
    ],

    // Extended service metadata (non-spec, but useful for richer agents).
    service_details: [
      {
        id: "catalog",
        enabled: true,
        endpoints: ["/categories", "/products", "/vendors"],
      },
      {
        id: "cart",
        enabled: true,
        endpoints: ["/cart"],
      },
      {
        id: "orders",
        enabled: true,
        endpoints: ["/orders"],
      },
      {
        id: "payments",
        enabled: true,
        endpoints: ["/payments"],
      },
      {
        id: "delivery",
        enabled: true,
        endpoints: ["/delivery", "/delivery-addresses"],
      },
    ],

    // Agent-specific features
    agent_features: {
      autonomous_ordering: true,
      smart_reorder: true,
      price_monitoring: true,
      delivery_scheduling: true,
      multi_vendor_aggregation: true,
      preference_learning: false,
    },

    // Authentication
    authentication: {
      type: "oauth2",
      flows: ["authorization_code", "client_credentials"],
      token_endpoint: "https://citymarkets.sa/api/v1/auth/token",
      introspection: true,
    },

    // Payment integration
    payments: {
      integration: "moyasar",
      methods: ["card", "apple_pay", "google_pay", "cod"],
      currency: "SAR",
    },
  },
  
  // Commerce details
  commerce: {
    name: "City Markets",
    type: "multi_vendor_marketplace",
    region: "Saudi Arabia",
    locale: "ar",
    currency: "SAR",
    timezone: "Asia/Riyadh",
  },
  
  // Discovery endpoints
  discovery: {
    api_catalog: "https://citymarkets.sa/.well-known/api-catalog",
    openapi: "https://citymarkets.sa/openapi.json",
    oauth_config: "https://citymarkets.sa/.well-known/openid-configuration",
    protected_resource: "https://citymarkets.sa/.well-known/oauth-protected-resource",
    ucp: "https://citymarkets.sa/.well-known/ucp",
    mcp_server: "https://citymarkets.sa/.well-known/mcp/server-card.json",
    agent_skills: "https://citymarkets.sa/.well-known/agent-skills/index.json",
    auth_guide: "https://citymarkets.sa/auth.md",
  },
  
  // Service health
  health: {
    endpoint: "https://citymarkets.sa/api/v1/health",
    status: "operational",
  },
};

export async function GET() {
  return NextResponse.json(acpDiscovery, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      Link: [
        '<https://citymarkets.sa/.well-known/api-catalog>; rel="api-catalog"',
        '<https://citymarkets.sa/openapi.json>; rel="service-desc"',
        '<https://citymarkets.sa/.well-known/openid-configuration>; rel="oauth-authorization-server"',
        '<https://citymarkets.sa/.well-known/oauth-protected-resource>; rel="protected-resource"',
        '<https://citymarkets.sa/auth.md>; rel="service-doc"',
      ].join(", "),
    },
  });
}
