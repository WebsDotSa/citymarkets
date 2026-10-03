import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// jose has an in-process HS256 implementation that we use to mint test
// tokens, mirroring what the SUT expects (alg=HS256, iss=citymarket-admin,
// aud=citymarket-admin-api, sub=admin id).
import { SignJWT } from "jose";

// Use the same dev fallback secret the SUT uses so tokens verify locally.
const SECRET = new TextEncoder().encode(
  "city-market-dev-admin-secret-min-32-characters-x",
);
const ISS = "citymarket-admin";
const AUD = "citymarket-admin-api";

async function mintToken(payload: {
  sub?: string;
  email?: string;
  role?: string;
  iss?: string;
  aud?: string;
  exp?: number;
}): Promise<string> {
  let jwt = new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub ?? "admin-1")
    .setIssuedAt()
    .setIssuer(payload.iss ?? ISS)
    .setAudience(payload.aud ?? AUD);
  if (payload.exp !== undefined) {
    jwt = jwt.setExpirationTime(payload.exp);
  } else {
    jwt = jwt.setExpirationTime("7d");
  }
  return jwt.sign(SECRET);
}

function fakeRequest(cookieValue?: string): NextRequest {
  const headers = new Headers();
  return {
    cookies: {
      get: (name: string) =>
        cookieValue !== undefined
          ? { name, value: cookieValue }
          : undefined,
    },
    headers,
  } as unknown as NextRequest;
}

describe("admin-session", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("verifyAdminRequest", () => {
    it("returns null when no admin cookie is present", async () => {
      const { verifyAdminRequest } = await import("./admin-session");
      const out = await verifyAdminRequest(fakeRequest());
      expect(out).toBeNull();
    });

    it("returns the verified admin when the cookie is a valid JWT", async () => {
      const { verifyAdminRequest } = await import("./admin-session");
      const token = await mintToken({
        sub: "admin-1",
        email: "a@example.com",
        role: "admin",
      });
      const out = await verifyAdminRequest(fakeRequest(token));
      expect(out).toEqual({
        id: "admin-1",
        email: "a@example.com",
        role: "admin",
        // SECURITY (PCP-144): the verifier always populates
        // `tokenVersion` on the returned object (defaults to 1 for
        // legacy tokens that do not carry the claim).
        tokenVersion: 1,
      });
    });

    it("returns null when the token has the wrong issuer", async () => {
      const { verifyAdminRequest } = await import("./admin-session");
      const token = await mintToken({
        sub: "admin-1",
        email: "a@x",
        role: "admin",
        iss: "evil-issuer",
      });
      const out = await verifyAdminRequest(fakeRequest(token));
      expect(out).toBeNull();
    });

    it("returns null when the token has the wrong audience", async () => {
      const { verifyAdminRequest } = await import("./admin-session");
      const token = await mintToken({
        sub: "admin-1",
        email: "a@x",
        role: "admin",
        aud: "wrong-aud",
      });
      const out = await verifyAdminRequest(fakeRequest(token));
      expect(out).toBeNull();
    });

    it("returns null when the token is expired", async () => {
      const { verifyAdminRequest } = await import("./admin-session");
      const token = await mintToken({
        sub: "admin-1",
        email: "a@x",
        role: "admin",
        // epoch seconds, already in the past
        exp: Math.floor(Date.now() / 1000) - 60,
      });
      const out = await verifyAdminRequest(fakeRequest(token));
      expect(out).toBeNull();
    });

    it("returns null when the token signature is invalid", async () => {
      const { verifyAdminRequest } = await import("./admin-session");
      const token = await mintToken({
        sub: "admin-1",
        email: "a@x",
        role: "admin",
      });
      // Tamper with the signature portion (last segment).
      const parts = token.split(".");
      const tampered = `${parts[0]}.${parts[1]}.AAAAinvalidAAAA`;
      const out = await verifyAdminRequest(fakeRequest(tampered));
      expect(out).toBeNull();
    });

    it("returns null when the token payload is missing sub or role", async () => {
      const { verifyAdminRequest } = await import("./admin-session");
      // Mint with empty sub
      const token = await mintToken({
        sub: "",
        email: "a@x",
        role: "admin",
      });
      const out = await verifyAdminRequest(fakeRequest(token));
      expect(out).toBeNull();
    });
  });

  describe("signAdminSessionToken", () => {
    it("produces a token that verifyAdminRequest accepts", async () => {
      const { signAdminSessionToken, verifyAdminRequest } = await import(
        "./admin-session"
      );
      const token = await signAdminSessionToken({
        id: "admin-9",
        email: "nine@example.com",
        role: "editor",
      });
      const out = await verifyAdminRequest(fakeRequest(token));
      expect(out).toEqual({
        id: "admin-9",
        email: "nine@example.com",
        role: "editor",
        // SECURITY (PCP-144): the signer's `tokenVersion` default is
        // 1, so a token minted without an explicit version verifies
        // back with `tokenVersion: 1`. The DB compare in
        // `requireAdminApi` still works because the live row's
        // `token_version` is also 1 until a bump happens.
        tokenVersion: 1,
      });
    });

    it("uses HS256 algorithm and 7-day expiration", async () => {
      const { signAdminSessionToken } = await import("./admin-session");
      const token = await signAdminSessionToken({
        id: "admin-9",
        email: "nine@example.com",
        role: "admin",
      });
      const header = JSON.parse(atob(token.split(".")[0]));
      expect(header.alg).toBe("HS256");
      const payload = JSON.parse(atob(token.split(".")[1]));
      const lifetime = payload.exp - payload.iat;
      expect(lifetime).toBe(7 * 24 * 60 * 60);
    });

    it("sets the correct issuer and audience", async () => {
      const { signAdminSessionToken, verifyAdminRequest } = await import(
        "./admin-session"
      );
      const token = await signAdminSessionToken({
        id: "a",
        email: "a@x",
        role: "admin",
      });
      const out = await verifyAdminRequest(fakeRequest(token));
      // If the iss/aud were wrong, verify would have returned null
      expect(out).not.toBeNull();
      expect(out?.id).toBe("a");
    });
  });

  describe("adminSessionCookieOptions", () => {
    it("sets httpOnly, strict sameSite, 7-day maxAge, path=/", async () => {
      const { adminSessionCookieOptions } = await import("./admin-session");
      const opts = adminSessionCookieOptions();
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe("strict");
      expect(opts.path).toBe("/");
      expect(opts.maxAge).toBe(60 * 60 * 24 * 7);
    });

    it("secure is true in production", async () => {
      vi.resetModules();
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      const { adminSessionCookieOptions } = await import("./admin-session");
      expect(adminSessionCookieOptions().secure).toBe(true);
      delete (process.env as Record<string, string | undefined>).NODE_ENV;
    });

    it("secure is false in development", async () => {
      vi.resetModules();
      delete (process.env as Record<string, string | undefined>).NODE_ENV;
      const { adminSessionCookieOptions } = await import("./admin-session");
      expect(adminSessionCookieOptions().secure).toBe(false);
    });
  });

  it("re-exports ADMIN_SESSION_COOKIE", async () => {
    const mod = await import("./admin-session");
    expect(mod.ADMIN_SESSION_COOKIE).toBe("admin_session");
  });
});