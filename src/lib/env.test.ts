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
