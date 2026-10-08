import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  apiFetch,
  getCategories,
  getProducts,
  getProduct,
  prefetchCsrfToken,
  __resetCsrfCacheForTests,
} from "./api";

/**
 * Catalog API tests.
 *
 * SECURITY (P2-2 / 2026-10-03): the CSRF cookie is now HTTPOnly, so
 * JavaScript can no longer read it via `document.cookie`. The token
 * reaches the client via a fetch to `GET /api/v1/auth/csrf`. Tests
 * stub `globalThis.fetch` to provide that token.
 *
 * The first call to globalThis.fetch (which is the warm-up
 * `/api/v1/auth/csrf` request) returns the seed token, and
 * subsequent calls return the real target response.
 */
describe("apiFetch", () => {
  const originalFetch = globalThis.fetch;

  /**
   * Stub globalThis.fetch so that the first call (the warm-up
   * `/api/v1/auth/csrf`) returns a CSRF token seed, and every other
   * call returns a generic OK response.
   */
  const stubFetch = (csrfSeed: string | null) => {
    let csrfServed = csrfSeed === null; // null = no seed required
    const fetchSpy = vi.fn<typeof fetch>(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (!csrfServed && url.includes("/api/v1/auth/csrf")) {
        csrfServed = true;
        return new Response(
          JSON.stringify({ success: true, token: csrfSeed }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ success: true, data: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    return fetchSpy;
  };

  beforeEach(() => {
    __resetCsrfCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    __resetCsrfCacheForTests();
  });

  it("uses GET by default and does NOT set a CSRF header on GET", async () => {
    const fetchSpy = stubFetch("the-token");

    await apiFetch("/api/v1/categories");

    const targetCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes("/api/v1/categories"),
    );
    expect(targetCall).toBeDefined();
    const targetHeaders = (targetCall![1] as unknown as RequestInit)
      .headers as Headers;
    expect(targetHeaders.get("x-csrf-token")).toBeNull();
  });

  it("sets the x-csrf-token header on POST when the token is loaded", async () => {
    const fetchSpy = stubFetch("the-token");
    await prefetchCsrfToken();

    await apiFetch("/api/v1/orders", { method: "POST", body: "{}" });

    const targetCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes("/api/v1/orders"),
    );
    expect(targetCall).toBeDefined();
    const headers = (targetCall![1] as unknown as RequestInit).headers as Headers;
    expect(headers.get("x-csrf-token")).toBe("the-token");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("sets the x-csrf-token header on PUT / PATCH / DELETE", async () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      __resetCsrfCacheForTests();
      const fetchSpy = stubFetch("t");
      await prefetchCsrfToken();
      await apiFetch("/api/v1/x", { method, body: "{}" });
      const targetCall = fetchSpy.mock.calls.find(
        (c) => !String(c[0]).includes("/api/v1/auth/csrf"),
      );
      expect(targetCall).toBeDefined();
      const headers = (targetCall![1] as unknown as RequestInit)
        .headers as Headers;
      expect(headers.get("x-csrf-token")).toBe("t");
    }
  });

  it("omits the CSRF header when the token endpoint fails to load", async () => {
    // Mock that never seeds a token — simulates a CSRF endpoint
    // returning an error or being unreachable.
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ success: false }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await prefetchCsrfToken();
    await apiFetch("/api/v1/x", { method: "POST", body: "{}" });

    const targetCall = fetchSpy.mock.calls.find(
      (c) => !String(c[0]).includes("/api/v1/auth/csrf"),
    );
    expect(targetCall).toBeDefined();
    const headers = (targetCall![1] as unknown as RequestInit).headers as Headers;
    expect(headers.get("x-csrf-token")).toBeNull();
  });

  it("does NOT overwrite an explicit content-type the caller set", async () => {
    const fetchSpy = stubFetch("t");
    await prefetchCsrfToken();

    await apiFetch("/api/v1/x", {
      method: "POST",
      body: "<x/>",
      headers: { "content-type": "application/xml" },
    });

    const targetCall = fetchSpy.mock.calls.find(
      (c) => !String(c[0]).includes("/api/v1/auth/csrf"),
    );
    expect(targetCall).toBeDefined();
    const headers = (targetCall![1] as unknown as RequestInit).headers as Headers;
    expect(headers.get("content-type")).toBe("application/xml");
  });

  it("only auto-sets content-type when the body is a string", async () => {
    const fetchSpy = stubFetch("t");
    await prefetchCsrfToken();

    await apiFetch("/api/v1/x", {
      method: "POST",
      body: new Blob(["{}"]),
    });

    const targetCall = fetchSpy.mock.calls.find(
      (c) => !String(c[0]).includes("/api/v1/auth/csrf"),
    );
    expect(targetCall).toBeDefined();
    const headers = (targetCall![1] as unknown as RequestInit).headers as Headers;
    expect(headers.get("content-type")).not.toBe("application/json");
  });

  it("prefixes the path with API_BASE when configured", async () => {
    const original = process.env.NEXT_PUBLIC_API_URL;
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";
    vi.resetModules();
    const mod = await import("./api");
    mod.__resetCsrfCacheForTests();
    const fetchSpy = stubFetch(null);
    await mod.prefetchCsrfToken();
    await mod.apiFetch("/v1/categories");
    const targetCall = fetchSpy.mock.calls.find(
      (c) => !String(c[0]).includes("/api/v1/auth/csrf"),
    );
    expect(targetCall).toBeDefined();
    expect(String(targetCall![0])).toBe(
      "https://api.example.com/v1/categories",
    );
    if (original === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = original;
  });

  it("returns { success, data } on valid JSON", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { id: 1 } }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;
    const out = await apiFetch<{ id: number }>("/api/v1/x");
    expect(out).toEqual({ success: true, data: { id: 1 } });
  });

  it("falls back to { success, data: undefined, error } on non-JSON response", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("not json at all", {
          status: 500,
          statusText: "Internal Server Error",
        }),
    ) as unknown as typeof fetch;
    const out = await apiFetch("/api/v1/x");
    expect(out.success).toBe(false);
    expect(out.data).toBeUndefined();
    expect(out.error).toBeTruthy();
  });

  it("sends cookies via credentials: 'include'", async () => {
    const fetchSpy = stubFetch(null);
    await apiFetch("/api/v1/x");
    const targetCall = fetchSpy.mock.calls.find(
      (c) => !String(c[0]).includes("/api/v1/auth/csrf"),
    );
    expect(targetCall).toBeDefined();
    expect((targetCall![1] as unknown as RequestInit).credentials).toBe(
      "include",
    );
  });
});

describe("convenience helpers", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    __resetCsrfCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    __resetCsrfCacheForTests();
  });

  it("getCategories hits /api/v1/categories", async () => {
    const spy = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
      }),
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    await getCategories();
    const targetCall = spy.mock.calls.find(
      (c) => !String(c[0]).includes("/api/v1/auth/csrf"),
    );
    expect(targetCall).toBeDefined();
    expect(String(targetCall![0])).toMatch(/\/api\/v1\/categories$/);
  });

  it("getProducts builds query string from params", async () => {
    const spy = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: [],
          pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    await getProducts({
      category: "fruits",
      featured: true,
      deals: true,
      search: "apple",
      sort: "price-asc",
      page: 2,
      limit: 30,
    });
    const targetCall = spy.mock.calls.find(
      (c) => !String(c[0]).includes("/api/v1/auth/csrf"),
    );
    expect(targetCall).toBeDefined();
    const url = String(targetCall![0]);
    expect(url).toMatch(/category=fruits/);
    expect(url).toMatch(/featured=true/);
    expect(url).toMatch(/deals=true/);
    expect(url).toMatch(/search=apple/);
    expect(url).toMatch(/sort=price-asc/);
    expect(url).toMatch(/page=2/);
    expect(url).toMatch(/limit=30/);
  });

  it("getProducts omits params that are not provided", async () => {
    const spy = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: [],
          pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    await getProducts();
    const targetCall = spy.mock.calls.find(
      (c) => !String(c[0]).includes("/api/v1/auth/csrf"),
    );
    expect(targetCall).toBeDefined();
    expect(String(targetCall![0])).toMatch(/^\/api\/v1\/products\?$/);
  });

  it("getProduct hits /api/v1/products/<id>", async () => {
    const spy = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ success: true, data: { id: "abc" }, related: [] }),
        { status: 200 },
      ),
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    await getProduct("abc");
    const targetCall = spy.mock.calls.find(
      (c) => !String(c[0]).includes("/api/v1/auth/csrf"),
    );
    expect(targetCall).toBeDefined();
    expect(String(targetCall![0])).toMatch(/\/api\/v1\/products\/abc$/);
  });
});