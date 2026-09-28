/**
 * Browser-side CSRF helper.
 *
 * The proxy (`src/proxy.ts`) enforces a double-submit cookie pattern on
 * every mutating API route under `/api/v1/` and `/api/admin/`. The cookie
 * `csrf_token` is `httpOnly: false` so JavaScript CAN read it; the
 * matching header `x-csrf-token` MUST be echoed by the client on every
 * POST/PUT/PATCH/DELETE.
 *
 * Without these headers, the proxy responds with 403
 * `انتهاك أمان - رمز التحقق غير صالح` and the order create call fails.
 *
 * This module is the only place the cookie/header pair is read on the
 * client. Use `csrfFetch` from any mutating client-side handler.
 */

import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./csrf-constants";

/**
 * Read the current CSRF token from `document.cookie`. Returns `null`
 * on the server (no `document`) or when the cookie is missing — the
 * latter shouldn't happen on first paint because the proxy auto-issues
 * a cookie via `ensureCsrfCookie` on the very first request.
 */
export function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie;
  if (!raw) return null;
  const parts = raw.split("; ");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== CSRF_COOKIE_NAME) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

/**
 * Build a `Headers` object that includes the CSRF header if a token is
 * available. Safe to merge with existing headers.
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