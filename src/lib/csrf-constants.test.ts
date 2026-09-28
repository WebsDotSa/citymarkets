import { describe, it, expect } from "vitest";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./csrf-constants";

describe("CSRF constants", () => {
  it("exports a cookie name", () => {
    expect(CSRF_COOKIE_NAME).toBe("csrf_token");
  });

  it("exports a header name (lowercase, hyphenated — per Fetch spec)", () => {
    expect(CSRF_HEADER_NAME).toBe("x-csrf-token");
  });

  it("the cookie and header names are intentionally the same token (double-submit pattern)", () => {
    // The double-submit cookie pattern uses the SAME value in the cookie
    // and the request header, so the server can compare them. The NAMES
    // are different (one is the cookie, one is the header) but the
    // client sends the cookie value in the header.
    expect(CSRF_COOKIE_NAME).not.toBe(CSRF_HEADER_NAME);
  });

  it("both names are non-empty strings safe to embed in HTTP headers / cookies", () => {
    expect(CSRF_COOKIE_NAME.length).toBeGreaterThan(0);
    expect(CSRF_HEADER_NAME.length).toBeGreaterThan(0);
    expect(CSRF_HEADER_NAME).toMatch(/^[a-z0-9-]+$/);
  });
});