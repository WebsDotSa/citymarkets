// RFC 8414 - OAuth 2.0 Authorization Server Metadata
// https://www.rfc-editor.org/rfc/rfc8414
// OpenID Connect Discovery 1.0
// http://openid.net/specs/openid-connect-discovery-1_0.html

import { NextResponse } from "next/server";

export const dynamic = "force-static";
export const revalidate = 86400; // Revalidate daily

const openidConfiguration = {
  // OAuth 2.0 Authorization Server Metadata (RFC 8414)
  issuer: "https://citymarkets.sa",
  authorization_endpoint: "https://citymarkets.sa/api/v1/auth/login",
  token_endpoint: "https://citymarkets.sa/api/v1/auth/token",
  userinfo_endpoint: "https://citymarkets.sa/api/v1/auth/me",
  
  // Supported grant types
  grant_types_supported: [
    "authorization_code",
    "refresh_token",
    "client_credentials",
  ],
  
  // Supported response types
  response_types_supported: ["code"],
  
  // Supported token types
  token_endpoint_auth_methods_supported: [
    "client_secret_post",
    "client_secret_basic",
  ],
  
  // Supported algorithms for signing
  id_token_signing_alg_values_supported: ["RS256", "HS256"],
  
  // Subject types supported
  subject_types_supported: ["public"],
  
  // JWKS URI for token verification
  jwks_uri: "https://citymarkets.sa/.well-known/jwks.json",
  
  // Scopes supported
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
    "categories:read",
    "payments:read",
    "payments:write",
  ],
  
  // Token lifetime
  access_token_ttl: 3600, // 1 hour
  refresh_token_ttl: 604800, // 7 days
  
  // Service provider information
  service_documentation: "https://citymarkets.sa/docs/api",
  ui_locales_supported: ["ar", "en"],
  
  // Claims supported
  claims_supported: [
    "sub",
    "name",
    "email",
    "phone",
    "address",
    "picture",
    "updated_at",
    "role",
    "user_id",
  ],
  
  // Revocation endpoint
  revocation_endpoint: "https://citymarkets.sa/api/v1/auth/revoke",
  
  // Code challenge methods
  code_challenge_methods_supported: ["S256"],
  
  // Agent-specific authentication
  registration_endpoint: "https://citymarkets.sa/auth.md",
  software_id: "city-markets-sa-v1",
  software_version: "1.0.0",
};

export async function GET() {
  return NextResponse.json(openidConfiguration, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
