import { describe, expect, it, beforeAll } from "vitest";
import jwt from "jsonwebtoken";

// Provide a deterministic JWT_SECRET for tests so the canonical
// signCustomerToken (jose) and verifyCustomerToken (jose) round-trip.
beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-min-32-characters-long-aaaaaaa";
  (process.env as Record<string, string>).NODE_ENV = "development";
});

const {
  signCustomerToken,
  verifyCustomerToken,
  getCustomerUserIdFromRequest,
  resolveCustomerUserIdFromRequest,
  getGuestSessionIdFromRequest,
  customerSessionCookieOptions,
} = await import("./customer-session");

// Legacy tokens minted by jsonwebtoken, but carrying the customer
// issuer/audience so they satisfy the C-2 cross-issuer guard.
function signLegacyToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: "30d",
    issuer: "citymarket-customer",
    audience: "citymarket-customer-api",
  });
}

// Legacy token with no iss/aud at all — must be rejected.
function signClaimlessToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: "30d" });
}

describe("customer-session.ts (jose end-to-end)", () => {
  it("round-trips a token: signCustomerToken → verifyCustomerToken", async () => {
    const token = await signCustomerToken({
      userId: "user-abc",
      phone: "+966500000000",
    });
    const claims = await verifyCustomerToken(token);
    expect(claims).toEqual({ userId: "user-abc", phone: "+966500000000" });
  });

  it("accepts a legacy jsonwebtoken-signed token (interoperability)", async () => {
    const token = signLegacyToken({
      userId: "user-legacy",
      phone: "+966500000001",
    });
    const claims = await verifyCustomerToken(token);
    expect(claims).toEqual({
      userId: "user-legacy",
      phone: "+966500000001",
    });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = jwt.sign(
      { userId: "x", phone: "+966500000000" },
      "a-different-secret-of-thirty-two-chars",
      { expiresIn: "30d" }
    );
    expect(await verifyCustomerToken(token)).toBeNull();
  });

  it("rejects garbage tokens", async () => {
    expect(await verifyCustomerToken("not-a-jwt")).toBeNull();
    expect(await verifyCustomerToken("")).toBeNull();
  });

  it("rejects tokens missing required claims", async () => {
    expect(
      await verifyCustomerToken(await signCustomerToken({ userId: "u" } as never))
    ).toBeNull();
    expect(
      await verifyCustomerToken(
        await signCustomerToken({ phone: "+9665" } as never)
      )
    ).toBeNull();
  });
});

describe("getCustomerUserIdFromRequest (jose, JWT only)", () => {
  it("returns null when cookie is absent", async () => {
    expect(
      await getCustomerUserIdFromRequest({
        cookies: { get: () => undefined },
      } as never)
    ).toBeNull();
  });

  it("returns the userId for a valid cookie", async () => {
    const token = await signCustomerToken({
      userId: "user-xyz",
      phone: "+966500000000",
    });
    const userId = await getCustomerUserIdFromRequest({
      cookies: {
        get: (name: string) =>
          name === "customer_session" ? { value: token } : undefined,
      },
    } as never);
    expect(userId).toBe("user-xyz");
  });

  it("returns null when the cookie value is forged", async () => {
    const userId = await getCustomerUserIdFromRequest({
      cookies: { get: () => ({ value: "forged-cookie" }) },
    } as never);
    expect(userId).toBeNull();
  });
});

describe("resolveCustomerUserIdFromRequest (jose + Supabase fallback)", () => {
  it("falls back through to JWT cookie when Supabase env is absent", async () => {
    // No SUPABASE env vars set in test, so only JWT path can succeed.
    const token = await signCustomerToken({
      userId: "user-fb",
      phone: "+966500000000",
    });
    const userId = await resolveCustomerUserIdFromRequest({
      cookies: {
        get: (name: string) =>
          name === "customer_session" ? { value: token } : undefined,
        getAll: () => [],
      },
    } as never);
    expect(userId).toBe("user-fb");
  });

  it("returns null when JWT cookie is missing AND Supabase env is absent", async () => {
    const userId = await resolveCustomerUserIdFromRequest({
      cookies: {
        get: () => undefined,
        getAll: () => [],
      },
    } as never);
    expect(userId).toBeNull();
  });
});

describe("getGuestSessionIdFromRequest", () => {
  it("returns the x-session-id header when present", () => {
    const out = getGuestSessionIdFromRequest({
      headers: { get: (k: string) => (k === "x-session-id" ? "guest-1" : null) },
      cookies: { get: () => undefined },
    } as never);
    expect(out).toBe("guest-1");
  });

  it("falls back to the session_id cookie when no header", () => {
    const out = getGuestSessionIdFromRequest({
      headers: { get: () => null },
      cookies: {
        get: (k: string) =>
          k === "session_id" ? { value: "guest-2" } : undefined,
      },
    } as never);
    expect(out).toBe("guest-2");
  });

  it("prefers the header over the cookie", () => {
    const out = getGuestSessionIdFromRequest({
      headers: {
        get: (k: string) => (k === "x-session-id" ? "from-header" : null),
      },
      cookies: {
        get: () => ({ value: "from-cookie" }),
      },
    } as never);
    expect(out).toBe("from-header");
  });

  it("returns null when neither header nor cookie is set", () => {
    const out = getGuestSessionIdFromRequest({
      headers: { get: () => null },
      cookies: { get: () => undefined },
    } as never);
    expect(out).toBeNull();
  });
});

describe("customerSessionCookieOptions", () => {
  it("uses the documented cookie attributes (14-day TTL, RBAC-H fix)", () => {
    expect(customerSessionCookieOptions()).toEqual({
      httpOnly: true,
      secure: false, // NODE_ENV=development in test env
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 14,
      path: "/",
    });
  });
});

// ---------------------------------------------------------------------------
// Regression tests for the C-2 fix: customer JWTs MUST carry iss/aud claims
// matching the customer issuer/audience so a token signed with the admin or
// vendor secret can never be accepted on a customer route.
// ---------------------------------------------------------------------------

import { decodeJwt } from "jose";

describe("customer JWT iss/aud claims (C-2 regression)", () => {
  it("issues customer tokens with iss=citymarket-customer and aud=citymarket-customer-api", async () => {
    const token = await signCustomerToken({
      userId: "user-iss",
      phone: "+966500000000",
    });
    const claims = decodeJwt(token);
    expect(claims.iss).toBe("citymarket-customer");
    expect(claims.aud).toBe("citymarket-customer-api");
  });

  it("customer tokens set sub to the userId", async () => {
    const token = await signCustomerToken({
      userId: "user-sub-claim",
      phone: "+966500000000",
    });
    const claims = decodeJwt(token);
    expect(claims.sub).toBe("user-sub-claim");
  });

  it("rejects a token that lacks iss/aud (defense-in-depth)", async () => {
    // A token minted with the same secret but no iss/aud would otherwise be
    // indistinguishable from a vendor/admin token. The C-2 fix makes the
    // verify path require both claims, so it must be rejected.
    const token = signClaimlessToken({ userId: "u", phone: "+966500000000" });
    const claims = decodeJwt(token);
    expect(claims.iss).toBeUndefined();
    expect(claims.aud).toBeUndefined();
    expect(await verifyCustomerToken(token)).toBeNull();
  });

  it("rejects a token carrying the vendor issuer", async () => {
    const { SignJWT } = await import("jose");
    const vendorIssued = await new SignJWT({
      userId: "u",
      phone: "+966500000000",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u")
      .setIssuedAt()
      .setIssuer("citymarket-vendor")
      .setAudience("citymarket-customer-api")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    expect(await verifyCustomerToken(vendorIssued)).toBeNull();
  });

  it("verifyCustomerToken requires iss/aud to match", async () => {
    // Build a token with the wrong audience by signing via jose directly.
    const { SignJWT } = await import("jose");
    const wrongAud = await new SignJWT({ userId: "u", phone: "+966500000000" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u")
      .setIssuedAt()
      .setIssuer("citymarket-customer")
      .setAudience("citymarket-ADMIN-api") // wrong audience
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    expect(await verifyCustomerToken(wrongAud)).toBeNull();
  });
});
