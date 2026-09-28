import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword", () => {
  it("produces a bcrypt hash (starts with $2a$ / $2b$ / $2y$)", async () => {
    const h = await hashPassword("hello-world");
    expect(h).toMatch(/^\$2[aby]\$/);
  });

  it("produces a different hash each time (salted)", async () => {
    const h1 = await hashPassword("same-password");
    const h2 = await hashPassword("same-password");
    expect(h1).not.toBe(h2);
  });

  it("produces a hash of the expected length (~60 chars)", async () => {
    const h = await hashPassword("any");
    expect(h.length).toBeGreaterThanOrEqual(59);
    expect(h.length).toBeLessThanOrEqual(60);
  });

  it("handles empty strings (bcrypt allows them)", async () => {
    const h = await hashPassword("");
    expect(h).toMatch(/^\$2[aby]\$/);
  });

  it("handles unicode strings (Arabic)", async () => {
    const h = await hashPassword("كلمة-سر-قوية-١٢٣");
    expect(h).toMatch(/^\$2[aby]\$/);
  });

  it("handles long passwords (bcrypt truncates at 72 bytes, but should not throw)", async () => {
    const longPwd = "a".repeat(120);
    const h = await hashPassword(longPwd);
    expect(h).toMatch(/^\$2[aby]\$/);
  });
});

describe("verifyPassword", () => {
  it("returns true for a correct password", async () => {
    const h = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("correct-horse-battery-staple", h)).toBe(true);
  });

  it("returns false for a wrong password", async () => {
    const h = await hashPassword("correct");
    expect(await verifyPassword("incorrect", h)).toBe(false);
  });

  it("returns false for an empty password against a non-empty hash", async () => {
    const h = await hashPassword("real-password");
    expect(await verifyPassword("", h)).toBe(false);
  });

  it("returns false for a malformed hash (does not throw)", async () => {
    expect(await verifyPassword("any", "not-a-bcrypt-hash")).toBe(false);
  });

  it("is case-sensitive", async () => {
    const h = await hashPassword("Password");
    expect(await verifyPassword("Password", h)).toBe(true);
    expect(await verifyPassword("password", h)).toBe(false);
    expect(await verifyPassword("PASSWORD", h)).toBe(false);
  });

  it("verifies Arabic passwords case-correctly", async () => {
    const h = await hashPassword("كلمة-سر");
    expect(await verifyPassword("كلمة-سر", h)).toBe(true);
    expect(await verifyPassword("كلمة-سر١", h)).toBe(false);
  });
});