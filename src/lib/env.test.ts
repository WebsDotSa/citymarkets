import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

/**
 * C-1 regression: admin and vendor JWTs must be signed with secrets
 * independent from the customer JWT_SECRET. A stolen customer token
 * must NEVER verify on an admin or vendor route, even if the attacker
 * also learns JWT_SECRET.
 */

const ADMIN_SECRET = "admin-secret-32-chars-aaaaaaaaaaaaaa";
const VENDOR_SECRET = "vendor-secret-32-chars-bbbbbbbbbbb";
const CUSTOMER_SECRET = "customer-secret-32-chars-ccccccccccc";

type EnvModule = typeof import("./env");

async function loadFresh(): Promise<EnvModule> {
  // vi.resetModules clears the module cache; the next dynamic import
  // re-evaluates env.ts with the current process.env values.
  vi.resetModules();
  return (await import("./env")) as EnvModule;
}

describe("getAdminJwtSecretBytes (C-1 cross-issuer isolation)", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("returns ADMIN_JWT_SECRET when set", async () => {
    (process.env as Record<string,string>).NODE_ENV = "production";
    process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    process.env.JWT_SECRET = CUSTOMER_SECRET;
    const { getAdminJwtSecretBytes } = await loadFresh();
    const bytes = getAdminJwtSecretBytes();
    expect(new TextDecoder().decode(bytes)).toBe(ADMIN_SECRET);
  });

  it("throws in production when ADMIN_JWT_SECRET is missing", async () => {
    (process.env as Record<string,string>).NODE_ENV = "production";
    delete process.env.ADMIN_JWT_SECRET;
    delete process.env.JWT_SECRET;
    const { getAdminJwtSecretBytes } = await loadFresh();
    expect(() => getAdminJwtSecretBytes()).toThrow(/ADMIN_JWT_SECRET/);
  });

  it("NEVER falls back to JWT_SECRET (the customer secret)", async () => {
    (process.env as Record<string,string>).NODE_ENV = "production";
    delete process.env.ADMIN_JWT_SECRET;
    process.env.JWT_SECRET = CUSTOMER_SECRET;
    const { getAdminJwtSecretBytes } = await loadFresh();
    // Even with JWT_SECRET present, admin must refuse rather than
    // silently use the customer secret.
    expect(() => getAdminJwtSecretBytes()).toThrow(/ADMIN_JWT_SECRET/);
  });
});

describe("getVendorJwtSecretBytes (C-1 cross-issuer isolation)", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("returns VENDOR_JWT_SECRET when set", async () => {
    (process.env as Record<string,string>).NODE_ENV = "production";
    process.env.VENDOR_JWT_SECRET = VENDOR_SECRET;
    process.env.JWT_SECRET = CUSTOMER_SECRET;
    const { getVendorJwtSecretBytes } = await loadFresh();
    expect(new TextDecoder().decode(getVendorJwtSecretBytes())).toBe(
      VENDOR_SECRET,
    );
  });

  it("throws in production when VENDOR_JWT_SECRET is missing", async () => {
    (process.env as Record<string,string>).NODE_ENV = "production";
    delete process.env.VENDOR_JWT_SECRET;
    process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    process.env.JWT_SECRET = CUSTOMER_SECRET;
    const { getVendorJwtSecretBytes } = await loadFresh();
    expect(() => getVendorJwtSecretBytes()).toThrow(/VENDOR_JWT_SECRET/);
  });

  it("NEVER falls back to ADMIN_JWT_SECRET or JWT_SECRET", async () => {
    (process.env as Record<string,string>).NODE_ENV = "production";
    delete process.env.VENDOR_JWT_SECRET;
    process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    process.env.JWT_SECRET = CUSTOMER_SECRET;
    const { getVendorJwtSecretBytes } = await loadFresh();
    expect(() => getVendorJwtSecretBytes()).toThrow(/VENDOR_JWT_SECRET/);
  });
});

describe("admin/vendor/customer secrets are pairwise distinct in production", () => {
  const original = { ...process.env };
  beforeEach(() => {
    (process.env as Record<string,string>).NODE_ENV = "production";
    process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    process.env.VENDOR_JWT_SECRET = VENDOR_SECRET;
    process.env.JWT_SECRET = CUSTOMER_SECRET;
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("all three issuers expose distinct bytes", async () => {
    const {
      getAdminJwtSecretBytes,
      getVendorJwtSecretBytes,
      getCustomerJwtSecretBytes,
    } = await loadFresh();
    const admin = new TextDecoder().decode(getAdminJwtSecretBytes());
    const vendor = new TextDecoder().decode(getVendorJwtSecretBytes());
    const customer = new TextDecoder().decode(getCustomerJwtSecretBytes());
    expect(admin).not.toBe(vendor);
    expect(admin).not.toBe(customer);
    expect(vendor).not.toBe(customer);
  });
});

/**
 * Regression: `isApnsConfigured` now uses the KEY_PATH shape
 * (KEY_ID + TEAM_ID + BUNDLE_ID + KEY_PATH) — the legacy
 * APNS_SIGNING_KEY form is no longer accepted. This pins the
 * standardization so a future contributor cannot silently
 * re-introduce the old shape.
 */
describe("isApnsConfigured (env shape standardization)", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  function clearApnsEnv() {
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_BUNDLE_ID;
    delete process.env.APNS_KEY_PATH;
    delete process.env.APNS_SIGNING_KEY;
  }

  it("returns false when no APNs env vars set", async () => {
    clearApnsEnv();
    const { isApnsConfigured } = await loadFresh();
    expect(isApnsConfigured()).toBe(false);
  });

  it("returns false when only legacy APNS_SIGNING_KEY is set", async () => {
    clearApnsEnv();
    process.env.APNS_SIGNING_KEY = "legacy";
    const { isApnsConfigured } = await loadFresh();
    expect(isApnsConfigured()).toBe(false);
  });

  it("returns false when only KEY_ID + TEAM_ID + BUNDLE_ID (missing KEY_PATH)", async () => {
    clearApnsEnv();
    process.env.APNS_KEY_ID = "k";
    process.env.APNS_TEAM_ID = "t";
    process.env.APNS_BUNDLE_ID = "b";
    const { isApnsConfigured } = await loadFresh();
    expect(isApnsConfigured()).toBe(false);
  });

  it("returns true when all four APNS_*_PATH/ID vars are set", async () => {
    clearApnsEnv();
    process.env.APNS_KEY_ID = "k";
    process.env.APNS_TEAM_ID = "t";
    process.env.APNS_BUNDLE_ID = "b";
    process.env.APNS_KEY_PATH = "/p";
    const { isApnsConfigured } = await loadFresh();
    expect(isApnsConfigured()).toBe(true);
  });
});

/**
 * P2-1 (security Phase 4, 2026-10-03): production safety guard for
 * the Apple review account. The bypass is a static OTP against a
 * known phone; in production it would be a free login for anyone
 * with the env. We now refuse to enable it in production unless
 * APPLE_ALLOW_PRODUCTION_REVIEW=1 is set explicitly.
 */
function setEnv(key: string, value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[key];
  else env[key] = value;
}

describe("isAppleReviewEnabled — production guard", () => {
  beforeEach(() => {
    setEnv("APPLE_REVIEW_ENABLED", undefined);
    setEnv("APPLE_ALLOW_PRODUCTION_REVIEW", undefined);
    setEnv("NODE_ENV", undefined);
  });

  afterEach(() => {
    setEnv("APPLE_REVIEW_ENABLED", undefined);
    setEnv("APPLE_ALLOW_PRODUCTION_REVIEW", undefined);
    setEnv("NODE_ENV", undefined);
  });

  it("returns false when APPLE_REVIEW_ENABLED is not 'true'", async () => {
    setEnv("APPLE_REVIEW_ENABLED", "false");
    setEnv("NODE_ENV", "production");
    const { isAppleReviewEnabled } = await loadFresh();
    expect(isAppleReviewEnabled()).toBe(false);
  });

  it("returns true in non-production when APPLE_REVIEW_ENABLED=true", async () => {
    setEnv("APPLE_REVIEW_ENABLED", "true");
    setEnv("NODE_ENV", "development");
    const { isAppleReviewEnabled } = await loadFresh();
    expect(isAppleReviewEnabled()).toBe(true);
  });

  it("returns false in production even when APPLE_REVIEW_ENABLED=true (no override)", async () => {
    setEnv("APPLE_REVIEW_ENABLED", "true");
    setEnv("NODE_ENV", "production");
    const { isAppleReviewEnabled } = await loadFresh();
    expect(isAppleReviewEnabled()).toBe(false);
  });

  it("returns true in production only when both flags are set", async () => {
    setEnv("APPLE_REVIEW_ENABLED", "true");
    setEnv("NODE_ENV", "production");
    setEnv("APPLE_ALLOW_PRODUCTION_REVIEW", "1");
    const { isAppleReviewEnabled } = await loadFresh();
    expect(isAppleReviewEnabled()).toBe(true);
  });

  it("does NOT enable when override is 'true' string (must be exactly '1')", async () => {
    setEnv("APPLE_REVIEW_ENABLED", "true");
    setEnv("NODE_ENV", "production");
    setEnv("APPLE_ALLOW_PRODUCTION_REVIEW", "true");
    const { isAppleReviewEnabled } = await loadFresh();
    expect(isAppleReviewEnabled()).toBe(false);
  });
});
