// RFC 9727 - API Catalog for Automated API Discovery
// https://www.rfc-editor.org/rfc/rfc9727

import { NextResponse } from "next/server";

export const dynamic = "force-static";
export const revalidate = 3600; // Revalidate every hour

// API Catalog - Linkset format per RFC 9727
const apiCatalog = {
  // RFC 9727 application/linkset+json
  linkset: [
    {
      anchor: "https://citymarkets.sa/api/v1",
      links: [
        {
          rel: "service-desc",
          href: "https://citymarkets.sa/openapi.json",
          type: "application/vnd.oai.openapi+json;version=3.1",
          title: "OpenAPI 3.1 specification for City Markets API",
        },
        {
          rel: "service-doc",
          href: "https://citymarkets.sa/docs/api",
          type: "text/html",
          title: "API Documentation",
        },
        {
          rel: "status",
          href: "https://citymarkets.sa/api/v1/health",
          type: "application/json",
          title: "API Health Status",
        },
        {
          rel: "alternate",
          href: "https://citymarkets.sa/api/v1",
          type: "application/json",
          title: "API Base Endpoint",
        },
      ],
    },
    {
      anchor: "https://citymarkets.sa",
      links: [
        {
          rel: "api-catalog",
          href: "https://citymarkets.sa/.well-known/api-catalog",
          type: "application/linkset+json",
          title: "API Catalog",
        },
        {
          rel: "service-doc",
          href: "https://citymarkets.sa/docs",
          type: "text/html",
          title: "Documentation",
        },
      ],
    },
    {
      anchor: "https://citymarkets.sa/api/v1/products",
      links: [
        {
          rel: "collection",
          href: "https://citymarkets.sa/api/v1/products",
          type: "application/json",
          title: "Products Collection",
        },
        {
          rel: "describedby",
          href: "https://citymarkets.sa/docs/api#products",
          type: "text/html",
          title: "Products API Documentation",
        },
      ],
    },
    {
      anchor: "https://citymarkets.sa/api/v1/categories",
      links: [
        {
          rel: "collection",
          href: "https://citymarkets.sa/api/v1/categories",
          type: "application/json",
          title: "Categories Collection",
        },
      ],
    },
    {
      anchor: "https://citymarkets.sa/api/v1/orders",
      links: [
        {
          rel: "collection",
          href: "https://citymarkets.sa/api/v1/orders",
          type: "application/json",
          title: "Orders Collection",
        },
      ],
    },
    {
      anchor: "https://citymarkets.sa/api/v1/auth",
      links: [
        {
          rel: "service-desc",
          href: "https://citymarkets.sa/.well-known/openid-configuration",
          type: "application/json",
          title: "OAuth/OIDC Discovery",
        },
        {
          rel: "service-doc",
          href: "https://citymarkets.sa/auth.md",
          type: "text/markdown",
          title: "Agent Authentication Guide",
        },
      ],
    },
  ],
};

export async function GET() {
  return NextResponse.json(apiCatalog, {
    headers: {
      "Content-Type": "application/linkset+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      // Link headers per RFC 8288 for discoverability
      Link: [
        '<https://citymarkets.sa/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
        '<https://citymarkets.sa/docs/api>; rel="service-doc"',
        '<https://citymarkets.sa/api/v1/health>; rel="status"',
      ].join(", "),
    },
  });
}
