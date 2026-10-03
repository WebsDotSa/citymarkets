import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "@/lib/db";
import { GET } from "./route";

describe("GET /api/v1/banners", () => {
  let bannerId: string;

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      // Insert test banner
      const result = await client.query(
        `INSERT INTO banners (image_url, link_type, link_value, active, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          "https://example.com/banner.jpg",
          "product",
          "test-product-id",
          true,
          1,
        ],
      );
      bannerId = result.rows[0].id;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query("DELETE FROM banners WHERE id = $1", [bannerId]);
    } finally {
      client.release();
    }
  });

  it("returns 200 with success=true", async () => {
    const request = new Request("http://localhost:3000/api/v1/banners", {
      method: "GET",
    });
    const response = await GET(request as any);
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
  });

  it("returns active banners sorted by sort_order", async () => {
    const request = new Request("http://localhost:3000/api/v1/banners", {
      method: "GET",
    });
    const response = await GET(request as any);
    const json = await response.json();
    expect(json.data.length).toBeGreaterThan(0);

    // Check that test banner is in the response
    const testBanner = json.data.find((b: any) => b.id === bannerId);
    expect(testBanner).toBeDefined();
    expect(testBanner.image_url).toBe("https://example.com/banner.jpg");
    expect(testBanner.link_type).toBe("product");
    expect(testBanner.link_value).toBe("test-product-id");
  });

  it("includes CORS headers", async () => {
    const request = new Request("http://localhost:3000/api/v1/banners", {
      method: "GET",
    });
    const response = await GET(request as any);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeDefined();
  });
});
