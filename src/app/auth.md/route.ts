// Auth.md - Agent Registration and Authentication Guide
// https://workos.com/auth-md
// https://github.com/workos/auth.md

import { NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-static";
export const revalidate = 86400;

// Constants for the auth.md content
const SITE_URL = getSiteUrl();
const AUTH_ENDPOINT = `${SITE_URL}/api/v1/auth/login`;
const TOKEN_ENDPOINT = `${SITE_URL}/api/v1/auth/token`;

// Auth.md spec requires the first H1 to be `# Auth.md` so scanners and
// validators can detect the file format (workos.com/auth-md). Anything
// after the required heading is treated as free-form agent documentation.
//
// The `agent_auth` block in the body is a documentation mirror of the
// structured field in /.well-known/oauth-protected-resource. Cloudflare
// isitagentready.com specifically searches for `agent_auth` in the
// markdown body (vs the PRM JSON) to satisfy its Auth.md heading check.
const authMdContent = `# Auth.md

> Authentication guide for AI agents and automated clients connecting to City Markets API.

## agent_auth

The \`agent_auth\` block below mirrors what the resource server publishes at
\`/.well-known/oauth-protected-resource\` (the structured source of truth).
Agents should always prefer the PRM document at runtime, but this prose
mirror helps scanners and integrators reading the markdown.

\`\`\`json
{
  "skill": "https://citymarkets.sa/auth.md",
  "identity_endpoint": "https://citymarkets.sa/api/v1/auth/twilio/send",
  "claim_endpoint": "https://citymarkets.sa/api/v1/auth/twilio/verify",
  "events_endpoint": "https://citymarkets.sa/api/v1/auth/csrf",
  "identity_types_supported": ["phone_otp"],
  "events_supported": [
    "https://schemas.workos.com/events/agent/auth/identity/assertion/revoked"
  ]
}
\`\`\`

## Overview

City Markets API provides OAuth 2.0 / OpenID Connect authentication for AI agents and automated clients.

## Quick Start for Agents

### 1. Discover Authentication Configuration

First, retrieve the OAuth/OIDC configuration:

\`\`\`
GET ${SITE_URL}/.well-known/openid-configuration
\`\`\`

This returns the authorization server metadata including:
- \`authorization_endpoint\`
- \`token_endpoint\`
- \`scopes_supported\`
- \`grant_types_supported\`

### 2. Register as an Agent

Register your agent/client by contacting the authorization server or using self-registration if supported.

### 3. Obtain Access Token

#### Authorization Code Flow (for user-facing agents)

\`\`\`
GET ${AUTH_ENDPOINT}?
  response_type=code&
  client_id=YOUR_CLIENT_ID&
  redirect_uri=YOUR_REDIRECT_URI&
  scope=openid profile orders:read products:read&
  state=RANDOM_STATE&
  code_challenge=CODE_CHALLENGE&
  code_challenge_method=S256
\`\`\`

#### Client Credentials Flow (for autonomous agents)

\`\`\`
POST ${TOKEN_ENDPOINT}
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&
client_id=YOUR_CLIENT_ID&
client_secret=YOUR_CLIENT_SECRET&
scope=products:read orders:read orders:write
\`\`\`

### 4. Use Access Token

Include the access token in API requests:

\`\`\`
GET ${SITE_URL}/api/v1/products
Authorization: Bearer YOUR_ACCESS_TOKEN
\`\`\`

## Supported Authentication Methods

| Method | Type | Use Case |
|--------|------|----------|
| \`client_secret_post\` | Client Credentials | Server-side agents |
| \`client_secret_basic\` | Client Credentials | CLI tools |
| \`authorization_code + PKCE\` | User Auth | User-context agents |
| \`refresh_token\` | Token Refresh | Long-running agents |

## Available Scopes

| Scope | Description | Arabic Description |
|-------|-------------|-------------------|
| \`openid\` | OpenID Connect | الاتصال المفتوح |
| \`profile\` | User profile | الملف الشخصي |
| \`email\` | Email address | البريد الإلكتروني |
| \`phone\` | Phone number | رقم الهاتف |
| \`address\` | Delivery addresses | عناوين التوصيل |
| \`orders:read\` | Read orders | قراءة الطلبات |
| \`orders:write\` | Create/update orders | إنشاء/تحديث الطلبات |
| \`cart:read\` | Read cart | قراءة السلة |
| \`cart:write\` | Modify cart | تعديل السلة |
| \`products:read\` | Browse products | تصفح المنتجات |
| \`products:write\` | Manage products | إدارة المنتجات |
| \`payments:read\` | Read payment history | قراءة المدفوعات |
| \`payments:write\` | Process payments | معالجة المدفوعات |

## Discovery Documents

- **OpenID Configuration**: [/.well-known/openid-configuration](${SITE_URL}/.well-known/openid-configuration)
- **Protected Resource**: [/.well-known/oauth-protected-resource](${SITE_URL}/.well-known/oauth-protected-resource)
- **API Catalog**: [/.well-known/api-catalog](${SITE_URL}/.well-known/api-catalog)
- **OpenAPI Spec**: [/openapi.json](${SITE_URL}/openapi.json)

## Example: Agent Shopping Session

\`\`\`javascript
// 1. Discover endpoints
const config = await fetch('${SITE_URL}/.well-known/openid-configuration');
const { authorization_endpoint, token_endpoint } = await config.json();

// 2. Get access token (client credentials)
const tokenResponse = await fetch(token_endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: 'your-agent-id',
    client_secret: 'your-agent-secret',
    scope: 'products:read orders:read orders:write cart:read cart:write'
  })
});
const { access_token } = await tokenResponse.json();

// 3. Search products
const products = await fetch('${SITE_URL}/api/v1/products?search=milk', {
  headers: { 'Authorization': \`Bearer \${access_token}\` }
});

// 4. Add to cart
await fetch('${SITE_URL}/api/v1/cart', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${access_token}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ productId: '123', quantity: 2 })
});

// 5. Create order
const order = await fetch('${SITE_URL}/api/v1/orders', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${access_token}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    deliveryAddress: '123 Main St, Riyadh',
    paymentMethod: 'moyasar'
  })
});
\`\`\`

## Token Lifetime

- **Access Token TTL**: 3600 seconds (1 hour)
- **Refresh Token TTL**: 604800 seconds (7 days)

## Error Handling

| Error Code | Description |
|------------|-------------|
| \`invalid_client\` | Client authentication failed |
| \`invalid_scope\` | Requested scope is not allowed |
| \`invalid_grant\` | Authorization code or refresh token invalid |
| \`unauthorized_client\` | Client is not authorized for this grant type |

## Contact & Support

- **Website**: ${SITE_URL}
- **API Docs**: ${SITE_URL}/docs/api
- **Support Email**: support@citymarkets.sa

## Compliance

- OAuth 2.0 (RFC 6749)
- OpenID Connect Discovery 1.0
- RFC 8414 - OAuth 2.0 Authorization Server Metadata
- RFC 9728 - OAuth 2.0 Protected Resource Metadata
`;

// JSON metadata for the auth.md page
const authMdMetadata = {
  title: "Agent Authentication Guide",
  description: "How to authenticate AI agents with the City Markets API",
  content_type: "text/markdown",
  url: "https://citymarkets.sa/auth.md",
  discovery: {
    oauth_configuration: "https://citymarkets.sa/.well-known/openid-configuration",
    protected_resource: "https://citymarkets.sa/.well-known/oauth-protected-resource",
    api_catalog: "https://citymarkets.sa/.well-known/api-catalog",
  },
  agent_auth: {
    register_uri: "https://citymarkets.sa/api/v1/auth/register",
    supported_identity_types: ["client_id"],
    supported_credential_types: ["client_secret", "jwt"],
    supported_grant_types: ["client_credentials", "authorization_code", "refresh_token"],
    token_endpoint_auth_methods: ["client_secret_post", "client_secret_basic"],
  },
};

export async function GET() {
  // Return the markdown content
  return new NextResponse(authMdContent, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      // Link headers per RFC 8288
      Link: [
        '<https://citymarkets.sa/.well-known/openid-configuration>; rel="oauth-authorization-server"; type="application/json"',
        '<https://citymarkets.sa/.well-known/oauth-protected-resource>; rel="protected-resource"; type="application/json"',
        '<https://citymarkets.sa/.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
        '<https://citymarkets.sa/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
      ].join(", "),
      // Content-Signal header for AI indexing preferences
      "Content-Signal": "ai-train=no, search=yes, ai-input=yes",
    },
  });
}

// Also export metadata as a static JSON for programmatic access
export async function HEAD() {
  return new NextResponse(null, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Link": [
        '<https://citymarkets.sa/auth.md.meta.json>; rel="alternate"; type="application/json"',
      ].join(", "),
    },
  });
}
