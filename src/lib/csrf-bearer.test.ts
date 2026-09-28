/**
 * Tests for the CSRF + Bearer auth integration. The CSRF gate must
 * still fire for cookie-authenticated mutating requests, but a real,
 * HMAC-valid Bearer token is enough on its own — native mobile clients
 * can't reliably set the Origin header and shouldn't have to round-trip
 * for a CSRF token.
 *
 * SECURITY (F7): A Bearer header must hold a verified customer JWT.
 * Junk tokens, expired tokens, or tokens with bad signatures are all
 * rejected — the previous regex match was trivially bypassable.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { validateCsrfRequest } from "@/lib/csrf";
import { signCustomerToken } from "@/lib/customer-session";

function makeRequest(opts: {
  origin?: string | null;
  authorization?: string | null;
  method?: string;
}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.origin) headers["origin"] = opts.origin;
  if (opts.authorization) headers["authorization"] = opts.authorization;
  return new NextRequest("https://citymarkets.sa/api/v1/cart", {
    method: opts.method ?? "POST",
    headers,
  });
}

describe("csrf — Origin behaviour", () => {
  it("passes when origin is in the trusted allowlist", async () => {
    const req = makeRequest({ origin: "https://citymarkets.sa" });
    expect((await validateCsrfRequest(req)).valid).toBe(true);
  });

  it("rejects unknown origin", async () => {
    const req = makeRequest({ origin: "https://evil.example.com" });
    expect((await validateCsrfRequest(req)).valid).toBe(false);
  });

  it("rejects missing origin when there is no Bearer header", async () => {
    const req = makeRequest({ origin: null });
    expect((await validateCsrfRequest(req)).valid).toBe(false);
  });
});

describe("csrf — Bearer fallback for native mobile", () => {
  it("accepts a real HMAC-valid customer JWT even with no Origin", async () => {
    const token = await signCustomerToken({
      userId: "user-1",
      phone: "+966500000000",
    });
    const req = makeRequest({ origin: null, authorization: `Bearer ${token}` });
    expect((await validateCsrfRequest(req)).valid).toBe(true);
  });

  it("rejects a Bearer header with a junk (unverified) token", async () => {
    // SECURITY (F7): a hand-crafted "JWT-looking" string must NOT pass
    // the CSRF gate. The previous regex match accepted anything.
    const req = makeRequest({
      origin: null,
      authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.signature",
    });
    expect((await validateCsrfRequest(req)).valid).toBe(false);
  });

  it("rejects a Bearer header with an obviously-too-short token", async () => {
    const req = makeRequest({
      origin: null,
      authorization: "Bearer abc",
    });
    expect((await validateCsrfRequest(req)).valid).toBe(false);
  });

  it("still rejects unknown origin even with a Bearer token", async () => {
    // The trusted-origin check is the OUTER gate. Bearer auth only
    // bypasses CSRF when there is no Origin header at all (the case
    // for native fetch() in iOS/Android where the platform sets
    // Origin). If a caller sends a crafted untrusted Origin, we
    // reject it regardless of the Bearer header.
    const req = makeRequest({
      origin: "https://evil.example.com",
      authorization: "Bearer abc.def.ghi",
    });
    expect((await validateCsrfRequest(req)).valid).toBe(false);
  });

  it("accepts a Bearer header with case-insensitive scheme", async () => {
    const token = await signCustomerToken({
      userId: "user-2",
      phone: "+966500000000",
    });
    const req = makeRequest({
      origin: null,
      authorization: `bearer ${token}`,
    });
    expect((await validateCsrfRequest(req)).valid).toBe(true);
  });

  it("still rejects mutating requests without Origin and without Bearer", async () => {
    const req = makeRequest({ origin: null });
    expect((await validateCsrfRequest(req)).valid).toBe(false);
  });

  it("rejects a Bearer header with no token", async () => {
    const req = makeRequest({ origin: null, authorization: "Bearer " });
    expect((await validateCsrfRequest(req)).valid).toBe(false);
  });

  it("rejects malformed Authorization headers that are not Bearer", async () => {
    const req = makeRequest({ origin: null, authorization: "Basic dXNlcjpwYXNz" });
    expect((await validateCsrfRequest(req)).valid).toBe(false);
  });
});
