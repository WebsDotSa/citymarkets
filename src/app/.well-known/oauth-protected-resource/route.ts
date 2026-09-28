// RFC 9728 - OAuth 2.0 Protected Resource Metadata
// https://www.rfc-editor.org/rfc/rfc9728

import { NextResponse } from "next/server";

export const dynamic = "force-static";
export const revalidate = 86400;

const protectedResourceMetadata = {
  // Resource identifier
  resource: "https://citymarkets.sa/api/v1",
  
  // Authorization servers that can issue tokens for this resource
  authorization_servers: [
    "https://citymarkets.sa",
  ],
  
  // Scopes supported by this resource
  scopes_supported: [
    "openid",
    "profile",
    "email",
    "phone",
    "address",
    "orders:read",
    "orders:write",
    "cart:read",
    "cart:write",
    "products:read",
    "products:write",
    "categories:read",
    "payments:read",
    "payments:write",
  ],
  
  // Bearer methods supported
  bearer_methods_supported: ["header", "body", "query"],
  
  // Resource signing algorithms (for JWT access tokens if used)
  resource_signing_alg_values_supported: ["RS256", "HS256"],
  
  // Token introspection endpoint
  introspection_endpoint: "https://citymarkets.sa/api/v1/auth/introspect",
  
  // Resource documentation
  resource_documentation: "https://citymarkets.sa/docs/api",
  
  // Feature discovery
  capabilities: {
    order_management: true,
    product_catalog: true,
    shopping_cart: true,
    payment_processing: true,
    delivery_tracking: true,
    multi_vendor: true,
  },
  
  // API version
  api_version: "v1",
  
  // Supported media types
  media_types_supported: [
    "application/json",
    "text/markdown",
    "application/linkset+json",
  ],
  
  // Resource scopes with descriptions (for agent discovery)
  resource_scopes: [
    {
      scope: "orders:read",
      description: "Read order information and status",
      description_ar: "قراءة معلومات الطلبات والحالة",
    },
    {
      scope: "orders:write",
      description: "Create and update orders",
      description_ar: "إنشاء وتحديث الطلبات",
    },
    {
      scope: "cart:read",
      description: "Read shopping cart contents",
      description_ar: "قراءة محتويات سلة التسوق",
    },
    {
      scope: "cart:write",
      description: "Modify shopping cart",
      description_ar: "تعديل سلة التسوق",
    },
    {
      scope: "products:read",
      description: "Browse and search products",
      description_ar: "تصفح والبحث عن المنتجات",
    },
    {
      scope: "products:write",
      description: "Add and update products (vendors only)",
      description_ar: "إضافة وتحديث المنتجات (للموردين فقط)",
    },
  ],

  // Auth.md agent_auth block — declares this resource server supports
  // the WorkOS Auth.md agent registration flow. Cloudflare
  // isitagentready.com validates this block specifically. (2026-08-17)
  // https://workos.com/blog/agent-registration-with-auth-md
  agent_auth: {
    skill: "https://citymarkets.sa/auth.md",
    identity_endpoint: "https://citymarkets.sa/api/v1/agent/identity",
    claim_endpoint: "https://citymarkets.sa/api/v1/agent/identity/claim",
    events_endpoint: "https://citymarkets.sa/api/v1/agent/event/notify",
    identity_types_supported: ["anonymous", "identity_assertion", "service_auth"],
    identity_assertion: {
      assertion_types_supported: [
        "urn:ietf:params:oauth:token-type:id-jag",
      ],
    },
    events_supported: [
      "https://schemas.workos.com/events/agent/auth/identity/assertion/revoked",
    ],
  },
};

export async function GET() {
  return NextResponse.json(protectedResourceMetadata, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      // Link headers for related discovery documents
      Link: [
        '<https://citymarkets.sa/.well-known/openid-configuration>; rel="oauth-authorization-server"',
        '<https://citymarkets.sa/.well-known/api-catalog>; rel="api-catalog"',
        '<https://citymarkets.sa/auth.md>; rel="service-doc"',
      ].join(", "),
    },
  });
}
