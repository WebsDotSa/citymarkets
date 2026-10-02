/**
 * Tests for GET /api/v1/categories/[id] (PCP-121).
 *
 * Before this route existed, a request like /api/v1/categories/bad-uuid
 * fell through to Next.js's HTML 404 page — breaking the API contract
 * (every other /api/v1/<resource>/[id] returns a JSON error envelope).
 *
 * These tests lock down the JSON contract:
 *   • Bad UUID → 400
 *   • Unknown UUID → 404
 *   • Known active UUID → 200 with category
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { GET } from "./route";
import { query } from "@/lib/db";

const KNOWN_CATEGORY = {
  id: "11111111-1111-1111-1111-111111111111",
  name_ar: "خضار وفواكه",
  name_en: "Fruits & Vegetables",
  slug: "fruits-vegetables",
  parent_id: null,
  sort_order: 1,
  is_active: true,
};

function makeRequest(idSegment: string) {
  return new Request(
    `http://localhost:3005/api/v1/categories/${idSegment}`,
  ) as unknown as import("next/server").NextRequest;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/v1/categories/[id] — PCP-121", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 JSON for a non-UUID id (was HTML 404 before)", async () => {
    const res = await GET(makeRequest("bad-uuid"), makeParams("bad-uuid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ success: false });
    // The body is JSON, not HTML
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns 404 JSON for an unknown UUID", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);
    const id = "22222222-2222-2222-2222-222222222222";
    const res = await GET(makeRequest(id), makeParams(id));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: expect.any(String) });
  });

  it("returns 200 JSON for a known active category", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [KNOWN_CATEGORY] } as never);
    const res = await GET(
      makeRequest(KNOWN_CATEGORY.id),
      makeParams(KNOWN_CATEGORY.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.category).toMatchObject({ id: KNOWN_CATEGORY.id });
  });
});
