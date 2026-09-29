/**
 * HTTP route tests for PATCH /api/v1/vendor/orders/[id]/status.
 *
 * Invariants:
 *   1. 401 when session invalid
 *   2. 403 for role < staff (viewer cannot change status)
 *   3. 400 when status missing in body
 *   4. 404 when order does not belong to session.vendorId (cross-tenant)
 *   5. 400 for invalid status transitions (pending → delivered, etc.)
 *   6. Valid forward transitions all return 200
 *   7. Cancellation restores stock — skips items where product_id IS NULL
 *      (migration 054: ON DELETE SET NULL)
 *   8. Delivered/cancelled bumps vendor_daily_stats
 *   9. UPDATE WHERE always pins vendor_id to session.vendorId
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const SESSION = {
  vendorId: "00000000-0000-0000-0000-0000000000a3",
  vendorSlug: "burger-palace",
  staffId: "staff-1",
  email: "owner@example.com",
  fullName: "Owner",
  role: "owner" as const,
  permissions: [],
};

// Mutated per test in beforeEach
const ORDER: { status: string; id: string } = { id: "vo-1", status: "pending" };

const ORDER_UPDATED = {
  id: "vo-1",
  order_number: "ORD-001",
  status: "confirmed",
  updated_at: "2026-01-01T00:00:00Z",
  total: "100.00",
};

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  pool: {
    connect: vi.fn(),
    query: vi.fn(async () => ({ rows: [] })),
  },
}));
vi.mock("@/lib/identity", () => ({
  requireVendorRole: vi.fn((_session: unknown, role: string) => {
    const s = _session as { role: string };
    const allowed = ["owner", "manager", "staff"];
    if (role === "staff" && allowed.includes(s.role)) return null;
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }),
  signVendorSessionToken: vi.fn(),
  vendorSessionCookieOptions: vi.fn(() => ({})),
  VENDOR_SESSION_COOKIE: "vendor_session",
}));
vi.mock("@/lib/identity/vendor-auth-with-db", () => ({
  verifyVendorRequestWithDb: vi.fn(async () => SESSION),
}));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { query } from "@/lib/db";
import { verifyVendorRequestWithDb } from "@/lib/identity/vendor-auth-with-db";
import { PATCH } from "./route";

function patchReq(orderId: string, body: unknown): NextRequest {
  return new Request(
    `http://localhost/api/v1/vendor/orders/${orderId}/status`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as unknown as NextRequest;
}

function setupSmartMock(opts: {
  initialOrderStatus?: string;
  items?: { product_id: string | null; quantity: number }[];
}) {
  let currentStatus = opts.initialOrderStatus ?? "pending";
  const impl = async (sql: string, params: unknown[] = []) => {
    const norm = String(sql).replace(/\s+/g, " ").trim().toUpperCase();

    // SELECT current status
    if (norm.startsWith("SELECT") && norm.includes("FROM VENDOR_ORDERS") && !norm.includes("DAILY_STATS")) {
      return { rows: [{ id: ORDER.id, status: currentStatus }] };
    }

    // SELECT items for stock restore
    if (norm.includes("FROM VENDOR_ORDER_ITEMS")) {
      const items = opts.items ?? [];
      return { rows: items.filter((i) => i.product_id != null) };
    }

    // UPDATE vendor_orders status (RETURNING)
    if (norm.startsWith("UPDATE VENDOR_ORDERS")) {
      const newStatus = String(params[0] ?? "");
      currentStatus = newStatus;
      return {
        rows: [{ ...ORDER_UPDATED, status: newStatus }],
      };
    }

    // UPDATE vendor_products stock (no return)
    if (norm.startsWith("UPDATE VENDOR_PRODUCTS")) {
      return { rows: [] };
    }

    // INSERT/UPDATE vendor_daily_stats
    if (norm.includes("VENDOR_DAILY_STATS")) {
      return { rows: [] };
    }

    return { rows: [] };
  };
  (vi.mocked(query) as unknown as { mockImplementation: (fn: typeof impl) => void }).mockImplementation(impl);
}

describe("PATCH /api/v1/vendor/orders/[id]/status — auth & validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyVendorRequestWithDb).mockResolvedValue(SESSION);
  });

  it("returns 401 when session is invalid", async () => {
    vi.mocked(verifyVendorRequestWithDb).mockResolvedValueOnce(null);
    const res = await PATCH(patchReq("vo-1", { status: "confirmed" }), {
      params: Promise.resolve({ id: "vo-1" }),
    } as never);
    expect(res.status).toBe(401);
  });

  it("returns 403 for 'viewer' role", async () => {
    vi.mocked(verifyVendorRequestWithDb).mockResolvedValueOnce({
      ...SESSION,
      role: "viewer",
    });
    const res = await PATCH(patchReq("vo-1", { status: "confirmed" }), {
      params: Promise.resolve({ id: "vo-1" }),
    } as never);
    expect(res.status).toBe(403);
  });

  it("returns 400 when status is missing", async () => {
    const res = await PATCH(patchReq("vo-1", {}), {
      params: Promise.resolve({ id: "vo-1" }),
    } as never);
    expect(res.status).toBe(400);
  });

  it("returns 404 when order does not belong to this vendor", async () => {
    // Smart mock that always returns empty for the SELECT — simulates
    // the cross-tenant WHERE clause filter excluding the row.
    vi.mocked(query).mockResolvedValue({ rows: [] } as never);
    const res = await PATCH(patchReq("vo-other", { status: "confirmed" }), {
      params: Promise.resolve({ id: "vo-other" }),
    } as never);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/vendor/orders/[id]/status — state machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyVendorRequestWithDb).mockResolvedValue(SESSION);
  });

  it("rejects pending → delivered (skips intermediate states)", async () => {
    setupSmartMock({ initialOrderStatus: "pending" });
    const res = await PATCH(patchReq("vo-1", { status: "delivered" }), {
      params: Promise.resolve({ id: "vo-1" }),
    } as never);
    expect(res.status).toBe(400);
  });

  it("rejects delivered → confirmed (terminal state)", async () => {
    setupSmartMock({ initialOrderStatus: "delivered" });
    const res = await PATCH(patchReq("vo-1", { status: "confirmed" }), {
      params: Promise.resolve({ id: "vo-1" }),
    } as never);
    expect(res.status).toBe(400);
  });

  it("accepts pending → confirmed", async () => {
    setupSmartMock({ initialOrderStatus: "pending" });
    const res = await PATCH(patchReq("vo-1", { status: "confirmed" }), {
      params: Promise.resolve({ id: "vo-1" }),
    } as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      success: true,
      order: { id: "vo-1", status: "confirmed" },
    });
  });

  it("accepts confirmed → preparing", async () => {
    setupSmartMock({ initialOrderStatus: "confirmed" });
    const res = await PATCH(patchReq("vo-1", { status: "preparing" }), {
      params: Promise.resolve({ id: "vo-1" }),
    } as never);
    expect(res.status).toBe(200);
  });

  it("accepts out_for_delivery → delivered and bumps daily stats", async () => {
    setupSmartMock({ initialOrderStatus: "out_for_delivery" });
    const res = await PATCH(patchReq("vo-1", { status: "delivered" }), {
      params: Promise.resolve({ id: "vo-1" }),
    } as never);
    expect(res.status).toBe(200);
    const calls = vi.mocked(query).mock.calls;
    // Last call must be the daily stats upsert
    const statsCall = calls[calls.length - 1];
    expect(String(statsCall[0])).toMatch(/vendor_daily_stats/i);
    expect(String(statsCall[0])).toMatch(/orders_completed/i);
  });
});

describe("PATCH /api/v1/vendor/orders/[id]/status — cancellation restores stock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyVendorRequestWithDb).mockResolvedValue(SESSION);
  });

  it("cancellation skips items where product_id IS NULL (migration 054)", async () => {
    setupSmartMock({
      initialOrderStatus: "pending",
      items: [
        { product_id: "p-1", quantity: 2 },
        { product_id: "p-2", quantity: 5 },
      ],
    });

    const res = await PATCH(patchReq("vo-1", { status: "cancelled" }), {
      params: Promise.resolve({ id: "vo-1" }),
    } as never);
    expect(res.status).toBe(200);

    // The items SELECT must filter out product_id IS NULL
    const itemsCall = vi.mocked(query).mock.calls.find((c) =>
      String(c[0]).toUpperCase().includes("FROM VENDOR_ORDER_ITEMS"),
    );
    expect(itemsCall).toBeDefined();
    expect(String(itemsCall![0])).toMatch(/product_id\s+IS\s+NOT\s+NULL/i);

    // 2 items → 2 stock restock calls (one per product)
    const stockCalls = vi.mocked(query).mock.calls.filter((c) =>
      String(c[0])
        .toUpperCase()
        .includes("UPDATE VENDOR_PRODUCTS"),
    );
    expect(stockCalls.length).toBe(2);
  });

  it("cancellation with all-null product_ids → 0 stock calls", async () => {
    setupSmartMock({
      initialOrderStatus: "pending",
      items: [
        { product_id: null, quantity: 2 }, // product was deleted → migration 054
      ],
    });
    const res = await PATCH(patchReq("vo-1", { status: "cancelled" }), {
      params: Promise.resolve({ id: "vo-1" }),
    } as never);
    expect(res.status).toBe(200);
    const stockCalls = vi.mocked(query).mock.calls.filter((c) =>
      String(c[0])
        .toUpperCase()
        .includes("UPDATE VENDOR_PRODUCTS"),
    );
    expect(stockCalls.length).toBe(0);
  });
});

describe("PATCH /api/v1/vendor/orders/[id]/status — vendor_id pinned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyVendorRequestWithDb).mockResolvedValue(SESSION);
  });

  it("SELECT WHERE pins vendor_id to session", async () => {
    setupSmartMock({ initialOrderStatus: "pending" });
    await PATCH(patchReq("vo-1", { status: "confirmed" }), {
      params: Promise.resolve({ id: "vo-1" }),
    } as never);
    const selectCalls = vi.mocked(query).mock.calls.filter((c) =>
      String(c[0]).toUpperCase().startsWith("SELECT"),
    );
    for (const c of selectCalls) {
      expect(String(c[0])).toMatch(/vendor_id\s*=\s*\$2/i);
      expect(c[1]).toContain(SESSION.vendorId);
    }
  });

  it("UPDATE WHERE pins vendor_id to session", async () => {
    setupSmartMock({ initialOrderStatus: "pending" });
    await PATCH(patchReq("vo-1", { status: "confirmed" }), {
      params: Promise.resolve({ id: "vo-1" }),
    } as never);
    const updateCalls = vi.mocked(query).mock.calls.filter((c) =>
      String(c[0]).toUpperCase().startsWith("UPDATE"),
    );
    for (const c of updateCalls) {
      expect(String(c[0])).toMatch(/vendor_id\s*=/i);
      expect(c[1]).toContain(SESSION.vendorId);
    }
  });
});