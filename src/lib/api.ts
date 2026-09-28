const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Generic API client. For mutating methods (POST/PUT/PATCH/DELETE) the
 * double-submit CSRF token is read from the cookie and echoed in the
 * `x-csrf-token` header. The proxy at `src/proxy.ts` enforces the match.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ success: boolean; data: T; error?: string }> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || {});

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const token = readCookie(CSRF_COOKIE_NAME);
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

export async function getBanners() {
  return apiFetch<any[]>('/api/v1/banners');
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
