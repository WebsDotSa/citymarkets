/**
 * Regression test for /api/v1/delivery/slots.
 *
 * Migration 078 (2026-09-30): the route used to accept a `?zone=<uuid>`
 * query param that filtered `orders.delivery_zone_id` — a column that
 * was dropped with the `delivery_zones` table in migration 060. Sending
 * `?zone=` therefore produced a 500 ("column does not exist") for every
 * caller. We accept-and-ignore the param now and always return
 * `zone_id: null`. This test pins the new contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type QueryCall = { sql: string; params: unknown[] };

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));
vi.mock("@/lib/cors", () => ({
  withCors: <T extends (...args: never[]) => unknown>(h: T) => h,
}));

import { query } from "@/lib/db";
import { GET } from "./route";

function mockRequest(url: string): Request {
  return { headers: { get: () => null }, url } as unknown as Request;
}

function makeQueryMock(opts?: { slotBookings?: Record<string, number>; slotsConfig?: unknown }) {
  return vi.mocked(query).mockImplementation(async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
    if (s.includes("FROM DELIVERY_SETTINGS") && (s.includes("KEY = 'SLOTS'") || s.includes("KEY=$1"))) {
      return {
        rows: [
          {
            value:
              opts?.slotsConfig ?? {
                enabled: true,
                lead_time_minutes: 120,
                max_days_ahead: 7,
                min_days_ahead: 0,
                timezone: "Asia/Riyadh",
                slot_duration_minutes: 120,
                windows: [
                  { id: "morning", label_ar: "صباحاً", start: "09:00", end: "11:00", capacity: 20 },
                  { id: "noon", label_ar: "ظهراً", start: "12:00", end: "14:00", capacity: 25 },
                ],
              },
          },
        ],
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    }
    if (s.includes("FROM ORDERS") && s.includes("SCHEDULED")) {
      const counts = opts?.slotBookings ?? {};
      return {
        rows: Object.entries(counts).map(([slot_window, n]) => ({
          slot_window,
          n: String(n),
        })),
        command: "SELECT",
        rowCount: 0,
        oid: 0,
        fields: [],
      };
    }
    return { rows: [], command: "SELECT", rowCount: 0, oid: 0, fields: [] };
  });
}

describe("GET /api/v1/delivery/slots — migration 060/078 regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 + windows even when caller passes the deprecated ?zone= param", async () => {
    // Critical regression: pre-fix this hit a 500 from the missing
    // `delivery_zone_id` column filter.
    makeQueryMock();
    const res = await GET(
      mockRequest("http://localhost/api/v1/delivery/slots?zone=00000000-0000-0000-0000-000000000000") as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.zone_id).toBeNull();
    expect(Array.isArray(body.data.windows)).toBe(true);
    // Should NOT carry any legacy column reference in the SQL.
    const calls = vi.mocked(query).mock.calls;
    const ordersCalls = calls.filter(([sql]) =>
      String(sql).toUpperCase().includes("FROM ORDERS"),
    );
    expect(ordersCalls.length).toBeGreaterThan(0);
    for (const [sql] of ordersCalls) {
      expect(String(sql)).not.toMatch(/DELIVERY_ZONE_ID/i);
    }
  });

  it("emits X-API-Deprecated header when ?zone= is sent", async () => {
    makeQueryMock();
    const res = await GET(
      mockRequest("http://localhost/api/v1/delivery/slots?zone=abc") as never,
    );
    expect(res.headers.get("X-API-Deprecated")).toMatch(/zone=/i);
  });

  it("does NOT emit X-API-Deprecated when ?zone= is absent", async () => {
    makeQueryMock();
    const res = await GET(
      mockRequest("http://localhost/api/v1/delivery/slots") as never,
    );
    expect(res.headers.get("X-API-Deprecated")).toBeNull();
  });

  it("counts booked slots globally (no per-zone partition)", async () => {
    makeQueryMock({ slotBookings: { morning: 5, noon: 0 } });
    const res = await GET(
      mockRequest("http://localhost/api/v1/delivery/slots") as never,
    );
    const body = await res.json();
    const morning = body.data.windows.find((w: { id: string }) => w.id === "morning");
    const noon = body.data.windows.find((w: { id: string }) => w.id === "noon");
    expect(morning.booked).toBe(5);
    expect(noon.booked).toBe(0);
    expect(morning.available).toBe(true);
  });

  it("clamps ?date= into [min_date, max_date]", async () => {
    makeQueryMock();
    // Date 60 days out — well past the 7-day max window.
    const farFuture = new Date();
    farFuture.setUTCDate(farFuture.getUTCDate() + 60);
    const yyyy = farFuture.getUTCFullYear();
    const mm = String(farFuture.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(farFuture.getUTCDate()).padStart(2, "0");
    const res = await GET(
      mockRequest(`http://localhost/api/v1/delivery/slots?date=${yyyy}-${mm}-${dd}`) as never,
    );
    const body = await res.json();
    // The server clamps; expect the returned date to be the max_date, not the requested one.
    expect(body.data.date).toBe(body.data.max_date);
    expect(body.data.date <= body.data.max_date).toBe(true);
  });
});
