import { describe, it, expect } from "vitest";
import { stripPublicPrefix, validateExternalUrl } from "./banner-link-utils";

describe("stripPublicPrefix", () => {
  it("removes leading /categories/ prefix", () => {
    expect(stripPublicPrefix("/categories/الخضروات-والفواكه")).toBe(
      "الخضروات-والفواكه"
    );
  });

  it("removes leading /products/ prefix", () => {
    expect(stripPublicPrefix("/products/123")).toBe("123");
  });

  it("removes leading /vendors/ prefix", () => {
    expect(stripPublicPrefix("/vendors/my-store")).toBe("my-store");
  });

  it("returns unchanged if no prefix matches", () => {
    expect(stripPublicPrefix("الخضروات-والفواكه")).toBe("الخضروات-والفواكه");
  });

  it("trims whitespace", () => {
    expect(stripPublicPrefix("  /categories/slug  ")).toBe("slug");
  });

  it("does not strip prefix from external URLs", () => {
    const url = "https://example.com/products/1";
    expect(stripPublicPrefix(url)).toBe(url);
  });

  it("does not strip /products/ from the middle of a string", () => {
    const url = "https://example.com/api/products/123";
    expect(stripPublicPrefix(url)).toBe(url);
  });

  it("handles empty strings", () => {
    expect(stripPublicPrefix("")).toBe("");
  });

  it("handles just the prefix with no slug", () => {
    expect(stripPublicPrefix("/categories/")).toBe("");
  });
});

describe("validateExternalUrl", () => {
  it("accepts http:// URLs", () => {
    const result = validateExternalUrl("http://example.com");
    expect(result).toBe("http://example.com/");
  });

  it("accepts https:// URLs", () => {
    const result = validateExternalUrl("https://example.com/path?query=1");
    expect(result).toBe("https://example.com/path?query=1");
  });

  it("rejects relative paths", () => {
    expect(validateExternalUrl("/categories/slug")).toBeNull();
  });

  it("rejects javascript: URIs", () => {
    expect(validateExternalUrl("javascript:alert('xss')")).toBeNull();
  });

  it("rejects data: URIs", () => {
    expect(validateExternalUrl("data:text/html,<h1>xss</h1>")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(validateExternalUrl("not a url at all")).toBeNull();
  });

  it("accepts URLs with surrounding whitespace (auto-trimmed by URL constructor)", () => {
    // JavaScript's URL constructor auto-trims whitespace, so this is valid
    const result = validateExternalUrl(" https://example.com");
    expect(result).toBe("https://example.com/");
  });

  it("returns null for empty string", () => {
    expect(validateExternalUrl("")).toBeNull();
  });
});
