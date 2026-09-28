/**
 * Tests for analytics-queries. We mock `@/lib/db.query` so we can
 * validate the parameter shape + SQL fragments without a real DB.
 *
 * The mocks return canned rows; we assert on what `query` was called
 * with and that the helpers did the right coercion.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const queryMock = vi.fn();
const poolQueryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  pool: {
    query: (...args: unknown[]) => poolQueryMock(...args),
  },
}));

import {
  ALLOWED_PERIODS,
  normalizePeriod,
  getOverviewKpis,
  getOrdersByDay,
  getVisitorsByDay,
  getTopProducts,
  getTopPages,
  getTopCountries,
  getOrdersBreakdown,
  getVendorLeaderboard,
  getVendorDailyStats,
  getVendorTopProducts,
  getVendorSummary,
} from "./analytics-queries";

beforeEach(() => {
  queryMock.mockReset();
  poolQueryMock.mockReset();
});

describe("normalizePeriod", () => {
  it("accepts 7, 30, 90", () => {
    expect(normalizePeriod("7")).toBe(7);
    expect(normalizePeriod("30")).toBe(30);
    expect(normalizePeriod("90")).toBe(90);
  });

  it("falls back to 30 for unknown values", () => {
    expect(normalizePeriod("180")).toBe(30);
    expect(normalizePeriod("abc")).toBe(30);
    expect(normalizePeriod(null)).toBe(30);
    expect(normalizePeriod(undefined)).toBe(30);
  });

  it("only allows the documented windows", () => {
    expect(ALLOWED_PERIODS).toEqual([7, 30, 90]);
  });
});

describe("getOverviewKpis", () => {
  it("binds periodDays as integer and coerces numbers", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          products: "5",
          low_stock: "1",
          categories: "3",
          users: "10",
          banners: "2",
          active_coupons: "1",
          total_orders: "20",
          cancelled_orders: "3",
          orders_today: "2",
          orders_week: "8",
          revenue_electronic: "1500.50",
          revenue_any_method: "1800.00",
          orders_confirmed: "10",
          active_customers: "7",
          page_views: "200",
          unique_sessions: "50",
        },
      ],
    });

    const result = await getOverviewKpis(30);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(params).toEqual([30]);
    expect(sql).toContain("make_interval(days => $1::int)");
    expect(result.revenueElectronic).toBe(1500.5);
    expect(result.ordersConfirmed).toBe(10);
    expect(result.visitorsUnique).toBe(50);
    expect(result.pageViews).toBe(200);
    expect(result.conversionRate).toBeCloseTo((10 / 50) * 100, 5);
    expect(result.averageOrderValue).toBe(150.05);
    expect(result.products).toBe(5);
    expect(result.activeBanners).toBe(2);
  });

  it("returns zeros when DB has no rows", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          products: 0,
          low_stock: 0,
          categories: 0,
          users: 0,
          banners: 0,
          active_coupons: 0,
          total_orders: 0,
          cancelled_orders: 0,
          orders_today: 0,
          orders_week: 0,
          revenue_electronic: 0,
          revenue_any_method: 0,
          orders_confirmed: 0,
          active_customers: 0,
          page_views: 0,
          unique_sessions: 0,
        },
      ],
    });
    const result = await getOverviewKpis(7);
    expect(result.revenueElectronic).toBe(0);
    expect(result.conversionRate).toBe(0);
    expect(result.averageOrderValue).toBe(0);
  });
});

describe("getOrdersByDay", () => {
  it("returns typed rows", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { day: "2026-07-01", orders: "5", revenue: "100.00" },
        { day: "2026-07-02", orders: "3", revenue: "60.00" },
      ],
    });
    const result = await getOrdersByDay(7);
    expect(queryMock.mock.calls[0][1]).toEqual([7]);
    expect(result).toEqual([
      { day: "2026-07-01", orders: 5, revenue: 100 },
      { day: "2026-07-02", orders: 3, revenue: 60 },
    ]);
  });
});

describe("getVisitorsByDay", () => {
  it("queries the materialized view with the period bound", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ day: "2026-07-01", views: "100", unique_sessions: "30" }],
    });
    const result = await getVisitorsByDay(7);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("FROM daily_visitor_stats");
    expect(params).toEqual([7]);
    expect(result[0]).toEqual({ day: "2026-07-01", views: 100, uniqueSessions: 30 });
  });
});

describe("getTopProducts", () => {
  it("binds periodDays and limit", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: "p1", name: "منتج 1", image: "/img.png", units: "10", revenue: "200.00" },
      ],
    });
    const result = await getTopProducts(30, 5);
    expect(queryMock.mock.calls[0][1]).toEqual([30, 5]);
    expect(result[0]).toEqual({
      id: "p1",
      name: "منتج 1",
      image: "/img.png",
      units: 10,
      revenue: 200,
    });
  });

  it("uses products_unified for vendor-aware readings", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await getTopProducts(30);
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toContain("products_unified");
  });
});

describe("getTopPages", () => {
  it("filters by event_type='pageview'", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ path: "/", views: "100", unique_sessions: "30" }],
    });
    const result = await getTopPages(7, 5);
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toContain("event_type = 'pageview'");
    expect(queryMock.mock.calls[0][1]).toEqual([7, 5]);
    expect(result[0]).toEqual({ path: "/", views: 100, uniqueSessions: 30 });
  });
});

describe("getTopCountries", () => {
  it("groups by country", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { country: "SA", views: "100" },
        { country: "AE", views: "20" },
      ],
    });
    const result = await getTopCountries(30);
    expect(result).toEqual([
      { country: "SA", views: 100 },
      { country: "AE", views: 20 },
    ]);
  });
});

describe("getOrdersBreakdown", () => {
  it("issues two queries and returns both shapes", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ status: "delivered", count: "5" }],
      })
      .mockResolvedValueOnce({
        rows: [{ method: "mada", count: "3", revenue: "100" }],
      });
    const result = await getOrdersBreakdown(30);
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(result.byStatus).toEqual([{ status: "delivered", count: 5 }]);
    expect(result.byPayment).toEqual([{ method: "mada", count: 3, revenue: 100 }]);
  });
});

describe("getVendorLeaderboard", () => {
  it("returns vendor rows without type filter", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "v1",
          slug: "qahwa",
          name: "قهوة",
          vendor_type: "food_beverage",
          is_active: true,
          orders: "10",
          revenue: "500.00",
          avg_order_value: "50.00",
          unique_customers: "7",
        },
      ],
    });
    const result = await getVendorLeaderboard(30);
    expect(queryMock.mock.calls[0][1]).toEqual([30]);
    expect(result[0]).toEqual({
      id: "v1",
      slug: "qahwa",
      name: "قهوة",
      vendorType: "food_beverage",
      isActive: true,
      orders: 10,
      revenue: 500,
      avgOrderValue: 50,
      uniqueCustomers: 7,
    });
  });

  it("appends a vendorType filter when provided", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await getVendorLeaderboard(30, "fashion");
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("AND v.vendor_type = $2::text");
    expect(params).toEqual([30, "fashion"]);
  });

  it("ignores vendorType that does not match the safe pattern", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await getVendorLeaderboard(30, "fashion;DROP TABLE vendors");
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).not.toContain("AND v.vendor_type =");
    expect(params).toEqual([30]);
  });
});

describe("getVendorDailyStats", () => {
  it("binds vendorId and periodDays", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ day: "2026-07-01", orders: "5", revenue: "100" }],
    });
    const result = await getVendorDailyStats("v1", 7);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("FROM vendor_daily_stats");
    expect(params).toEqual([7, "v1"]);
    expect(result[0]).toEqual({ day: "2026-07-01", orders: 5, revenue: 100 });
  });
});

describe("getVendorTopProducts", () => {
  it("joins vendor_products and vendor_order_items", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ product_id: "p1", name: "كابتشينو", units: "20", revenue: "100.00" }],
    });
    const result = await getVendorTopProducts("v1", 30, 5);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("FROM vendor_products vp");
    expect(sql).toContain("LEFT JOIN vendor_order_items voi");
    expect(params).toEqual([30, "v1", 5]);
    expect(result[0]).toEqual({
      productId: "p1",
      name: "كابتشينو",
      units: 20,
      revenue: 100,
    });
  });
});

describe("getVendorSummary", () => {
  it("returns summary KPIs for a single vendor", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          orders: "10",
          revenue: "500.00",
          avg_order_value: "50.00",
          unique_customers: "7",
          cancelled_orders: "1",
        },
      ],
    });
    const result = await getVendorSummary("v1", 30);
    expect(result).toEqual({
      orders: 10,
      revenue: 500,
      avgOrderValue: 50,
      uniqueCustomers: 7,
      cancelledOrders: 1,
    });
  });
});
