import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSRF_HEADER_NAME } from "./csrf-constants";
import {
  csrfFetch,
  csrfHeaders,
  readCsrfToken,
  getCsrfToken,
  prefetchCsrfToken,
  __resetCsrfCacheForTests,
} from "./csrf-client";

/**
 * Browser-side CSRF helper — Synchronizer Token Pattern client.
 *
 * SECURITY (P2-2 / 2026-10-03): the cookie is HTTPOnly, so we no
 * longer read it via `document.cookie`. Instead the client fetches
 * the token from `GET /api/v1/auth/csrf` and caches it in module
 * scope. The tests stub `globalThis.fetch` to provide that token.
 */

function makeTokenEndpointResponse(token: string) {
  return new Response(JSON.stringify({ success: true, token }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("readCsrfToken (HTTPOnly cookie flow)", () => {
  beforeEach(() => {
    __resetCsrfCacheForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetCsrfCacheForTests();
  });

  function setFetchMock(impl: (input: RequestInfo | URL) => Promise<Response>) {
    globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
  }

  it("returns null on the server (no `fetch` global)", () => {
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch?: unknown }).fetch = undefined;
    try {
      expect(readCsrfToken()).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("kicks off a fetch to /api/v1/auth/csrf when the cache is empty", () => {
    const fetchSpy = vi.fn(async () => makeTokenEndpointResponse("seeded-token"));
    setFetchMock(fetchSpy);

    readCsrfToken();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(url)).toBe("/api/v1/auth/csrf");
    expect(init.credentials).toBe("include");
  });

  it("returns the cached token after the fetch resolves", async () => {
    const fetchSpy = vi.fn(async () => makeTokenEndpointResponse("seeded-token"));
    setFetchMock(fetchSpy);

    // First call kicks off the fetch; await getCsrfToken to let it settle.
    readCsrfToken();
    await getCsrfToken();

    expect(readCsrfToken()).toBe("seeded-token");
    // The fetch should still have been called only once (cache hit).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reuses the in-flight promise for concurrent calls (no thundering herd)", () => {
    const fetchSpy = vi.fn(async () => makeTokenEndpointResponse("seeded-token"));
    setFetchMock(fetchSpy);

    readCsrfToken();
    readCsrfToken();
    readCsrfToken();

    // All three reads share the same in-flight promise, so only one
    // fetch is issued before the promise resolves.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns null when the endpoint responds with a non-OK status", async () => {
    setFetchMock(async () =>
      new Response(JSON.stringify({ success: false }), { status: 500 }),
    );

    readCsrfToken();
    await getCsrfToken();

    expect(readCsrfToken()).toBeNull();
  });

  it("returns null when the endpoint body has no token field", async () => {
    setFetchMock(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    readCsrfToken();
    await getCsrfToken();

    expect(readCsrfToken()).toBeNull();
  });
});

describe("csrfHeaders", () => {
  beforeEach(() => {
    __resetCsrfCacheForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetCsrfCacheForTests();
  });

  it("adds x-csrf-token when the cache is populated", async () => {
    globalThis.fetch = vi.fn(
      async () => makeTokenEndpointResponse("csrf-xyz"),
    ) as unknown as typeof fetch;
    readCsrfToken();
    await getCsrfToken();

    expect(csrfHeaders()).toEqual({ [CSRF_HEADER_NAME]: "csrf-xyz" });
  });

  it("returns empty object when the cache has not resolved yet", () => {
    // Make the fetch resolve only after a microtask so we observe the
    // empty-cache state from a synchronous csrfHeaders() call.
    globalThis.fetch = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return makeTokenEndpointResponse("csrf-xyz");
    }) as unknown as typeof fetch;

    readCsrfToken(); // kick off fetch, but don't await
    expect(csrfHeaders()).toEqual({});
  });

  it("preserves the caller's existing headers and merges the CSRF header", async () => {
    globalThis.fetch = vi.fn(
      async () => makeTokenEndpointResponse("csrf-xyz"),
    ) as unknown as typeof fetch;
    readCsrfToken();
    await getCsrfToken();

    const out = csrfHeaders({ "Content-Type": "application/json" });
    expect(out["Content-Type"]).toBe("application/json");
    expect(out[CSRF_HEADER_NAME]).toBe("csrf-xyz");
  });

  it("does not overwrite an explicit caller-supplied x-csrf-token", async () => {
    globalThis.fetch = vi.fn(
      async () => makeTokenEndpointResponse("csrf-xyz"),
    ) as unknown as typeof fetch;
    readCsrfToken();
    await getCsrfToken();

    const out = csrfHeaders({ [CSRF_HEADER_NAME]: "explicit-value" });
    expect(out[CSRF_HEADER_NAME]).toBe("explicit-value");
  });

  it("accepts a Headers instance", async () => {
    globalThis.fetch = vi.fn(
      async () => makeTokenEndpointResponse("csrf-xyz"),
    ) as unknown as typeof fetch;
    readCsrfToken();
    await getCsrfToken();

    const h = new Headers({ "Content-Type": "text/plain" });
    const out = csrfHeaders(h);
    expect(out["content-type"]).toBe("text/plain");
    expect(out[CSRF_HEADER_NAME]).toBe("csrf-xyz");
  });

  it("accepts a [k,v][] tuple array", async () => {
    globalThis.fetch = vi.fn(
      async () => makeTokenEndpointResponse("csrf-xyz"),
    ) as unknown as typeof fetch;
    readCsrfToken();
    await getCsrfToken();

    const out = csrfHeaders([["X-Foo", "bar"]]);
    expect(out["X-Foo"]).toBe("bar");
    expect(out[CSRF_HEADER_NAME]).toBe("csrf-xyz");
  });
});

describe("csrfFetch", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    __resetCsrfCacheForTests();
    // Two responses: first the /api/v1/auth/csrf call, second the real
    // target. The vi.fn impl handles both.
    fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url.includes("/api/v1/auth/csrf")) {
        return makeTokenEndpointResponse("csrf-xyz");
      }
      return new Response("ok");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    // Pre-populate the cache so the csrfFetch calls below see the
    // header synchronously. Without this the cache would only fill
    // when the first csrfFetch's internal warm-up fetch resolves —
    // too late for that call's own header.
    await prefetchCsrfToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetCsrfCacheForTests();
  });

  it("attaches the x-csrf-token header automatically", async () => {
    // The cache is populated via the warm-up fetch in `beforeEach`.
    await csrfFetch("/api/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    // Find the call to /api/v1/orders (skipping the warm-up CSRF fetch).
    const targetCall = fetchSpy.mock.calls.find(
      (c) => !String(c[0]).includes("/api/v1/auth/csrf"),
    );
    expect(targetCall).toBeDefined();
    const headers = (targetCall![1] as RequestInit).headers as Headers;
    expect(headers.get(CSRF_HEADER_NAME)).toBe("csrf-xyz");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("always includes credentials: include by default", async () => {
    await csrfFetch("/api/v1/orders", { method: "POST" });
    const targetCall = fetchSpy.mock.calls.find(
      (c) => !String(c[0]).includes("/api/v1/auth/csrf"),
    );
    expect(targetCall).toBeDefined();
    expect((targetCall![1] as RequestInit).credentials).toBe("include");
  });

  it("respects an explicit credentials: 'omit'", async () => {
    await csrfFetch("/api/v1/orders", {
      method: "POST",
      credentials: "omit",
    });
    const targetCall = fetchSpy.mock.calls.find(
      (c) => !String(c[0]).includes("/api/v1/auth/csrf"),
    );
    expect(targetCall).toBeDefined();
    expect((targetCall![1] as RequestInit).credentials).toBe("omit");
  });

  it("does not duplicate the header if the caller already set it", async () => {
    await csrfFetch("/api/v1/orders", {
      method: "POST",
      headers: { [CSRF_HEADER_NAME]: "caller-value" },
    });
    const targetCall = fetchSpy.mock.calls.find(
      (c) => !String(c[0]).includes("/api/v1/auth/csrf"),
    );
    expect(targetCall).toBeDefined();
    const headers = (targetCall![1] as RequestInit).headers as Headers;
    expect(headers.get(CSRF_HEADER_NAME)).toBe("caller-value");
  });
});