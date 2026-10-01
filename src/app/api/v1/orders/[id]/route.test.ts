import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for GET /api/v1/orders/[id].
 *
 * Pinned here so a future migration cannot silently re-introduce the
 * `column a.plus_code does not exist` 500 (F2 audit, 2026-10-01).
 *
 * The DB column `addresses.plus_code` was never added — the
 * `plus_code` data lives only on `direct_order_meta.delivery_plus_code`.
 * The order-detail endpoint needs to keep falling back to that
 * column. We pin the SQL shape so a regression that re-adds
 * `a.plus_code` to the SELECT breaks the suite immediately.
 */

type QueryCall = { sql: string; params: unknown[] };

function makeFakeClient() {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const s = sql.trim().toUpperCase();
      if (s.startsWith("SELECT") && s.includes("FROM ORDERS")) {
        return {
          rows: [
            {
              id: "order-1",
              status: "pending",
              type: "delivery",
              subtotal: 40,
              delivery_fee: 5,
              service_fee: 0,
              tax: 0,
              discount: 0,
              total: 45,
              payment_method: "cash",
              payment_status: "pending",
              guest_name: "ضيف",
              guest_phone: "0501234567",
              guest_city: "الرياض",
              guest_district: "العليا",
              notes: null,
              scheduled: false,
              scheduled_for: null,
              slot_window: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              tracking_code: "123456",
              voice_note_url: null,
              voice_note_duration: null,
              user_id: null,
              // address_plus_code intentionally absent — it was the bug
              address_label: "Home",
              address_text: "Riyadh",
              address_lat: null,
              address_lng: null,
              address_description: null,
              address_place_images: [],
              user_name: null,
              user_phone: null,
              delivery_lat: 24.7,
              delivery_lng: 46.6,
              delivery_plus_code: "8F27+7C Riyadh",
              city: "Riyadh",
              district: "العليا",
              customer_edited: false,
              last_edited_at: null,
              fee_acknowledged: false,
            },
          ],
        };
      }
      if (s.includes("FROM DIRECT_ORDER_ITEMS")) {
        return { rows: [] };
      }
      if (s.includes("FROM DIRECT_ORDER_MESSAGES")) {
        return { rows: [{ un: "0", total: "0" }] };
      }
      // assertOrderOwnership's lookup
      if (s.includes("LIMIT 1") && s.includes("IDEMPOTENCY_KEY")) {
        return {
          rows: [
            {
              id: "order-1",
              user_id: null,
              status: "pending",
              idempotency_key: "test-key",
            },
          ],
        };
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

vi.mock("@/lib/identity", () => ({
  resolveCustomerUserIdFromRequest: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/orders", () => ({
  assertOrderOwnership: vi.fn().mockResolvedValue({
    ok: true,
    order: { id: "order-1", user_id: null, status: "pending" },
  }),
  idempotencyKeyFromQuery: vi.fn().mockReturnValue("test-key"),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { pool } from "@/lib/db";
import { GET } from "./route";

describe("GET /api/v1/orders/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not reference the non-existent addresses.plus_code", async () => {
    const fake = makeFakeClient();
    (pool.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      fake.client,
    );

    const req = {
      headers: { get: () => null },
      url: "http://localhost/api/v1/orders/order-1?idempotency_key=test-key",
    } as unknown as Request;

    const ctx = { params: Promise.resolve({ id: "order-1" }) };
    const res = await GET(req as unknown as Parameters<typeof GET>[0], ctx);

    // 1. No SQL the route issues may mention `a.plus_code` — that
    //    column doesn't exist on `addresses` and produced 500s in
    //    production. Pinned here so a future copy-paste from
    //    another audit PR cannot re-add it.
    for (const call of fake.calls) {
      expect(call.sql).not.toMatch(/a\.plus_code/);
      expect(call.sql.toLowerCase()).not.toContain("plus_code as address");
    }

    // 2. The route still succeeds and includes the direct-meta
    //    fallback plus_code in the JSON response.
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.order.address.plus_code).toBe("8F27+7C Riyadh");
  });
});