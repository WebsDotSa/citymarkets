import { describe, it, expect } from "vitest";
import {
  CUSTOMER_SESSION_COOKIE,
  VENDOR_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE,
} from "./auth-cookie-name";

describe("session cookie name constants", () => {
  it("exports a customer session cookie name", () => {
    expect(CUSTOMER_SESSION_COOKIE).toBe("customer_session");
  });

  it("exports a vendor session cookie name", () => {
    expect(VENDOR_SESSION_COOKIE).toBe("vendor_session");
  });

  it("exports an admin session cookie name", () => {
    expect(ADMIN_SESSION_COOKIE).toBe("admin_session");
  });

  it("the three cookie names are distinct (sessions must not collide)", () => {
    expect(CUSTOMER_SESSION_COOKIE).not.toBe(VENDOR_SESSION_COOKIE);
    expect(CUSTOMER_SESSION_COOKIE).not.toBe(ADMIN_SESSION_COOKIE);
    expect(VENDOR_SESSION_COOKIE).not.toBe(ADMIN_SESSION_COOKIE);
  });

  it("all names are non-empty strings safe for use in `Set-Cookie`", () => {
    for (const name of [
      CUSTOMER_SESSION_COOKIE,
      VENDOR_SESSION_COOKIE,
      ADMIN_SESSION_COOKIE,
    ]) {
      expect(name.length).toBeGreaterThan(0);
      expect(name).toMatch(/^[a-z0-9_]+$/);
    }
  });
});