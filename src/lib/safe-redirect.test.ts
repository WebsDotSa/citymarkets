import { describe, expect, it } from "vitest";
import { sanitizeRedirectPath, DEFAULT_REDIRECT } from "./safe-redirect";

describe("sanitizeRedirectPath", () => {
  it("accepts a plain same-origin path", () => {
    expect(sanitizeRedirectPath("/orders")).toBe("/orders");
  });

  it("accepts a path with query string", () => {
    expect(sanitizeRedirectPath("/checkout?x=1")).toBe("/checkout?x=1");
  });

  it("falls back to the default for null/empty", () => {
    expect(sanitizeRedirectPath(null)).toBe(DEFAULT_REDIRECT);
    expect(sanitizeRedirectPath(undefined)).toBe(DEFAULT_REDIRECT);
    expect(sanitizeRedirectPath("")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects absolute URLs (open redirect)", () => {
    expect(sanitizeRedirectPath("https://evil.com")).toBe(DEFAULT_REDIRECT);
    expect(sanitizeRedirectPath("http://evil.com")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects protocol-relative URLs", () => {
    expect(sanitizeRedirectPath("//evil.com")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects backslash tricks", () => {
    expect(sanitizeRedirectPath("/\\evil.com")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects /auth/* (login loop prevention)", () => {
    expect(sanitizeRedirectPath("/auth/login")).toBe(DEFAULT_REDIRECT);
    expect(sanitizeRedirectPath("/auth/register")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects non-path strings", () => {
    expect(sanitizeRedirectPath("orders")).toBe(DEFAULT_REDIRECT);
    expect(sanitizeRedirectPath("javascript:alert(1)")).toBe(
      DEFAULT_REDIRECT
    );
  });

  it("uses a custom fallback when supplied", () => {
    expect(sanitizeRedirectPath(null, "/home")).toBe("/home");
    expect(sanitizeRedirectPath("https://evil.com", "/home")).toBe("/home");
  });
});
