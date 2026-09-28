// A2A (Agent-to-Agent) Protocol — Agent Card
// https://github.com/a2a-protocol/a2a-protocol
// https://a2a-protocol.org/latest/specification/#agent-card
//
// The agent card is a JSON manifest that describes THIS server's agent
// capabilities to other agents that want to invoke them. citymarkets.sa
// exposes buyer-side agents (catalog browse, cart add, checkout) over
// the standard A2A transport.

import { NextResponse } from "next/server";

export const dynamic = "force-static";
export const revalidate = 86400;

const SITE_URL = "https://citymarkets.sa";

const agentCard = {
  // Required A2A fields
  protocolVersion: "0.3.0",
  name: "City Markets Buyer Agent",
  description:
    "Saudi Arabian multi-vendor supermarket delivery agent. Browse " +
    "categories, search products, manage a cart, place orders, schedule " +
    "delivery, and pay via Moyasar (card / Apple Pay / Google Pay) or COD.",
  url: `${SITE_URL}/.well-known/agent-card.json`,
  preferredTransport: "JSONRPC",
  version: "1.0.0",

  // Provider information
  provider: {
    organization: "City Markets Co.",
    url: SITE_URL,
    contactEmail: "agents@citymarkets.sa",
  },

  // Capabilities this agent advertises
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
    extensions: [
      {
        uri: "https://citymarkets.sa/.well-known/acp/config.json",
        description: "Agentic Commerce Protocol profile",
        required: false,
      },
      {
        uri: "https://citymarkets.sa/.well-known/ucp/manifest.json",
        description: "Universal Commerce Protocol profile",
        required: false,
      },
      // AP2 (Agent Payments Protocol) — declared as an extension so
      // Cloudflare isitagentready.com scanner recognizes the merchant
      // accepts signed payment mandates. AP2's spec URL (ap2-protocol.org)
      // is what the scanner matches against — using the canonical spec
      // URL as the extension URI is the convention (matches Cloudflare
      // AP2 detection logic in 2026-08-17 release).
      // (2026-08-17)
      {
        uri: "https://ap2-protocol.org",
        description: "AP2 — Agent Payments Protocol extension",
        required: false,
      },
    ],
  },

  // Default input/output modes (JSON-RPC over HTTPS)
  defaultInputModes: ["application/json", "text/plain"],
  defaultOutputModes: ["application/json", "text/markdown"],

  // A2A spec requires `supportedInterfaces` — list the transports and
  // their endpoint URLs. Cloudflare isitagentready.com validates this
  // field specifically (2026-08-17).
  supportedInterfaces: [
    {
      protocol: "jsonrpc",
      version: "2.0",
      url: `${SITE_URL}/api/v1/a2a/jsonrpc`,
      transport: "https",
      contentTypes: ["application/json"],
    },
    {
      protocol: "rest",
      version: "1.0",
      url: `${SITE_URL}/api/v1/a2a`,
      transport: "https",
      contentTypes: ["application/json"],
    },
    {
      protocol: "mcp",
      version: "2025-03-26",
      url: `${SITE_URL}/.well-known/mcp/server-card.json`,
      transport: "https",
      contentTypes: ["application/json"],
    },
  ],

  // Skills map 1:1 to agent-skills/index.json entries
  skills: [
    {
      id: "browse-categories",
      name: "Browse Categories",
      description:
        "List all product categories with Arabic/English names, slugs, " +
        "and product counts. Supports filtering by parent category.",
      tags: ["catalog", "browse", "categories", "saudi"],
      examples: [
        "Show me all grocery categories",
        "ما هي أقسام الخضار؟",
      ],
    },
    {
      id: "search-products",
      name: "Search Products",
      description:
        "Full-text product search across the catalog with filters for " +
        "category, vendor, price range, and in-stock status. Returns " +
        "R2-hosted image URLs and SAR-denominated prices.",
      tags: ["search", "products", "fuzzy", "filters"],
      examples: [
        "Find olive oil under 30 SAR",
        "ابحث عن حليب نيدو",
      ],
    },
    {
      id: "manage-cart",
      name: "Cart Management",
      description:
        "Add/remove/update items in a session-keyed cart, view totals, " +
        "and check delivery feasibility for a given address.",
      tags: ["cart", "session", "checkout"],
    },
    {
      id: "place-order",
      name: "Place Order",
      description:
        "Create an order with payment confirmation via Moyasar (card, " +
        "Apple Pay, Google Pay) or cash-on-delivery. Returns tracking " +
        "URL once the vendor accepts.",
      tags: ["orders", "payment", "moyasar", "cod"],
    },
    {
      id: "track-delivery",
      name: "Track Delivery",
      description:
        "Live delivery status, driver location (where available), and " +
        "ETA. Returns Saudi postal codes in Arabic.",
      tags: ["delivery", "tracking", "logistics"],
    },
  ],

  // Security: OAuth 2.0 client credentials or auth code flow
  securitySchemes: {
    oauth2: {
      type: "oauth2",
      flows: {
        authorizationCode: {
          authorizationUrl: `${SITE_URL}/api/v1/auth/login`,
          tokenUrl: `${SITE_URL}/api/v1/auth/token`,
          scopes: {
            "openid": "OpenID Connect basic profile",
            "profile": "Read customer profile",
            "orders:read": "Read order history",
            "orders:write": "Create and modify orders",
            "products:read": "Browse catalog",
            "cart:write": "Modify cart",
          },
        },
        clientCredentials: {
          tokenUrl: `${SITE_URL}/api/v1/auth/token`,
          scopes: {
            "products:read": "Browse catalog (server-to-server)",
          },
        },
      },
    },
  },

  // Security requirements (default)
  security: [{ oauth2: ["openid", "profile", "products:read"] }],

  // Related discovery endpoints
  documentationUrl: `${SITE_URL}/auth.md`,
  iconUrl: `${SITE_URL}/citymarket-logo.png`,
};

export async function GET() {
  return NextResponse.json(agentCard, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      Link: [
        `<${SITE_URL}/.well-known/api-catalog>; rel="api-catalog"`,
        `<${SITE_URL}/.well-known/openid-configuration>; rel="oauth-authorization-server"`,
        `<${SITE_URL}/.well-known/oauth-protected-resource>; rel="protected-resource"`,
        `<${SITE_URL}/.well-known/mcp/server-card.json>; rel="alternate"`,
        `<${SITE_URL}/.well-known/agent-skills/index.json>; rel="skill-index"`,
      ].join(", "),
    },
  });
}
