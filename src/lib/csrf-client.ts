/**
 * Browser-side CSRF helper — Synchronizer Token Pattern client.
 *
 * The server (`src/middleware.ts` + `src/lib/csrf.ts`) issues an
 * HTTPOnly `csrf_token` cookie on every request. JavaScript can no
 * longer read that cookie — by design (P2-2 / 2026-10-03) — because
 * the cookie's visibility was the load-bearing CSRF vulnerability:
 * any XSS payload could read it and forge the matching header.
 *
 * The new flow:
 *   1. The server-issued HTTPOnly cookie carries the token.
 *   2. The application JS fetches the token from
 *      `GET /api/v1/auth/csrf`, which returns the current token as
 *      JSON. The fetch is same-origin, so the browser attaches the
 *      cookie automatically; the server reads the cookie and echoes
 *      the value in the body.
 *   3. The application JS caches the token in memory and echoes it as
 *      `x-csrf-token` on every mutating request (via `csrfFetch`).
 *   4. The server validates that the header equals the cookie value
 *      (constant-time). Cross-site requests can not include the
 *      cookie (SameSite=strict), so they fail.
 *
 * Public surface unchanged: `csrfFetch(input, init)` and `csrfHeaders`
 * still have the same shape callers expect. The only behavioural
 * change is that the first call to a mutating endpoint before the
 * in-flight `/api/v1/auth/csrf` fetch resolves will hit the network
 * without the CSRF header — the server will reject it. In practice
 * the auto-fetcher below warms the cache before any user interaction,
 * so this is invisible.
 *
 * Use `csrfFetch` from any mutating client-side handler.
 */

import { CSRF_HEADER_NAME } from "./csrf-constants";

/**
 * Server endpoint that returns the current CSRF token. Kept here as a
 * constant so all client callers reach the same route — and so a
 * future move to e.g. `/api/v2/csrf` is one edit.
 */
const CSRF_TOKEN_ENDPOINT = "/api/v1/auth/csrf";

/**
 * Module-scoped token cache. Survives across `csrfFetch` calls in the
 * same page session but is wiped on a hard navigation (full page
 * reload) — that is fine because the cookie is still set, and the
 * next `/api/v1/auth/csrf` fetch refills the cache.
 */
let _cachedToken: string | null = null;
let _inFlight: Promise<string | null> | null = null;

/**
 * Best-effort warm-up of the token cache. Called from `csrfHeaders`
 * / `csrfFetch` so the first user POST usually hits a populated cache.
 * Errors are swallowed: if the fetch fails (network blip, server
 * down) the cache stays empty and the next call retries. The user
 * will see a 403 on a real mutating request, which is the correct
 * failure mode — silent fallback to a wrong token would be worse.
 */
function ensureTokenLoaded(): void {
  if (_cachedToken || _inFlight) return;
  if (typeof fetch === "undefined") return;
  _inFlight = (async () => {
    try {
      const res = await fetch(CSRF_TOKEN_ENDPOINT, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { token?: unknown };
      const t = typeof body?.token === "string" ? body.token : null;
      _cachedToken = t;
      return t;
    } catch {
      return null;
    } finally {
      _inFlight = null;
    }
  })();
}

/**
 * Return the cached CSRF token, or `null` if the cache has not been
 * populated yet (the in-flight fetch has not resolved). Callers
 * should treat `null` as "do not attach the header yet" — the next
 * `csrfFetch` after the cache fills will include it.
 *
 * Exposed for tests and rare code paths that need to force a fetch
 * and await it. Most callers should use `csrfHeaders` / `csrfFetch`.
 */
export function readCsrfToken(): string | null {
  ensureTokenLoaded();
  return _cachedToken;
}

/**
 * Async variant: resolves with the current token, awaiting the
 * in-flight fetch if needed. Useful when the caller MUST send the
 * header (e.g. a checkout submit button) and cannot retry. Most
 * callers should not need this — `csrfFetch` reads the cache
 * synchronously and the first user POST usually hits a populated
 * cache because the warm-up fired on first paint.
 */
export async function getCsrfToken(): Promise<string | null> {
  if (_cachedToken) return _cachedToken;
  ensureTokenLoaded();
  if (_inFlight) {
    await _inFlight.catch(() => null);
  }
  return _cachedToken;
}

/**
 * Explicit warm-up helper. Application code SHOULD call this once on
 * mount so the cache is populated before any mutating request fires.
 * The auto-warm-up already fires on the first `readCsrfToken` /
 * `csrfHeaders` / `csrfFetch` call, but a deliberate call here makes
 * the lifecycle explicit and avoids relying on first-touch.
 */
export async function prefetchCsrfToken(): Promise<string | null> {
  ensureTokenLoaded();
  if (_inFlight) {
    await _inFlight.catch(() => null);
  }
  return _cachedToken;
}

/**
 * Reset the in-memory cache. Test-only helper — never call from
 * production code. Exposed so unit tests can run in isolation
 * without leaking tokens between cases.
 */
export function __resetCsrfCacheForTests(): void {
  _cachedToken = null;
  _inFlight = null;
}

/**
 * Build a `Headers` object that includes the CSRF header if a token
 * is available. Safe to merge with existing headers.
 */
export function csrfHeaders(
  existing?: HeadersInit,
): Record<string, string> {
  const merged: Record<string, string> = {};
  if (existing) {
    if (existing instanceof Headers) {
      existing.forEach((v, k) => {
        merged[k] = v;
      });
    } else if (Array.isArray(existing)) {
      for (const [k, v] of existing) merged[k] = v;
    } else {
      Object.assign(merged, existing);
    }
  }
  const token = readCsrfToken();
  if (token && !(CSRF_HEADER_NAME in merged)) {
    merged[CSRF_HEADER_NAME] = token;
  }
  return merged;
}

/**
 * `fetch` wrapper that automatically attaches the CSRF header. Use
 * this in place of raw `fetch` from any component that POSTs to
 * `/api/v1/...` (e.g. cart, checkout, profile).
 */
export function csrfFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const token = readCsrfToken();
  if (token && !headers.has(CSRF_HEADER_NAME)) {
    headers.set(CSRF_HEADER_NAME, token);
  }
  return fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? "include",
  });
}