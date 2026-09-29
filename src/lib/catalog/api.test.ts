import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch, getCategories, getProducts, getProduct } from "./api";

describe("apiFetch", () => {
  const originalFetch = globalThis.fetch;
  // Simulate a browser-like document.cookie for CSRF reads.
  const setCookie = (cookieString: string) => {
    Object.defineProperty(globalThis, "document", {
      value: { cookie: cookieString },
      configurable: true,
      writable: true,
    });
  };
  const unsetCookie = () => {
    Object.defineProperty(globalThis, "document", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    unsetCookie();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    unsetCookie();
  });

  it("uses GET by default and does NOT set a CSRF header on GET", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    setCookie("csrf_token=the-token; path=/");

    await apiFetch("/api/v1/categories");

    const init = fetchSpy.mock.calls[0][1] as unknown as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("x-csrf-token")).toBeNull();
  });

  it("sets the x-csrf-token header on POST when the cookie is present", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ success: true, data: null }), {
        status: 200,
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    setCookie("csrf_token=the-token");

    await apiFetch("/api/v1/orders", { method: "POST", body: "{}" });

    const init = fetchSpy.mock.calls[0][1] as unknown as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("x-csrf-token")).toBe("the-token");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("sets the x-csrf-token header on PUT / PATCH / DELETE", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ success: true, data: null }), {
        status: 200,
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    setCookie("csrf_token=t");

    for (const method of ["PUT", "PATCH", "DELETE"]) {
      fetchSpy.mockClear();
      await apiFetch("/api/v1/x", { method, body: "{}" });
      const headers = (fetchSpy.mock.calls[0][1] as unknown as RequestInit).headers as Headers;
      expect(headers.get("x-csrf-token")).toBe("t");
    }
  });

  it("omits the CSRF header when the cookie is missing on a mutating request", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    unsetCookie(); // no cookie

    await apiFetch("/api/v1/x", { method: "POST", body: "{}" });

    const headers = (fetchSpy.mock.calls[0][1] as unknown as RequestInit).headers as Headers;
    expect(headers.get("x-csrf-token")).toBeNull();
  });

  it("does NOT overwrite an explicit content-type the caller set", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    setCookie("csrf_token=t");

    await apiFetch("/api/v1/x", {
      method: "POST",
      body: "<x/>",
      headers: { "content-type": "application/xml" },
    });

    const headers = (fetchSpy.mock.calls[0][1] as unknown as RequestInit).headers as Headers;
    expect(headers.get("content-type")).toBe("application/xml");
  });

  it("only auto-sets content-type when the body is a string", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    setCookie("csrf_token=t");

    await apiFetch("/api/v1/x", {
      method: "POST",
      body: new Blob(["{}"]),
    });
    const headers = (fetchSpy.mock.calls[0][1] as unknown as RequestInit).headers as Headers;
    expect(headers.get("content-type")).not.toBe("application/json");
  });

  it("prefixes the path with API_BASE when configured", async () => {
    const original = process.env.NEXT_PUBLIC_API_URL;
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";
    // Re-import the module so it picks up the new env var.
    vi.resetModules();
    const mod = await import("./api");
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await mod.apiFetch("/v1/categories");
    expect((fetchSpy.mock.calls[0][0] as unknown as string)).toBe(
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
    // Use statusText via init so the response has a non-empty statusText.
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
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ success: true, data: null }), {
        status: 200,
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await apiFetch("/api/v1/x");
    const init = fetchSpy.mock.calls[0][1] as unknown as RequestInit;
    expect(init.credentials).toBe("include");
  });

  it("reads CSRF cookie that is mid-string (not at the start)", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    setCookie("session=abc; csrf_token=mid-token; theme=dark");

    await apiFetch("/api/v1/x", { method: "POST", body: "{}" });

    const headers = (fetchSpy.mock.calls[0][1] as unknown as RequestInit).headers as Headers;
    expect(headers.get("x-csrf-token")).toBe("mid-token");
  });
});

describe("convenience helpers", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("getCategories hits /api/v1/categories", async () => {
    const spy = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
      }),
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    await getCategories();
    expect((spy.mock.calls[0][0] as unknown as string)).toMatch(/\/api\/v1\/categories$/);
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
    const url = spy.mock.calls[0][0] as unknown as string;
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
    const url = spy.mock.calls[0][0] as unknown as string;
    expect(url).toMatch(/^\/api\/v1\/products\?$/);
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
    expect((spy.mock.calls[0][0] as unknown as string)).toMatch(/\/api\/v1\/products\/abc$/);
  });
});