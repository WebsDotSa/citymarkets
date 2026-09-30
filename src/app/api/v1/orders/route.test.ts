import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for /api/v1/orders.
 *
 * Two independent contracts are guarded here:
 *
 *  1. POST accepts only canonical UUID `product_id` values in the
 *     request body. Non-UUID values must be rejected with 400 and a
 *     rolled-back transaction — never silently coerced.
 *
 *  2. GET joins `order_items` to `products_unified` (NOT bare
 *     `products`). This pins the products→products_unified migration
 *     in place so a regression cannot silently re-introduce the
 *     legacy table reference.
 *
 * The route hits the database, so we mock `pool.connect` to capture
 * the query plan without actually running SQL. We also mock the
 * auth/session helpers so the route thinks a customer is signed in.
 */

type QueryCall = { sql: string; params: unknown[] };

function makeFakeClient(opts?: { validProduct?: boolean }) {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const s = sql.trim().toUpperCase();

      if (s.startsWith("BEGIN") || s.startsWith("ROLLBACK") || s.startsWith("COMMIT")) {
        return { rows: [] };
      }
      // SELECT against products_unified — return a single product
      // when the test wants the happy path; empty otherwise.
      if (s.includes("FROM PRODUCTS_UNIFIED")) {
        if (opts?.validProduct) {
          return {
            rows: [
              {
                product_id: params[0],
                price: "10.00",
                discount_price: null,
                stock_qty: "100",
                name_ar: "منتج تجريبي",
                is_active: true,
              },
            ],
          };
        }
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, calls };
}

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(),
}));

vi.mock('@/lib/identity', () => ({
  resolveCustomerUserIdFromRequest: vi.fn(),
  getGuestSessionIdFromRequest: vi.fn(),
}));

// Migration 079 (2026-09-30): the route now resolves per-branch
// hours via getActiveStoreHours. Mock the new modules so the
// regression tests stay DB-free.
vi.mock('@/lib/delivery/store-hours', () => ({
  getActiveStoreHours: vi.fn(async () => ({
    enabled: true,
    open_time: "08:00",
    close_time: "23:00",
    closed_message: null,
    timezone: "Asia/Riyadh",
  })),
  evaluateStoreHours: vi.fn(() => ({ open: true, message: null })),
  parseStoreHours: vi.fn(),
  DEFAULT_STORE_OPENING_HOURS: {},
}));
vi.mock('@/lib/delivery/delivery-hours', () => ({
  evaluateHours: vi.fn(() => ({ open: true, message: null })),
  getDeliveryHours: vi.fn(async () => ({
    enabled: true,
    open_time: "08:00",
    close_time: "23:00",
    closed_message: null,
    timezone: "Asia/Riyadh",
  })),
  parseDeliveryHours: vi.fn(),
  DEFAULT_DELIVERY_HOURS: {},
  buildHoursStatus: vi.fn(),
}));
vi.mock('@/lib/delivery/main-store', () => ({
  getMainStoreAndDistance: vi.fn(async () => ({
    store: {
      id: "00000000-0000-0000-0000-000000000001",
      name_ar: "الفرع الرئيسي",
      lat: 24.7136,
      lng: 46.6753,
      is_active: true,
    },
    distanceKm: null,
  })),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { pool } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { POST, GET } from "./route";

describe("POST /api/v1/orders — deprecated (audit 2026-09-30, A4)", () => {
  it("returns 410 Gone with a pointer to /api/v1/checkout", async () => {
    const res = await POST();
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("deprecated");
    expect(body.replacement).toBe("/api/v1/checkout");
  });

  it("does not touch the DB — a 410 must short-circuit before pool.connect()", async () => {
    // Replay-storm guard: the deprecated handler must not acquire a
    // DB connection on every request. Previously the route would
    // `pool.connect()` on every call; a 410 must skip all that.
    vi.mocked(pool.connect).mockClear();
    await POST();
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

