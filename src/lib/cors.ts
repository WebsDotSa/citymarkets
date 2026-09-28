/**
 * CORS allowlist for the public API.
 *
 * Browsers block cross-origin XHR/fetch unless the server emits the
 * right `Access-Control-*` headers. Native mobile clients do not need
 * CORS, but WebView shells (Capacitor, Ionics, PWA-in-WebView) and any
 * third-party domain that wants to call our API do.
 *
 * The allowlist is intentionally explicit: never fall back to
 * `*` when credentials are present.
 */
import { NextRequest, NextResponse } from "next/server";
import { isProd } from "@/lib/env";

const DEFAULT_PROD_ORIGINS = [
  "https://citymarkets.sa",
  "https://www.citymarkets.sa",
  "https://admin.citymarkets.sa",
  "https://vendor.citymarkets.sa",
];

const DEFAULT_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3005",
  "http://localhost:3006",
  "http://localhost:4040",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3005",
  "http://127.0.0.1:3006",
  "http://127.0.0.1:4040",
];

/**
 * Custom-scheme origins that native shells use. These are not real
 * URLs the browser can navigate to, but they show up in the `Origin`
 * header of `fetch()` calls from a WebView. Treat them as trusted.
 *
 * `citymarkets://` is the iOS URL scheme registered in
 * `Info.plist` (see IOS_APP_GUIDE.md). `https://citymarkets.sa` is
 * the universal-link host that resumes the app from a webview.
 */
const NATIVE_SCHEMES = [
  "citymarkets://",
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "https://localhost",
];

/**
 * Operator-supplied extra origins. Comma-separated. Useful when a
 * third-party partner (or a staging subdomain) needs CORS without us
 * shipping a code change.
 */
export function getConfiguredCorsOrigins(): string[] {
  return (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildAllowlist(): Set<string> {
  const configured = getConfiguredCorsOrigins();
  const set = new Set<string>([
    ...(isProd ? DEFAULT_PROD_ORIGINS : [...DEFAULT_PROD_ORIGINS, ...DEFAULT_DEV_ORIGINS]),
    ...NATIVE_SCHEMES,
    ...configured,
  ]);
  return set;
}

export function isCorsAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (origin.length > 2048) return false;
  // Native schemes often look like `null` or contain `localhost` — short-circuit
  if (origin === "null") return false;
  return buildAllowlist().has(origin);
}

/**
 * Apply CORS headers to a response. Always set `Vary: Origin` so shared
 * caches on the CDN don't serve one tenant's CORS response to another.
 *
 * Returns the same response (mutated) for chaining.
 */
export function applyCorsHeaders(
  request: NextRequest,
  response: NextResponse
): NextResponse {
  const origin = request.headers.get("origin");
  if (origin && isCorsAllowedOrigin(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-CSRF-Token, X-Session-Id, X-Request-Id, X-Idempotency-Key"
    );
    response.headers.set("Access-Control-Expose-Headers", "X-Request-Id, Retry-After, X-RateLimit-Remaining, X-RateLimit-Reset");
    response.headers.set("Access-Control-Max-Age", "86400");
  }
  response.headers.append("Vary", "Origin");
  return response;
}

/**
 * Handle OPTIONS preflight requests. Returns a 204 if the origin is
 * allowed, or 403 if not. The caller is expected to short-circuit
 * the rest of the request handler on OPTIONS.
 */
export function handlePreflight(request: NextRequest): NextResponse | null {
  if (request.method !== "OPTIONS") return null;
  const origin = request.headers.get("origin");
  if (!origin || !isCorsAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 403 });
  }
  const res = new NextResponse(null, { status: 204 });
  return applyCorsHeaders(request, res);
}

/**
 * Wrap a route handler so all responses receive CORS headers. Use as:
 *
 *   export const GET = withCors(async (req) => ok({...}));
 *
 * or for handlers returning NextResponse directly:
 *
 *   export const POST = withCors(async (req) => ok({...}));
 */
export function withCors(
  handler: (request: NextRequest) => Promise<NextResponse> | NextResponse
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    const response = await handler(request);
    return applyCorsHeaders(request, response);
  };
}
