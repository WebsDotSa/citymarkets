import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import {
  generateCsrfToken,
  getCsrfToken,
  setCsrfCookie,
  requiresCsrfProtection,
  validateCsrfRequest,
  validateCsrfToken,
  csrfErrorResponse,
  applyCsrfProtection,
  CSRF_COOKIE_NAME,
} from "./csrf";

// Mock next/headers so getCsrfToken() can run without a request context.
const mockCookieStore = {
  get: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(mockCookieStore),
}));

/**
 * Minimal NextRequest stub — only the bits we need.
 * Mock cookies via Object.defineProperty on the request.
 */
function mockRequest(opts: {
  method?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
}): NextRequest {
  const url = "http://localhost/";
  const headers = new Headers(opts.headers ?? {});
  const cookieEntries = Object.entries(opts.cookies ?? {}).map(
    ([k, v]) => `${k}=${v}`,
  );
  if (cookieEntries.length) headers.set("cookie", cookieEntries.join("; "));
  const req: any = {
    method: opts.method ?? "POST",
    headers,
    cookies: {
      get: (name: string) => {
        const v = opts.cookies?.[name];
        return v ? { name, value: v } : undefined;
      },
    },
    nextUrl: new URL(url),
    url,
  };
  return req as NextRequest;
}

describe("CSRF token generator", () => {
  it("produces 64-character hex (32 bytes)", () => {
    const token = generateCsrfToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different tokens on each call", () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generateCsrfToken());
    expect(set.size).toBe(100);
  });
});

describe("requiresCsrfProtection", () => {
  it("treats POST/PUT/PATCH/DELETE as mutating", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(requiresCsrfProtection(m)).toBe(true);
    }
  });

  it("treats GET/HEAD/OPTIONS as safe", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) {
      expect(requiresCsrfProtection(m)).toBe(false);
    }
  });

  it("is case-insensitive", () => {
    expect(requiresCsrfProtection("post")).toBe(true);
    expect(requiresCsrfProtection("Post")).toBe(true);
  });
});

describe("validateCsrfRequest (origin or double-submit)", () => {
  const token = generateCsrfToken();

  it("accepts an exact trusted browser origin without a token header", async () => {
    const req = mockRequest({
      headers: { origin: "https://citymarkets.sa" },
    });
    expect((await validateCsrfRequest(req)).valid).toBe(true);
  });

  it("accepts a trusted origin even when a stale token pair differs", async () => {
    const req = mockRequest({
      cookies: { [CSRF_COOKIE_NAME]: token },
      headers: {
        origin: "https://citymarkets.sa",
        "x-csrf-token": generateCsrfToken(),
      },
    });
    expect((await validateCsrfRequest(req)).valid).toBe(true);
  });

  it.each([
    "https://evil.example",
    "https://citymarkets.sa.evil.example",
    "http://citymarkets.sa",
    "https://citymarkets.sa:8443",
    "null",
    "not a url",
  ])("rejects untrusted origin %s even with matching tokens", async (origin) => {
    const req = mockRequest({
      cookies: { [CSRF_COOKIE_NAME]: token },
      headers: {
        origin,
        "x-csrf-token": token,
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
      },
    });
    expect((await validateCsrfRequest(req)).valid).toBe(false);
  });

  it("falls back to matching double-submit tokens when Origin is absent", async () => {
    const req = mockRequest({
      cookies: { [CSRF_COOKIE_NAME]: token },
      headers: { "x-csrf-token": token },
    });
    expect((await validateCsrfRequest(req)).valid).toBe(true);
  });

  it("rejects a request with neither Origin nor matching tokens", async () => {
    expect((await validateCsrfRequest(mockRequest({}))).valid).toBe(false);
  });
});

describe("validateCsrfToken (double-submit cookie pattern)", () => {
  const token = generateCsrfToken();

  it("accepts a request with matching cookie and header", () => {
    const req = mockRequest({
      cookies: { [CSRF_COOKIE_NAME]: token },
      headers: { "x-csrf-token": token },
    });
    expect(validateCsrfToken(req).valid).toBe(true);
  });

  it("rejects when the cookie is missing", () => {
    const req = mockRequest({
      headers: { "x-csrf-token": token },
    });
    const r = validateCsrfToken(req);
    expect(r.valid).toBe(false);
    expect(r.error).toContain("cookie");
  });

  it("rejects when the header is missing", () => {
    const req = mockRequest({
      cookies: { [CSRF_COOKIE_NAME]: token },
    });
    const r = validateCsrfToken(req);
    expect(r.valid).toBe(false);
    expect(r.error).toContain("header");
  });

  it("rejects when the header and cookie differ", () => {
    const req = mockRequest({
      cookies: { [CSRF_COOKIE_NAME]: token },
      headers: { "x-csrf-token": generateCsrfToken() }, // different token
    });
    expect(validateCsrfToken(req).valid).toBe(false);
  });

  it("rejects when tokens differ by a single character (no early return)", () => {
    const tampered = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    const req = mockRequest({
      cookies: { [CSRF_COOKIE_NAME]: token },
      headers: { "x-csrf-token": tampered },
    });
    expect(validateCsrfToken(req).valid).toBe(false);
  });

  it("rejects empty cookie even when header is empty", () => {
    const req = mockRequest({
      cookies: { [CSRF_COOKIE_NAME]: "" },
      headers: { "x-csrf-token": "" },
    });
    expect(validateCsrfToken(req).valid).toBe(false);
  });

  it("does not leak timing when tokens differ in length (timingSafeEqual guard)", () => {
    // After the 2026-09 hardening we no longer short-circuit on length
    // mismatch (that early return was itself a timing oracle). Both
    // inputs are SHA-256'd and compared via node:crypto.timingSafeEqual
    // so the response time is constant regardless of input length.
    // The test still pins the public contract: mismatched tokens are
    // rejected as invalid.
    const req = mockRequest({
      cookies: { [CSRF_COOKIE_NAME]: "short" },
      headers: { "x-csrf-token": "longer-token-here" },
    });
    expect(validateCsrfToken(req).valid).toBe(false);
  });
});

describe("getCsrfToken", () => {
  beforeEach(() => {
    mockCookieStore.get.mockReset();
  });

  it("returns the existing cookie value when present", async () => {
    mockCookieStore.get.mockReturnValueOnce({ value: "existing-token" });
    const token = await getCsrfToken();
    expect(token).toBe("existing-token");
  });

  it("generates a new token when the cookie is missing", async () => {
    mockCookieStore.get.mockReturnValueOnce(undefined);
    const token = await getCsrfToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("setCsrfCookie", () => {
  it("writes a 64-char hex cookie with the expected options", async () => {
    const set = vi.fn();
    const response = { cookies: { set } } as unknown as Parameters<
      typeof setCsrfCookie
    >[0];
    const out = setCsrfCookie(response);
    expect(out).toBe(response);
    expect(set).toHaveBeenCalledTimes(1);
    const [name, value, opts] = set.mock.calls[0];
    expect(name).toBe(CSRF_COOKIE_NAME);
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(opts.httpOnly).toBe(false);
    expect(opts.sameSite).toBe("strict");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(60 * 60 * 24);
  });
});

describe("csrfErrorResponse", () => {
  it("returns a 403 with the Arabic error and CSRF code", async () => {
    const res = csrfErrorResponse();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/رمز التحقق/);
    expect(body.code).toBe("CSRF_ERROR");
    expect(res.headers.get("X-CSRF-Error")).toBe("true");
  });
});

describe("applyCsrfProtection", () => {
  it("returns null for safe methods (no CSRF check)", async () => {
    const req = mockRequest({ method: "GET" });
    expect(await applyCsrfProtection(req)).toBeNull();
  });

  it("returns an error response for an untrusted POST request", async () => {
    const req = mockRequest({
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    const res = await applyCsrfProtection(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("returns null for a trusted origin POST", async () => {
    const req = mockRequest({
      method: "POST",
      headers: { origin: "https://citymarkets.sa" },
    });
    expect(await applyCsrfProtection(req)).toBeNull();
  });

  it("returns null for a POST with matching double-submit tokens", async () => {
    const t = generateCsrfToken();
    const req = mockRequest({
      method: "POST",
      cookies: { [CSRF_COOKIE_NAME]: t },
      headers: { "x-csrf-token": t },
    });
    expect(await applyCsrfProtection(req)).toBeNull();
  });
});
