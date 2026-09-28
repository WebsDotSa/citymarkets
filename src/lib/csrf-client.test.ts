import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./csrf-constants";
import { csrfFetch, csrfHeaders, readCsrfToken } from "./csrf-client";

/**
 * Browser-side CSRF helper — the cart/checkout POSTs MUST echo the
 * `csrf_token` cookie in the `x-csrf-token` header, otherwise the
 * proxy double-submit cookie gate returns 403
 * `انتهاك أمان - رمز التحقق غير صالح` (real P1 bug — was a hard
 * checkout block before this helper existed).
 *
 * The vitest default environment is `node`, so we stub a minimal
 * `document` object exposing only the cookie API our helper touches.
 */

function makeCookieJar(initial: string = "") {
  let value = initial;
  const doc = {
    get cookie() {
      return value;
    },
    set cookie(v: string) {
      // Mimic the browser behaviour: writing `name=; expires=...` clears
      // the cookie. Anything else appends / replaces (the helper only
      // sets a single key so this is enough for our tests).
      const eq = v.indexOf("=");
      if (eq < 0) return;
      const name = v.slice(0, eq).trim();
      const rest = v.slice(eq + 1);
      const isExpired = /expires=Thu, 01 Jan 1970/i.test(v);
      if (name === CSRF_COOKIE_NAME) {
        if (isExpired) {
          value = "";
        } else {
          value = `${name}=${rest}`;
        }
      }
    },
  };
  return doc;
}

function installDocument(jar: ReturnType<typeof makeCookieJar>) {
  vi.stubGlobal("document", jar as unknown as Document);
}

describe("readCsrfToken", () => {
  let jar: ReturnType<typeof makeCookieJar>;

  beforeEach(() => {
    jar = makeCookieJar();
    installDocument(jar);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when no cookie is set", () => {
    expect(readCsrfToken()).toBeNull();
  });

  it("reads the csrf_token cookie verbatim", () => {
    jar.cookie = `${CSRF_COOKIE_NAME}=abcdef1234567890; path=/`;
    expect(readCsrfToken()).toBe("abcdef1234567890");
  });

  it("decodes URL-encoded cookie values", () => {
    jar.cookie = `${CSRF_COOKIE_NAME}=abc%20def; path=/`;
    expect(readCsrfToken()).toBe("abc def");
  });

  it("ignores unrelated cookies and only returns the csrf one", () => {
    jar.cookie = `other=1; path=/`;
    jar.cookie = `${CSRF_COOKIE_NAME}=target; path=/`;
    jar.cookie = `another=2; path=/`;
    expect(readCsrfToken()).toBe("target");
  });
});

describe("csrfHeaders", () => {
  let jar: ReturnType<typeof makeCookieJar>;

  beforeEach(() => {
    jar = makeCookieJar();
    installDocument(jar);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds x-csrf-token when a cookie is present", () => {
    jar.cookie = `${CSRF_COOKIE_NAME}=csrf-xyz; path=/`;
    expect(csrfHeaders()).toEqual({ [CSRF_HEADER_NAME]: "csrf-xyz" });
  });

  it("returns empty object when no cookie is set", () => {
    expect(csrfHeaders()).toEqual({});
  });

  it("preserves the caller's existing headers and merges the CSRF header", () => {
    jar.cookie = `${CSRF_COOKIE_NAME}=csrf-xyz; path=/`;
    const out = csrfHeaders({ "Content-Type": "application/json" });
    expect(out["Content-Type"]).toBe("application/json");
    expect(out[CSRF_HEADER_NAME]).toBe("csrf-xyz");
  });

  it("does not overwrite an explicit caller-supplied x-csrf-token", () => {
    jar.cookie = `${CSRF_COOKIE_NAME}=cookie-value; path=/`;
    const out = csrfHeaders({ [CSRF_HEADER_NAME]: "explicit-value" });
    expect(out[CSRF_HEADER_NAME]).toBe("explicit-value");
  });

  it("accepts a Headers instance", () => {
    jar.cookie = `${CSRF_COOKIE_NAME}=csrf-xyz; path=/`;
    const h = new Headers({ "Content-Type": "text/plain" });
    const out = csrfHeaders(h);
    // Headers normalises header names to lowercase — that's fine, the
    // browser does the same when `new Headers(...)` is read out.
    expect(out["content-type"]).toBe("text/plain");
    expect(out[CSRF_HEADER_NAME]).toBe("csrf-xyz");
  });

  it("accepts a [k,v][] tuple array", () => {
    jar.cookie = `${CSRF_COOKIE_NAME}=csrf-xyz; path=/`;
    const out = csrfHeaders([["X-Foo", "bar"]]);
    expect(out["X-Foo"]).toBe("bar");
    expect(out[CSRF_HEADER_NAME]).toBe("csrf-xyz");
  });
});

describe("csrfFetch", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let jar: ReturnType<typeof makeCookieJar>;

  beforeEach(() => {
    jar = makeCookieJar();
    installDocument(jar);
    jar.cookie = `${CSRF_COOKIE_NAME}=csrf-xyz; path=/`;
    fetchSpy = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the x-csrf-token header automatically", async () => {
    await csrfFetch("/api/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get(CSRF_HEADER_NAME)).toBe("csrf-xyz");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("always includes credentials: include by default", async () => {
    await csrfFetch("/api/v1/orders", { method: "POST" });
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.credentials).toBe("include");
  });

  it("respects an explicit credentials: 'omit'", async () => {
    await csrfFetch("/api/v1/orders", {
      method: "POST",
      credentials: "omit",
    });
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.credentials).toBe("omit");
  });

  it("does not duplicate the header if the caller already set it", async () => {
    await csrfFetch("/api/v1/orders", {
      method: "POST",
      headers: { [CSRF_HEADER_NAME]: "caller-value" },
    });
    const [, init] = fetchSpy.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get(CSRF_HEADER_NAME)).toBe("caller-value");
  });
});