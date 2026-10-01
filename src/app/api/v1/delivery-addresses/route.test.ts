import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for /api/v1/delivery-addresses (P2-3 migration).
 *
 * The route previously inlined four SQL handlers (GET / POST / PUT /
 * DELETE) and hand-rolled the title-fallback ladder in two places.
 * After P2-3 every handler delegates to the canonical address service.
 *
 * These tests pin the response-shape contract that the web client
 * (`src/contexts/delivery-location-context.tsx:rowToAddress`) and the
 * iOS client depend on — specifically:
 *   - GET returns `{ success: true, data: AddressRow[] }` with rows
 *     shaped like `{ ..., is_default, place_images: []|string[], ... }`
 *     and WITHOUT owner-identifying fields like `user_id` / `guest_key`.
 *   - POST returns `{ success: true, data: AddressRow }`.
 *   - PUT returns 404 on unknown id; otherwise `{ success: true, data }`.
 *   - DELETE returns `{ success: true }` even when rowCount=0 (the
 *     pre-P2-3 contract).
 *
 * The route file imports its place_images validator from
 * `@/lib/catalog`; we mock that to a passthrough so the tests don't
 * pin the allowlist logic (covered by `place-image.test.ts`).
 */

const calls: { sql: string; params: unknown[] }[] = [];

function makeFakeClient(opts?: { row?: Record<string, unknown> | null }) {
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const s = sql.trim().toUpperCase();
      if (s.startsWith("BEGIN") || s.startsWith("ROLLBACK") || s.startsWith("COMMIT")) {
        return { rows: [] };
      }
      if (opts?.row === null) return { rows: [], rowCount: 0 };
      if (opts?.row) return { rows: [opts.row], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return client;
}

vi.mock("@/lib/db", () => ({
  pool: {
    connect: vi.fn(async () => makeFakeClient()),
  },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return { rows: [], rowCount: 0 };
  }),
}));

vi.mock("@/lib/identity/customer-session", () => ({
  resolveCustomerUserIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/catalog", () => ({
  sanitizePlaceImageUrls: vi.fn((urls: unknown, cap: number) => {
    if (!Array.isArray(urls)) return [];
    return (urls as unknown[]).filter((u): u is string => typeof u === "string").slice(0, cap);
  }),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { pool, query } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from "@/lib/identity/customer-session";
import { GET, POST, PUT, DELETE } from "./route";
import type { NextRequest } from "next/server";

function mockRequest(url: string, body?: unknown): NextRequest {
  return {
    headers: { get: () => null },
    url,
    json: async () => body,
  } as unknown as NextRequest;
}

const BASE_URL = "http://localhost/api/v1/delivery-addresses";

describe("GET /api/v1/delivery-addresses — auth gate + response shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("returns 400 when neither user nor guest_key is present", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue(null);
    const req = {
      headers: { get: () => null },
      url: BASE_URL,
    } as unknown as NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("يجب تسجيل الدخول أو استخدام معرّف الضيف");
  });

  it("returns the addresses list with no owner-identifying fields (P2-3 shape)", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    // listAddressesService calls `query` (not pool.connect), so the
    // route rows come back via the top-level query mock.
    (query as unknown as { mockImplementationOnce: (fn: unknown) => void }).mockImplementationOnce(
      async () => ({
        rows: [
          {
            id: "addr-1",
            user_id: "user-1",
            guest_key: null,
            label: "Home",
            title: "المنزل",
            description: null,
            lat: 24.7,
            lng: 46.6,
            address_text: "King Fahd Rd",
            is_default: true,
            place_images: [],
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        rowCount: 1,
      }),
    );

    const res = await GET(mockRequest(BASE_URL));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);

    const row = body.data[0];
    // Owner-identifying fields must be stripped.
    expect(row).not.toHaveProperty("user_id");
    expect(row).not.toHaveProperty("guest_key");
    // Standard fields preserved.
    expect(row.label).toBe("Home");
    expect(row.is_default).toBe(true);
    expect(row.place_images).toEqual([]);
  });
});

describe("POST /api/v1/delivery-addresses — delegates to createAddressService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("returns 400 when label or address_text is missing", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    const res = await POST(mockRequest(BASE_URL, { label: "Home" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("التسمية والعنوان مطلوبان");
  });

  it("inserts via the service and returns the inserted row without owner fields", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");

    const fakeRow = {
      id: "addr-2",
      user_id: "user-1",
      guest_key: null,
      label: "Work",
      title: "العمل",
      description: null,
      lat: 24.7,
      lng: 46.6,
      address_text: "Olaya St",
      is_default: false,
      place_images: [],
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const client = makeFakeClient({ row: fakeRow });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);

    const res = await POST(
      mockRequest(BASE_URL, {
        label: "Work",
        address_text: "Olaya St",
        lat: 24.7,
        lng: 46.6,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.label).toBe("Work");
    expect(body.data).not.toHaveProperty("user_id");
    expect(body.data).not.toHaveProperty("guest_key");
  });

  it("supports guest callers via x-guest-key", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue(null);
    const guestReq = {
      headers: {
        get: (k: string) => (k === "x-guest-key" ? "guest-xyz" : null),
      },
      url: BASE_URL,
      json: async () => ({
        label: "Hotel",
        address_text: "Marriott",
        lat: 24.7,
        lng: 46.6,
      }),
    } as unknown as NextRequest;

    const fakeRow = {
      id: "addr-g",
      user_id: null,
      guest_key: "guest-xyz",
      label: "Hotel",
      title: "Hotel",
      description: null,
      lat: 24.7,
      lng: 46.6,
      address_text: "Marriott",
      is_default: true,
      place_images: null, // exercises the COALESCE fallback
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const client = makeFakeClient({ row: fakeRow });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);

    const res = await POST(guestReq);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.label).toBe("Hotel");
    // COALESCEd to [] for the client.
    expect(body.data.place_images).toEqual([]);
    expect(body.data).not.toHaveProperty("guest_key");
  });
});

describe("PUT /api/v1/delivery-addresses — delegates to updateAddressService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("returns 400 when id query param missing", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    const res = await PUT(mockRequest(BASE_URL, { label: "X", address_text: "Y" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("المعرّف مطلوب");
  });

  it("returns 404 when the service cannot find the address", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    // Service returns null when UPDATE matches 0 rows.
    const client = makeFakeClient({ row: null });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);

    const res = await PUT(
      mockRequest(`${BASE_URL}?id=missing`, {
        label: "Work",
        address_text: "Olaya St",
        lat: 24.7,
        lng: 46.6,
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("العنوان غير موجود");
  });

  it("updates the address and returns the updated row", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    const fakeRow = {
      id: "addr-1",
      user_id: "user-1",
      guest_key: null,
      label: "Work",
      title: "العمل",
      description: null,
      lat: 24.7,
      lng: 46.6,
      address_text: "Olaya St",
      is_default: true,
      place_images: [],
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const client = makeFakeClient({ row: fakeRow });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);

    const res = await PUT(
      mockRequest(`${BASE_URL}?id=addr-1`, {
        label: "Work",
        address_text: "Olaya St",
        lat: 24.7,
        lng: 46.6,
        is_default: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.label).toBe("Work");
    expect(body.data.is_default).toBe(true);
    expect(body.data).not.toHaveProperty("user_id");
  });
});

describe("DELETE /api/v1/delivery-addresses — preserves pre-P2-3 contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it("returns 200 even when rowCount=0 (idempotent contract)", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    // Service returns 0 when DELETE matches no rows; the route still
    // returns 200 to preserve the pre-P2-3 contract.
    (query as unknown as { mockImplementationOnce: (fn: unknown) => void }).mockImplementationOnce(
      async () => ({ rows: [], rowCount: 0 }),
    );

    const res = await DELETE(mockRequest(`${BASE_URL}?id=missing`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("deletes via the service and returns 200 on success", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    (query as unknown as { mockImplementationOnce: (fn: unknown) => void }).mockImplementationOnce(
      async () => ({ rows: [], rowCount: 1 }),
    );

    const res = await DELETE(mockRequest(`${BASE_URL}?id=addr-1`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 400 when id query param missing", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("user-1");
    const res = await DELETE(mockRequest(BASE_URL));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("المعرّف مطلوب");
  });
});