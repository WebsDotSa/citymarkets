// MCP Server Card (SEP-1649) for Agent Discovery
// https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127

import { NextResponse } from "next/server";

export const dynamic = "force-static";
export const revalidate = 86400;

const serverCard = {
  // MCP Server Card format
  mcpServerCardVersion: "1.0.0",
  
  // Server information
  serverInfo: {
    name: "city-markets-mcp",
    version: "1.0.0",
    description: {
      en: "City Markets API - Saudi Arabian supermarket delivery platform with multi-vendor support",
      ar: "أسواق سيتي - منصة توصيل سوبرماركت سعودية مع دعم متعدد الموردين",
    },
    publisher: {
      name: "City Markets",
      url: "https://citymarkets.sa",
    },
  },
  
  // Transport endpoint
  transport: {
    type: "http-stream",
    endpoint: "https://citymarkets.sa/api/v1/mcp",
    protocols: ["mcp", "sse"],
  },
  
  // Capabilities
  capabilities: {
    // Shopping capabilities
    productSearch: {
      enabled: true,
      description: "Search products by name, category, or vendor",
    },
    productDetails: {
      enabled: true,
      description: "Get detailed product information including pricing and availability",
    },
    cartManagement: {
      enabled: true,
      description: "Add, update, and remove items from shopping cart",
    },
    orderCreation: {
      enabled: true,
      description: "Create and place orders",
    },
    orderTracking: {
      enabled: true,
      description: "Track order status and delivery progress",
    },
    vendorManagement: {
      enabled: true,
      description: "Browse vendors and their product catalogs",
    },
    categoryBrowsing: {
      enabled: true,
      description: "Browse product categories and subcategories",
    },
    // Payment capabilities
    paymentInitiation: {
      enabled: true,
      description: "Initiate payment for orders",
    },
  },
  
  // Authentication requirements
  authentication: {
    type: "oauth2",
    authorizationServer: "https://citymarkets.sa/.well-known/openid-configuration",
    scopes: ["products:read", "cart:read", "cart:write", "orders:read", "orders:write"],
  },
  
  // Supported protocols
  protocols: [
    {
      name: "mcp",
      version: "2024-11-05",
    },
  ],
  
  // API documentation
  documentation: {
    apiCatalog: "https://citymarkets.sa/.well-known/api-catalog",
    openApiSpec: "https://citymarkets.sa/openapi.json",
    authGuide: "https://citymarkets.sa/auth.md",
  },
};

export async function GET() {
  return NextResponse.json(serverCard, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      // Link header for MCP protocol
      Link: [
        '<https://citymarkets.sa/.well-known/openid-configuration>; rel="oauth-authorization-server"',
        '<https://citymarkets.sa/api/v1/mcp>; rel="service"',
      ].join(", "),
    },
  });
}
