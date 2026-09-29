import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for GET /api/v1/addresses.
 *
 * The route requires an authenticated customer (401 otherwise). The
 * `url-guard.test.ts` file in this folder already pins the
 * `isValidPlaceImageUrl` allowlist, so we only cover the route entry
 * points here to avoid double-counting coverage.
 */

type QueryCall = { sql: string; params: unknown[] };

const calls: QueryCall[] = [];

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if ((query as any).mockRows) return { rows: (query as any).mockRows };
    return { rows: [] };
  }),
}));

vi.mock('@/lib/identity', () => ({
  resolveCustomerUserIdFromRequest: vi.fn(),
  getGuestSessionIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { query } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { GET, POST } from "./route";
import type { NextRequest } from "next/server";

function mockRequest(
  url = "http://localhost/api/v1/addresses",
  body?: unknown
): NextRequest {
  return {
    headers: { get: () => null },
    url,
    json: async () => body,
  } as unknown as NextRequest;
}

describe("GET /api/v1/addresses — auth + response shape (regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    (query as any).mockRows = null;
  });

  it("returns 401 when no customer user is resolved", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue(null);

    const res = await GET(mockRequest() as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("غير مصرح");
  });

  it("returns an empty data array for an authenticated user with no addresses", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    (query as any).mockRows = [];

    const res = await GET(mockRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("returns the populated address list for an authenticated user", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    (query as any).mockRows = [
      {
        id: "addr-1",
        label: "Home",
        description: "Home address",
        title: "Home",
        lat: 24.7136,
        lng: 46.6753,
        address_text: "King Fahd Rd",
        is_default: true,
        place_images: [],
        created_at: new Date().toISOString(),
      },
    ];

    const res = await GET(mockRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].label).toBe("Home");
    expect(body.data[0].is_default).toBe(true);

    // The addresses query must filter on user_id.
    const filteredByUser = calls.some(
      (c) => c.sql.toUpperCase().includes("FROM ADDRESSES") && c.params[0] === "user-1"
    );
    expect(filteredByUser).toBe(true);
  });
});

describe("POST /api/v1/addresses — iOS-friendly response shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    (query as any).mockRows = null;
  });

  it("returns 401 when no customer user is resolved", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue(null);

    const res = await POST(
      mockRequest("http://localhost/api/v1/addresses", {
        label: "Home",
        lat: 24.7,
        lng: 46.6,
      }) as never
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when required fields are missing", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");

    const res = await POST(
      mockRequest("http://localhost/api/v1/addresses", { label: "Home" }) as never
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("returns the iOS-friendly address aliases on success", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    (query as any).mockRows = [
      {
        id: "addr-1",
        label: "Home",
        description: "المنزل",
        title: "المنزل",
        lat: 24.7,
        lng: 46.6,
        address_text: "King Fahd Rd",
        is_default: true,
        place_images: [],
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];

    const res = await POST(
      mockRequest("http://localhost/api/v1/addresses", {
        label: "Home",
        lat: 24.7,
        lng: 46.6,
        address_text: "King Fahd Rd",
        description: "المنزل",
        is_default: true,
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // Web still gets the original shape.
    expect(body.success).toBe(true);
    expect(body.data?.id).toBe("addr-1");

    // iOS object form.
    expect(body.address?.id).toBe("addr-1");
    expect(body.address?.addressText).toBe("King Fahd Rd");
    expect(body.address?.title).toBe("المنزل");
    expect(body.deliveryAddress?.id).toBe("addr-1");
    expect(body.customerAddress?.id).toBe("addr-1");

    // iOS scalar id forms.
    expect(body.addressId).toBe("addr-1");
    expect(body.address_id).toBe("addr-1");
    expect(body.deliveryAddressId).toBe("addr-1");
  });

  it("uses the explicit `title` when provided", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    (query as any).mockRows = [
      {
        id: "addr-2",
        label: "Work",
        description: "مكتب الطابق الثالث",
        title: "العمل",
        lat: 24.7,
        lng: 46.6,
        address_text: "Olaya St",
        is_default: false,
        place_images: [],
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];

    const res = await POST(
      mockRequest("http://localhost/api/v1/addresses", {
        label: "Work",
        title: "العمل",
        description: "مكتب الطابق الثالث",
        lat: 24.7,
        lng: 46.6,
        address_text: "Olaya St",
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address.title).toBe("العمل");
    expect(body.address.description).toBe("مكتب الطابق الثالث");
  });

  it("returns 400 when neither title, description, nor label resolve", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");

    const res = await POST(
      mockRequest("http://localhost/api/v1/addresses", {
        label: "",
        lat: 24.7,
        lng: 46.6,
      }) as never
    );
    expect(res.status).toBe(400);
  });
});
