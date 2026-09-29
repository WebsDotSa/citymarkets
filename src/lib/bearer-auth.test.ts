/**
 * Tests for src/lib/customer-session.ts — focus on the new Bearer
 * token extraction path that native mobile clients need.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { extractBearerToken, getCustomerUserIdFromRequest, signCustomerToken, verifyCustomerToken } from '@/lib/identity';

function makeRequest(auth?: string, cookie?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (auth) headers["authorization"] = auth;
  const req = new NextRequest("https://citymarkets.sa/api/v1/auth/me", { headers });
  if (cookie) {
    req.cookies.set("customer_session", cookie);
  }
  return req;
}

describe("customer-session — extractBearerToken", () => {
  it("pulls a token from a properly formed Authorization header", () => {
    const req = makeRequest("Bearer abc.def.ghi");
    expect(extractBearerToken(req)).toBe("abc.def.ghi");
  });

  it("is case-insensitive on the scheme", () => {
    const req = makeRequest("bearer abc.def.ghi");
    expect(extractBearerToken(req)).toBe("abc.def.ghi");
  });

  it("tolerates extra whitespace", () => {
    const req = makeRequest("Bearer    abc.def.ghi");
    expect(extractBearerToken(req)).toBe("abc.def.ghi");
  });

  it("returns null when header is missing", () => {
    expect(extractBearerToken(makeRequest())).toBeNull();
  });

  it("returns null for a non-Bearer scheme", () => {
    expect(extractBearerToken(makeRequest("Basic dXNlcjpwYXNz"))).toBeNull();
  });

  it("returns null when the token is empty", () => {
    expect(extractBearerToken(makeRequest("Bearer "))).toBeNull();
  });

  it("returns null when the token is too short to be real", () => {
    // A valid JWT must contain at least "<a>.<b>.<c>" pattern; anything
    // shorter than 5 chars cannot be a real signed token.
    expect(extractBearerToken(makeRequest("Bearer ab"))).toBeNull();
    expect(extractBearerToken(makeRequest("Bearer ab.cd"))).toBeNull();
    expect(extractBearerToken(makeRequest("Bearer abcde"))).toBeNull();
  });
});

describe("customer-session — getCustomerUserIdFromRequest (Bearer)", () => {
  it("verifies a HS256 JWT delivered via Bearer header", async () => {
    const token = await signCustomerToken({ userId: "user-1", phone: "+966500000000" });
    const req = makeRequest(`Bearer ${token}`);
    const userId = await getCustomerUserIdFromRequest(req);
    expect(userId).toBe("user-1");
  });

  it("falls back to the cookie when no Bearer header is present", async () => {
    const token = await signCustomerToken({ userId: "user-2", phone: "+966500000000" });
    const req = makeRequest(undefined, token);
    const userId = await getCustomerUserIdFromRequest(req);
    expect(userId).toBe("user-2");
  });

  it("prefers the Bearer token over the cookie", async () => {
    const bearerToken = await signCustomerToken({ userId: "user-bearer", phone: "+966500000000" });
    const cookieToken = await signCustomerToken({ userId: "user-cookie", phone: "+966500000000" });
    const req = makeRequest(`Bearer ${bearerToken}`, cookieToken);
    const userId = await getCustomerUserIdFromRequest(req);
    expect(userId).toBe("user-bearer");
  });

  it("rejects a forged Bearer token", async () => {
    // A token signed with a different secret; expect verification to fail.
    const req = makeRequest("Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.bm90X3JlYWxfc2lnbmF0dXJl");
    const userId = await getCustomerUserIdFromRequest(req);
    expect(userId).toBeNull();
  });

  it("returns null when both sources are missing", async () => {
    const userId = await getCustomerUserIdFromRequest(makeRequest());
    expect(userId).toBeNull();
  });

  it("round-trips a signed token through verifyCustomerToken", async () => {
    const token = await signCustomerToken({ userId: "user-3", phone: "+966500000001" });
    const payload = await verifyCustomerToken(token);
    expect(payload?.userId).toBe("user-3");
    expect(payload?.phone).toBe("+966500000001");
  });
});
