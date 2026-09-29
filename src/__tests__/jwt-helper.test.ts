import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { signJwt, verifyJwt, type SignConfig, type VerifyConfig } from '@/lib/identity';

const SECRET = new TextEncoder().encode("test-secret-min-32-characters-x");
const OTHER_SECRET = new TextEncoder().encode("a-different-secret-min-32-chars-y");

const signCfg: SignConfig = {
  issuer: "test-issuer",
  audience: "test-audience",
  secretBytes: SECRET,
  expirationTime: "1h",
};

const verifyCfg: VerifyConfig = {
  issuer: "test-issuer",
  audience: "test-audience",
  secretBytes: SECRET,
};

describe("signJwt / verifyJwt", () => {
  it("round-trips a payload with the standard claim set", async () => {
    const token = await signJwt({ userId: "u-1", role: "admin" }, "u-1", signCfg);
    const out = await verifyJwt<{ userId: string; role: string }>(token, verifyCfg);
    expect(out).not.toBeNull();
    expect(out?.sub).toBe("u-1");
    expect(out?.userId).toBe("u-1");
    expect(out?.role).toBe("admin");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signJwt({ x: 1 }, "sub", {
      ...signCfg,
      secretBytes: OTHER_SECRET,
    });
    const out = await verifyJwt(token, verifyCfg);
    expect(out).toBeNull();
  });

  it("rejects a token with a wrong issuer", async () => {
    const token = await signJwt({ x: 1 }, "sub", {
      ...signCfg,
      issuer: "wrong-issuer",
    });
    const out = await verifyJwt(token, verifyCfg);
    expect(out).toBeNull();
  });

  it("rejects a token with a wrong audience", async () => {
    const token = await signJwt({ x: 1 }, "sub", {
      ...signCfg,
      audience: "wrong-audience",
    });
    const out = await verifyJwt(token, verifyCfg);
    expect(out).toBeNull();
  });

  it("rejects a malformed token", async () => {
    const out = await verifyJwt("not-a-jwt", verifyCfg);
    expect(out).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await new SignJWT({ x: 1 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("sub")
      .setIssuedAt()
      .setIssuer("test-issuer")
      .setAudience("test-audience")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60) // 1 min ago
      .sign(SECRET);
    const out = await verifyJwt(token, verifyCfg);
    expect(out).toBeNull();
  });

  it("rejects an alg=none token (algorithm pinning)", async () => {
    // A naive "unsigned" token. The verifier must refuse it because
    // `algorithms: ["HS256"]` is pinned in the helper.
    const unsigned = btoa(JSON.stringify({ alg: "none", typ: "JWT" })) + "." +
      btoa(JSON.stringify({ sub: "sub", iss: "test-issuer", aud: "test-audience" })) + ".";
    const out = await verifyJwt(unsigned, verifyCfg);
    expect(out).toBeNull();
  });
});
