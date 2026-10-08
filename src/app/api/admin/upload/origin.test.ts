import { describe, it, expect } from "vitest";
import { buildLocalImageUrl } from "./route";

/**
 * PCP-123 — origin derivation for the local-fallback image URL.
 *
 * The attack: an attacker can set `x-forwarded-origin: https://evil.com`
 * (and the `origin` header on the same fetch) when uploading. If we trust
 * those, the returned image_url is stored in the DB pointing at the
 * attacker's server, not ours. The image_url is then rendered in admin UI
 * (and copied into R2-mirrored URLs) — so a single poisoned origin poisons
 * the whole product/category/banner graph.
 *
 * The fix: derive the origin from `request.url` only. The server only
 * knows its own bound URL — not whatever the client claims.
 */
describe("buildLocalImageUrl (PCP-123)", () => {
  it("uses the request URL origin, ignoring x-forwarded-origin", () => {
    const req = new Request("http://localhost:3005/api/admin/upload", {
      headers: { "x-forwarded-origin": "https://evil.example.com" },
    });
    const url = buildLocalImageUrl(req, "/images/products/123.jpg");
    expect(url).toBe("http://localhost:3005/images/products/123.jpg");
  });

  it("ignores the origin header (also attacker-controlled)", () => {
    const req = new Request("http://localhost:3005/api/admin/upload", {
      headers: { origin: "https://attacker.example" },
    });
    const url = buildLocalImageUrl(req, "/images/products/x.png");
    expect(url).toBe("http://localhost:3005/images/products/x.png");
  });

  it("strips trailing slash from origin to avoid double-slash in URL", () => {
    const req = new Request("http://localhost:3005/api/admin/upload");
    const url = buildLocalImageUrl(req, "/images/banners/y.webp");
    expect(url).toBe("http://localhost:3005/images/banners/y.webp");
  });

  it("preserves HTTPS when bound URL is HTTPS", () => {
    const req = new Request("https://citymarkets.sa/api/admin/upload", {
      headers: { "x-forwarded-origin": "http://evil.example.com" },
    });
    const url = buildLocalImageUrl(req, "/images/products/secure.jpg");
    expect(url.startsWith("https://citymarkets.sa/")).toBe(true);
    expect(url).not.toContain("evil.example.com");
  });
});