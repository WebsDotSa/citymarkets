// Content-negotiation middleware — proxy layer for auth, CSRF, CSP nonce.
// https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/
// RFC 9727 Section 3

// In Next.js 16, the new convention is `proxy.ts`, but Turbopack 16.2.11 has
// a regression that does NOT register `proxy.ts` in
// `.next/server/middleware-manifest.json` (it stays empty `{}`). The runtime
// request pipeline reads the manifest, so the proxy never fires. Renaming
// to the legacy `middleware.ts` (still supported in Next 16) restores
// registration. Defaults to the Node.js runtime — required because the
// customer session JWT is verified with the same `JWT_SECRET` available to
// Node API routes (via `process.env.JWT_SECRET` populated by
// scripts/start.sh).

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import {
  ADMIN_SESSION_COOKIE,
  VENDOR_SESSION_COOKIE,
} from "@/lib/auth-cookie-name";
import { getAdminJwtSecretBytes, getVendorJwtSecretBytes } from "@/lib/env";
import { getCustomerUserIdFromRequest } from "@/lib/customer-session";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import { query } from "@/lib/db";
import {
  CSRF_COOKIE_NAME,
  generateCsrfToken,
  requiresCsrfProtection,
  validateCsrfRequest,
} from "@/lib/csrf";

// Category name→slug cache for middleware-level redirects (5-min TTL)
let _catCache: Map<string, string> | null = null;
let _catCacheTs = 0;
const CAT_CACHE_TTL = 5 * 60 * 1000;

async function getCategorySlugMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (_catCache && now - _catCacheTs < CAT_CACHE_TTL) return _catCache;
  try {
    const r = await query(
      "SELECT slug, name_ar FROM categories WHERE is_active = TRUE",
      [],
    );
    const m = new Map<string, string>();
    for (const row of r.rows as { slug: string; name_ar: string }[]) {
      m.set(row.slug, row.slug);
      if (row.name_ar) m.set(row.name_ar, row.slug);
    }
    _catCache = m;
    _catCacheTs = now;
  } catch {
    if (!_catCache) _catCache = new Map();
  }
  return _catCache!;
}

// Routes that require an authenticated customer session. Server-side guard —
// the client-side guard in <CustomerAuthGuard /> only renders a wall AFTER
// the page is already loaded. This proxy redirects unauthenticated
// visitors to /auth/login with `?redirect=` so they bounce back.
const PROTECTED_PREFIXES = ["/profile", "/orders", "/checkout"];

// Admin routes that require admin session (server-side guard).
// SECURITY (H8): was a hand-maintained prefix list that silently left new
// admin routes unguarded whenever a developer added a section. Now we match
// any path under `/admin/` except the login page. The dashboard root
// `/admin` and `/admin/<anything>` are all protected.
const PUBLIC_PROFILE_EXACT = new Set<string>(["/profile/loyalty"]);

// Admin sub-paths that must stay reachable without a session.
const ADMIN_PUBLIC_PREFIXES = ["/admin/login"];

const VENDOR_PROTECTED_PREFIX = "/vendor/";

function isAdminProtected(pathname: string): boolean {
  if (!pathname.startsWith("/admin")) return false;
  if (
    ADMIN_PUBLIC_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    )
  ) {
    return false;
  }
  return true;
}

function isPublicProfile(pathname: string): boolean {
  return PUBLIC_PROFILE_EXACT.has(pathname);
}

function isProtected(pathname: string): boolean {
  if (isPublicProfile(pathname)) return false;
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

function isVendorProtected(pathname: string): boolean {
  if (pathname.includes("/admin/login")) return false;
  return pathname.startsWith(VENDOR_PROTECTED_PREFIX);
}

/**
 * Vendor dashboards are per-store (`/vendor/<slug>/admin/...`), so an
 * unauthenticated vendor must land on THAT store's login page — not the
 * platform admin login, which uses a different session cookie and would
 * leave them in a redirect dead-end.
 */
function vendorLoginPath(pathname: string): string {
  const slug = pathname.split("/")[2];
  return slug ? `/vendor/${slug}/admin/login` : "/admin/login";
}

// CSRF: which API routes require token verification.
const API_PREFIXES = ["/api/v1/", "/api/admin/"] as const;

// Routes that are exempt from CSRF because they authenticate via a
// shared secret (HMAC) header that is not browser-readable, because
// they are the entry-point for establishing a session, or because
// they are stateless read-only calculations invoked as POST so we can
// carry a JSON body (lat/lng, code). The cart and checkout hit these
// from mobile-first client components that don't echo x-csrf-token.
const CSRF_EXEMPT_PATHS = [
  "/api/admin/auth/login", // admin login form posts without x-csrf-token (session-establishing, like /api/v1/auth/login)
  "/api/v1/auth/login", // legacy phone-OTP send
  "/api/v1/auth/twilio", // Twilio OTP send + verify (session-establishing)
  "/api/v1/vendor/auth/otp", // Phase 3 vendor staff OTP (session-establishing, mirrors customer)
  "/api/v1/employment", // public anonymous form submission (delegate + /employment)
  "/api/v1/payments/initiate", // authenticated by JWT cookie
  "/api/v1/payments/webhook", // authenticated by HMAC Bearer
  "/api/v1/payments/moyasar/callback", // authenticated by HMAC
  "/api/v1/payments/tamara/webhook", // authenticated by Bearer (TAMARA_WEBHOOK_TOKEN)
  // Vendor payment callback (Moyasar webhook + browser redirect). The
  // webhook is authenticated by HMAC via x-moyasar-signature and the
  // browser redirect is GET-only and carries no mutating payload, so
  // neither path can carry a CSRF exploit. Without this exemption the
  // vendor Moyasar callback is blocked by CSRF and vendor payments
  // silently never complete (regression when multi-vendor went live).
  "/api/v1/vendors/payment/callback",
  "/api/v1/auth/me", // GET only
  "/api/v1/track-order", // guest lookup
  "/api/v1/delivery/quote", // stateless delivery-fee quote (guest-friendly)
  "/api/v1/coupons/validate", // stateless coupon validation (read-only)
];

function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Markdown-for-Agents content negotiation gate.
 * Returns true only when:
 *   - The path is an HTML page (not /api/*, not a static asset).
 *   - The path doesn't have a file extension (Next.js page route).
 *   - It's not the homepage (the homepage is rendered via the App Router
 *     with a complex shell that doesn't have a markdown equivalent
 *     yet — better to leave it as HTML than to ship a half-broken
 *     stub).
 *
 * 2026-08-17: added so proxy.ts can decide whether to set the
 * x-markdown-request marker header for isitagentready.com compliance.
 */
function shouldServeMarkdown(request: NextRequest): boolean {
  const p = request.nextUrl.pathname;
  if (isApiPath(p)) return false;
  if (p === "/" || p === "") return false;
  // Static assets (.js, .css, .png, .svg, .ico, .woff2, .json, .xml, .txt)
  if (/\.[a-z0-9]{1,5}$/i.test(p)) return false;
  // Already-served markdown files (auth.md, llms.txt) — leave alone
  if (p.endsWith(".md") || p.endsWith(".txt")) return false;
  return true;
}

function isCsrfExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PATHS.some((p) => {
    // Exact match — the exempt path itself.
    if (pathname === p) return true;
    // Allow legitimate sub-paths (e.g. /api/v1/auth/twilio/verify
    // for /api/v1/auth/twilio) but NOT prefix-bypass attacks
    // (e.g. /api/v1/auth/twilio-evil would have matched the old
    // startsWith check).
    return pathname.startsWith(p + "/");
  });
}

function csrfErrorResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "انتهاك أمان - رمز التحقق غير صالح",
      code: "CSRF_ERROR",
    },
    { status: 403, headers: { "X-CSRF-Error": "true" } },
  );
}

/**
 * Auto-issue CSRF cookie on first visit so the client can read it and
 * echo it in the `x-csrf-token` header on subsequent mutating requests.
 */
function ensureCsrfCookie(
  request: NextRequest,
  response: NextResponse,
): string {
  let token = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  if (!token) {
    token = generateCsrfToken();
    response.cookies.set(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }
  return token;
}

async function verifyAdminToken(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, getAdminJwtSecretBytes(), {
      issuer: "citymarket-admin",
      audience: "citymarket-admin-api",
    });
    return true;
  } catch {
    return false;
  }
}

async function verifyVendorToken(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(VENDOR_SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, getVendorJwtSecretBytes(), {
      issuer: "citymarket-vendor",
      audience: "citymarket-vendor-api",
    });
    return true;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const acceptHeader = request.headers.get("accept") || "";
  const { pathname, search } = request.nextUrl;

  // ── CSRF gate (defense-in-depth for all mutating API routes) ──
  // Applies the double-submit cookie pattern uniformly instead of
  // requiring every route to import `applyCsrfProtection()`. Webhooks
  // and auth endpoints are exempt (they authenticate via secret header).
  if (
    isApiPath(pathname) &&
    requiresCsrfProtection(request.method) &&
    !isCsrfExempt(pathname)
  ) {
    const validation = await validateCsrfRequest(request);
    if (!validation.valid) {
      return csrfErrorResponse();
    }
  }

  // Server-side auth guard: redirect unauthenticated users to /auth/login
  // with a `redirect=` param so the login page can bounce them back after OTP.
  if (isProtected(pathname)) {
    const userId = await getCustomerUserIdFromRequest(request);
    if (!userId) {
      const loginUrl = new URL("/auth/login", request.url);
      loginUrl.searchParams.set(
        "redirect",
        sanitizeRedirectPath(pathname + search),
      );
      return NextResponse.redirect(loginUrl);
    }
  }

  // Server-side auth guard for admin routes
  if (isAdminProtected(pathname)) {
    const isValid = await verifyAdminToken(request);
    if (!isValid) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  // Server-side auth guard for vendor routes
  if (isVendorProtected(pathname)) {
    const isValid = await verifyVendorToken(request);
    if (!isValid) {
      return NextResponse.redirect(
        new URL(vendorLoginPath(pathname), request.url),
      );
    }
  }

  // ── Legacy /login alias → /auth/login ──
  // Server Component `redirect()` is unreliable under this proxy.ts (see
  // the comment below), so the redirect lives here at the middleware
  // layer where `NextResponse.redirect()` is honoured. The page route at
  // src/app/login/page.tsx remains as a noindex+canonical fallback for
  // crawlers that bypass the proxy.
  if (pathname === "/login" || pathname === "/login/") {
    return NextResponse.redirect(new URL("/auth/login", request.url), 308);
  }

  // ── Category name→slug canonicalization (SEO) ──
  // If a request hits /categories/<segment> where <segment> is the
  // Arabic name (or any other alias) instead of the canonical slug,
  // return a 307 to the canonical URL. The cache keeps DB pressure
  // down to one query per 5 minutes per process.
  //
  // Server Component `redirect()` is unreliable under this proxy.ts
  // (the NextResponse.next() created here freezes the response
  // status at 200), so the redirect MUST happen at the middleware
  // layer where `NextResponse.redirect()` is honoured.
  //
  // We deliberately skip admin edit routes (`/categories/new` and
  // any path with a second segment) — those are management UIs, not
  // public storefront pages.
  //
  // SECURITY/ROBUSTNESS: the previous check used
  // `pathname.split("/").length <= 3` to gate this branch. That broke
  // for nested slugs like `/categories/fruits/apples` because the
  // pathname would have 4 segments and the gate would silently skip
  // canonicalization. We now match exactly `/categories/<segment>`
  // (no extra slashes, no trailing path) with a regex so any future
  // hierarchical-slug experiment still triggers the redirect.
  const categorySingleSegmentMatch = /^\/categories\/([^/]+)\/?$/.exec(pathname);
  if (
    categorySingleSegmentMatch &&
    !pathname.includes("/new")
  ) {
    const rawSegment = categorySingleSegmentMatch[1];
    if (rawSegment && rawSegment !== "new") {
      let segment: string;
      try {
        segment = decodeURIComponent(rawSegment);
      } catch {
        segment = rawSegment;
      }
      const map = await getCategorySlugMap();
      const canonical = map.get(segment);
      if (canonical && canonical !== segment) {
        return NextResponse.redirect(
          new URL(
            `/categories/${encodeURIComponent(canonical)}${search}`,
            request.url,
          ),
          307,
        );
      }
    }
  }

  // Check if client accepts markdown
  const wantsMarkdown = acceptHeader.includes("text/markdown");

  // Markdown for Agents: when the client sends `Accept: text/markdown`
  // and is targeting the site root or any non-API HTML page, redirect
  // (302) to the canonical /md mirror. The mirror route serves a
  // deterministic Markdown body with Content-Type: text/markdown +
  // x-markdown-tokens header — exactly what Cloudflare / isitagentready
  // validators look for. (2026-08-17.)
  //
  // We use a 302 redirect (not content rewriting) because Next.js
  // middleware can't mutate the response body. The redirect is short-
  // lived for AI agents — humans never send `Accept: text/markdown`.
  if (
    wantsMarkdown &&
    (request.nextUrl.pathname === "/" || request.nextUrl.pathname === "")
  ) {
    const mdUrl = new URL("/md", request.nextUrl);
    return NextResponse.redirect(mdUrl, { status: 302 });
  }
  if (
    wantsMarkdown &&
    shouldServeMarkdown(request) &&
    !request.nextUrl.pathname.startsWith("/md")
  ) {
    const subPath = request.nextUrl.pathname.replace(/^\/+/, "");
    const mdUrl = new URL(`/md/${subPath}`, request.nextUrl);
    return NextResponse.redirect(mdUrl, { status: 302 });
  }

  // SECURITY (CSP-H): generate a per-request CSP nonce so we can drop
  // `'unsafe-inline'` from script-src. The nonce is exposed to Server
  // Components via `x-nonce` header (use `headers().get('x-nonce')`)
  // and also passed via the forwarded-request headers so Next.js'
  // built-in nonce propagation attaches it to the framework's
  // bootstrap <script> tags.
  const nonce = crypto.randomUUID().replace(/-/g, "");

  // SECURITY (H6): resolve the canonical session-id BEFORE building the
  // forwarded request so API routes never see a client-supplied value.
  const existingSessionId = request.cookies.get("session_id")?.value;
  const sessionId = existingSessionId ?? crypto.randomUUID();
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-session-id", sessionId);
  forwardedHeaders.set("x-nonce", nonce);
  // Forward pathname to Server Components (StoreChrome reads it via
  // headers() to decide whether to render header/bottom-nav). MUST go
  // on forwardedHeaders — Server Components read REQUEST headers, not
  // response headers (the latter are written after the request lifecycle).
  // Without this, StoreChrome receives an empty pathname and renders null.
  forwardedHeaders.set("x-pathname", request.nextUrl.pathname);

  const response = NextResponse.next({
    request: { headers: forwardedHeaders },
  });

  // Issue a new session cookie when the browser has none yet.
  // SECURITY (RBAC): 14-day TTL matching the customer JWT (previously 30d).
  if (!existingSessionId) {
    response.cookies.set("session_id", sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
  }
  // Echo on the response so client-side code (if needed) can read it.
  response.headers.set("x-session-id", sessionId);

  // Expose the nonce so Server Components can read it via
  // `headers().get("x-nonce")` and pass to <Script nonce={nonce} />.
  response.headers.set("x-nonce", nonce);

  // SECURITY (CSP-H): override the static CSP from next.config.mjs with a
  // per-request nonce-injected policy. The static policy is a baseline
  // fallback for static assets / API routes that don't go through this
  // proxy, but every HTML response gets a strict policy that drops
  // `'unsafe-inline'` and `'unsafe-eval'` from script-src.
  //
  // style-src still allows 'unsafe-inline' (Tailwind runtime + payment
  // iframes). A future tracked upgrade is to switch to nonce-based styles.
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // strict-dynamic lets the browser trust any script that a
      // nonce-bearing script loads, so we can keep adding first-party
      // bundles without editing CSP.
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://www.googletagmanager.com https://connect.facebook.net`,
      `script-src-elem 'self' 'nonce-${nonce}' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://www.googletagmanager.com https://connect.facebook.net`,
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://images.unsplash.com https://*.thawaniapp.com https://cdnjs.cloudflare.com https://raw.githubusercontent.com https://*.tile.openstreetmap.org https://www.openstreetmap.org https://cdn.citymarkets.sa https://www.facebook.com https://connect.facebook.net",
      "font-src 'self' data: https://cdnjs.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com",
      "connect-src 'self' https://api.citymarkets.sa https://*.moyasar.com https://api.moyasar.com https://www.google-analytics.com https://*.analytics.google.com https://connect.facebook.net https://*.facebook.com https://*.fbcdn.net",
      "frame-src 'self' https://api.moyasar.com",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "upgrade-insecure-requests",
      "block-all-mixed-content",
    ].join("; "),
  );

  // Indicate that we support markdown negotiation
  response.headers.set("Vary", "Accept");
  response.headers.set("X-Markdown-Negotiation", "supported");

  // Markdown for Agents: if the client prefers text/markdown (q-value
  // highest for it) and the request targets an HTML page (not /api/*,
  // not a static asset), forward a marker header that page components
  // read via headers() to choose a markdown-only render path. The
  // header itself is what Cloudflare / isitagentready.com scanners
  // look for to detect Markdown-for-Agents support.
  // (2026-08-17 isitagentready.com Level-2 fix.)
  if (wantsMarkdown && shouldServeMarkdown(request)) {
    forwardedHeaders.set("x-markdown-request", "1");
    response.headers.set("x-markdown-request", "1");
  }

  // Add Content-Signal header for AI indexing
  response.headers.set(
    "Content-Signal",
    "ai-train=no, search=yes, ai-input=yes",
  );

  // Auto-issue CSRF cookie so the client can echo it back on mutating
  // requests. Only the absence of a token is actioned here (no rotation
  // mid-session to avoid invalidating in-flight requests).
  ensureCsrfCookie(request, response);

  // Add Link headers for agent discovery (RFC 8288)
  const siteUrl = "https://citymarkets.sa";
  const linkHeaders = [
    `<${siteUrl}/.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"`,
    `<${siteUrl}/.well-known/openid-configuration>; rel="oauth-authorization-server"`,
    `<${siteUrl}/.well-known/oauth-protected-resource>; rel="protected-resource"`,
    `<${siteUrl}/.well-known/ucp>; rel="alternate"`,
    `<${siteUrl}/.well-known/acp.json>; rel="alternate"`,
    `<${siteUrl}/.well-known/mcp/server-card.json>; rel="alternate"`,
    `<${siteUrl}/.well-known/agent-skills/index.json>; rel="skill-index"`,
    `<${siteUrl}/auth.md>; rel="service-doc"; type="text/markdown"`,
    `<${siteUrl}/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"`,
    `<${siteUrl}/docs/api>; rel="service-doc"; type="text/html"`,
    `<${siteUrl}/sitemap.xml>; rel="sitemap"`,
  ];

  response.headers.set("Link", linkHeaders.join(", "));

  return response;
}

export const config = {
  // Force Node.js runtime — the customer session JWT is verified with
  // `process.env.JWT_SECRET` and the `pg` driver (transitively) reaches
  // `node:util/types`. The Edge runtime doesn't expose those built-ins,
  // which surfaces as `TypeError: Native module not found: node:util/types`
  // on the very first request. `middleware.ts` defaults to Edge; the
  // explicit `nodejs` here is required.
  runtime: "nodejs",
  matcher: [
    // Apply to all routes
    "/((?!_next/static|_next/image|favicon.ico|images/|fonts/).*)",
  ],
};

// Next.js 16 prefers the `proxy.ts` filename + `proxy()` export, but
// Turbopack 16.2.11 has a regression that does NOT register `proxy.ts`
// in `.next/server/middleware-manifest.json` (it ships `"middleware": {}`).
// Renaming the file to the legacy `src/middleware.ts` AND re-exporting
// under the legacy `middleware` name restores registration. The function
// is still named `proxy` because that's how every internal reference and
// architectural doc talks about it.
//
// See scripts/proxy-runtime-guard.ts for the runtime check.
export { proxy as middleware };
export default proxy;
