import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

type EnvModule = typeof import("./env");

async function loadFresh(): Promise<EnvModule> {
  vi.resetModules();
  return (await import("./env")) as EnvModule;
}

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("getCustomerJwtSecret (C-1 cross-issuer isolation)", () => {
  it("returns JWT_SECRET when set", async () => {
    process.env.JWT_SECRET = "real-customer-secret-32-chars-xxxxxxxx";
    const { getCustomerJwtSecret, getCustomerJwtSecretBytes } = await loadFresh();
    expect(getCustomerJwtSecret()).toBe("real-customer-secret-32-chars-xxxxxxxx");
    expect(new TextDecoder().decode(getCustomerJwtSecretBytes())).toBe(
      "real-customer-secret-32-chars-xxxxxxxx",
    );
  });

  it("returns the dev fallback in non-production when JWT_SECRET is missing", async () => {
    delete process.env.JWT_SECRET;
    delete (process.env as any).NODE_ENV;
    const { getCustomerJwtSecret } = await loadFresh();
    expect(getCustomerJwtSecret()).toMatch(/dev-jwt-secret/);
  });

  it("throws in production when JWT_SECRET is missing", async () => {
    delete process.env.JWT_SECRET;
    (process.env as any).NODE_ENV = "production";
    const { getCustomerJwtSecret } = await loadFresh();
    expect(() => getCustomerJwtSecret()).toThrow(/JWT_SECRET/);
  });

  it("returns empty bytes when JWT_SECRET is set to an empty string (falls back)", async () => {
    process.env.JWT_SECRET = "";
    delete (process.env as any).NODE_ENV;
    const { getCustomerJwtSecret } = await loadFresh();
    // Empty env var → dev fallback
    expect(getCustomerJwtSecret().length).toBeGreaterThan(0);
  });
});

describe("isCookieSecure", () => {
  it("returns true in production", async () => {
    (process.env as any).NODE_ENV = "production";
    const { isCookieSecure } = await loadFresh();
    expect(isCookieSecure()).toBe(true);
  });

  it("returns false in development", async () => {
    delete (process.env as any).NODE_ENV;
    const { isCookieSecure } = await loadFresh();
    expect(isCookieSecure()).toBe(false);
  });

  it("returns false in test env", async () => {
    (process.env as any).NODE_ENV = "test";
    const { isCookieSecure } = await loadFresh();
    expect(isCookieSecure()).toBe(false);
  });
});

describe("isLegacyPhoneOtpAllowed", () => {
  it("returns true in development (regardless of ALLOW_LEGACY_PHONE_OTP)", async () => {
    delete (process.env as any).NODE_ENV;
    delete process.env.ALLOW_LEGACY_PHONE_OTP;
    const { isLegacyPhoneOtpAllowed } = await loadFresh();
    expect(isLegacyPhoneOtpAllowed()).toBe(true);
  });

  it("returns true in development even if ALLOW_LEGACY_PHONE_OTP is false", async () => {
    delete (process.env as any).NODE_ENV;
    process.env.ALLOW_LEGACY_PHONE_OTP = "false";
    const { isLegacyPhoneOtpAllowed } = await loadFresh();
    expect(isLegacyPhoneOtpAllowed()).toBe(true);
  });

  it("returns false in production by default", async () => {
    (process.env as any).NODE_ENV = "production";
    delete process.env.ALLOW_LEGACY_PHONE_OTP;
    const { isLegacyPhoneOtpAllowed } = await loadFresh();
    expect(isLegacyPhoneOtpAllowed()).toBe(false);
  });

  it("returns true in production when ALLOW_LEGACY_PHONE_OTP=true", async () => {
    (process.env as any).NODE_ENV = "production";
    process.env.ALLOW_LEGACY_PHONE_OTP = "true";
    const { isLegacyPhoneOtpAllowed } = await loadFresh();
    expect(isLegacyPhoneOtpAllowed()).toBe(true);
  });

  it("returns false in production when ALLOW_LEGACY_PHONE_OTP has any other value", async () => {
    (process.env as any).NODE_ENV = "production";
    process.env.ALLOW_LEGACY_PHONE_OTP = "yes";
    const { isLegacyPhoneOtpAllowed } = await loadFresh();
    expect(isLegacyPhoneOtpAllowed()).toBe(false);
  });
});

describe("getDatabaseConfig", () => {
  it("returns defaults when no env vars are set", async () => {
    delete process.env.DATABASE_HOST;
    delete process.env.DATABASE_PORT;
    delete process.env.DATABASE_NAME;
    delete process.env.DATABASE_USER;
    delete process.env.DATABASE_PASSWORD;
    delete (process.env as any).NODE_ENV;
    const { getDatabaseConfig } = await loadFresh();
    const cfg = getDatabaseConfig();
    expect(cfg.host).toBe("localhost");
    expect(cfg.port).toBe(5432);
    expect(cfg.database).toBe("citymarket_db");
    expect(cfg.user).toBe("citymarket_user");
    expect(typeof cfg.password).toBe("string");
    expect(cfg.password!.length).toBeGreaterThan(0);
    expect(cfg.max).toBe(20);
    expect(cfg.idleTimeoutMillis).toBe(30000);
    expect(cfg.connectionTimeoutMillis).toBe(5000);
  });

  it("uses DATABASE_PORT as a number (parses strings)", async () => {
    process.env.DATABASE_PORT = "6543";
    const { getDatabaseConfig } = await loadFresh();
    expect(getDatabaseConfig().port).toBe(6543);
  });

  it("returns NaN for non-numeric DATABASE_PORT (parseInt quirk — caller guards)", async () => {
    process.env.DATABASE_PORT = "not-a-port";
    const { getDatabaseConfig } = await loadFresh();
    // parseInt("not-a-port", 10) returns NaN; the implementation does not
    // validate. Document the current behavior so any future tightening
    // is intentional.
    expect(Number.isNaN(getDatabaseConfig().port)).toBe(true);
  });

  it("uses DATABASE_HOST / DATABASE_NAME / DATABASE_USER from env", async () => {
    process.env.DATABASE_HOST = "db.example.com";
    process.env.DATABASE_NAME = "prod_db";
    process.env.DATABASE_USER = "prod_user";
    const { getDatabaseConfig } = await loadFresh();
    const cfg = getDatabaseConfig();
    expect(cfg.host).toBe("db.example.com");
    expect(cfg.database).toBe("prod_db");
    expect(cfg.user).toBe("prod_user");
  });

  it("uses DATABASE_PASSWORD in production (no dev fallback)", async () => {
    (process.env as any).NODE_ENV = "production";
    process.env.DATABASE_PASSWORD = "real-password";
    const { getDatabaseConfig } = await loadFresh();
    expect(getDatabaseConfig().password).toBe("real-password");
  });

  it("password is undefined in production when DATABASE_PASSWORD is missing", async () => {
    (process.env as any).NODE_ENV = "production";
    delete process.env.DATABASE_PASSWORD;
    const { getDatabaseConfig } = await loadFresh();
    expect(getDatabaseConfig().password).toBeUndefined();
  });
});