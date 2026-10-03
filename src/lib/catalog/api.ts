import { CSRF_HEADER_NAME } from "@/lib/csrf-constants";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

// Endpoint that hands the current CSRF token back as JSON. The cookie
// itself is HTTPOnly, so JS can not read it directly; we have to ask
// the server for the value. The endpoint is same-origin, so the
// browser attaches the cookie automatically; the server reads the
// cookie and echoes it in the body. (P2-2 / 2026-10-03.)
const CSRF_TOKEN_ENDPOINT = "/api/v1/auth/csrf";

/**
 * Cached CSRF token for the lifetime of the JS context. Wiped on hard
 * navigation, which is fine — the cookie is still set and the next
 * `fetchCsrfToken` refills the cache.
 */
let _cachedToken: string | null = null;
let _inFlight: Promise<string | null> | null = null;

/**
 * Fetch the CSRF token from the server and cache it. Concurrent
 * callers reuse the same in-flight promise so we don't hammer the
 * endpoint on every mutating request.
 */
async function fetchCsrfToken(): Promise<string | null> {
  if (_cachedToken) return _cachedToken;
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}${CSRF_TOKEN_ENDPOINT}`, {
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
  return _inFlight;
}

/**
 * Ensure the CSRF token is being fetched. Fire-and-forget warm-up so
 * the first user-driven mutating call usually has a cached token.
 */
function warmCsrfCache(): void {
  if (_cachedToken || _inFlight) return;
  if (typeof fetch === "undefined") return;
  void fetchCsrfToken();
}

/**
 * Read the currently-cached CSRF token. `null` if the fetch has not
 * resolved yet. Callers should treat that as "send without the
 * header" — the server will reject the request, which is the correct
 * CSRF failure mode.
 */
function readCsrfToken(): string | null {
  warmCsrfCache();
  return _cachedToken;
}

/**
 * Warm the CSRF token cache. Returns the token once the warm-up
 * `/api/v1/auth/csrf` request resolves. Application code SHOULD
 * call this once on mount (e.g. inside a top-level layout effect) so
 * that the first user-driven mutating request hits a populated cache.
 *
 * Safe to call multiple times — concurrent callers share the same
 * in-flight promise.
 */
export async function prefetchCsrfToken(): Promise<string | null> {
  return fetchCsrfToken();
}

/**
 * Test-only helper. Resets the in-memory cache so subsequent calls
 * start fresh. Production code MUST NOT call this — it is exported
 * for unit tests that need isolation between cases.
 */
export function __resetCsrfCacheForTests(): void {
  _cachedToken = null;
  _inFlight = null;
}

/**
 * Generic API client. For mutating methods (POST/PUT/PATCH/DELETE) the
 * CSRF token is fetched from `GET /api/v1/auth/csrf` and echoed in
 * the `x-csrf-token` header. The proxy at `src/middleware.ts` enforces
 * the header-vs-cookie equality.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ success: boolean; data: T; error?: string }> {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const token = readCsrfToken();
    if (token) headers.set(CSRF_HEADER_NAME, token);
    if (!headers.has('content-type') && init.body && typeof init.body === 'string') {
      headers.set('content-type', 'application/json');
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  try {
    return await res.json();
  } catch {
    return { success: res.ok, data: undefined as unknown as T, error: res.statusText };
  }
}

export async function getCategories() {
  return apiFetch<any[]>('/api/v1/categories');
}

export async function getProducts(params?: {
  category?: string;
  featured?: boolean;
  deals?: boolean;
  search?: string;
  sort?: string;
  page?: number;
  limit?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.set('category', params.category);
  if (params?.featured) searchParams.set('featured', 'true');
  if (params?.deals) searchParams.set('deals', 'true');
  if (params?.search) searchParams.set('search', params.search);
  if (params?.sort) searchParams.set('sort', params.sort);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));

  return apiFetch<{
    data: any[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>(`/api/v1/products?${searchParams.toString()}`);
}

export async function getProduct(id: string) {
  return apiFetch<{ data: any; related: any[] }>(`/api/v1/products/${id}`);
}