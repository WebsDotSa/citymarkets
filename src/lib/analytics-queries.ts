/**
 * Pure SQL helpers for the admin analytics dashboard.
 *
 * Each helper:
 *  - returns a typed result,
 *  - takes a `periodDays` integer already validated by the caller (allow-list
 *    of 7 / 30 / 90), and uses it as a bound `make_interval(days => $1)` so
 *    Postgres rejects anything but an integer,
 *  - never interpolates user input into SQL strings.
 *
 * The route handler imports these and calls them in parallel; the unit
 * tests in `analytics-queries.test.ts` validate the parameter shape
 * without hitting a real database.
 */
import { query } from "@/lib/db";

/** Allow-list of selectable windows. Anything else falls back to 30. */
export const ALLOWED_PERIODS = [7, 30, 90] as const;
export type PeriodDays = (typeof ALLOWED_PERIODS)[number];

/** Normalise a raw query-string period to a typed window. */
export function normalizePeriod(raw: string | null | undefined): PeriodDays {
  const n = Number(raw);
  if (n === 7 || n === 30 || n === 90) return n;
  return 30;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type OverviewKpis = {
  revenueElectronic: number;
  revenueAnyMethod: number;
  ordersTotal: number;
  ordersConfirmed: number;
  ordersCancelled: number;
  ordersToday: number;
  ordersWeek: number;
  averageOrderValue: number;
  visitorsUnique: number;
  pageViews: number;
  conversionRate: number;
  /** Distinct customers who placed at least one confirmed order in window. */
  activeCustomers: number;
  // Catalogue-level operational counters
  products: number;
  lowStockProducts: number;
  categories: number;
  users: number;
  activeCoupons: number;
  activeBanners: number;
};

export type DayPoint = {
  day: string;
  orders: number;
  revenue: number;
};

export type VisitorDayPoint = {
  day: string;
  views: number;
  uniqueSessions: number;
};

export type TopProduct = {
  id: string;
  name: string;
  image: string | null;
  units: number;
  revenue: number;
};

export type TopPage = {
  path: string;
  views: number;
  uniqueSessions: number;
};

export type CountryRow = {
  country: string;
  views: number;
};

export type VendorLeaderRow = {
  id: string;
  slug: string;
  name: string;
  vendorType: string;
  isActive: boolean;
  orders: number;
  revenue: number;
  avgOrderValue: number;
  uniqueCustomers: number;
};

export type VendorTopProduct = {
  productId: string;
  name: string;
  units: number;
  revenue: number;
};

// ---------------------------------------------------------------------------
// SQL fragments shared by multiple helpers
// ---------------------------------------------------------------------------

/** Revenue-eligible order filter (mirrors `SQL_REVENUE_ELIGIBLE` from
 *  order-metrics.ts but uses table aliases so it composes). */
const REVENUE_ORDER_FRAGMENT = `
  o.status = 'confirmed'
  AND COALESCE(LOWER(TRIM(o.payment_method)), '') NOT IN ('cash', 'wallet', '')
`;

/** Vendor-eligible filter (vendor_orders has its own status enum). */
const VENDOR_REVENUE_FRAGMENT = `
  vo.status IN ('confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered')
  AND vo.payment_status = 'paid'
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Overview KPIs: revenue, orders, visitors, AOV, conversion, catalogue. */
export async function getOverviewKpis(periodDays: PeriodDays): Promise<OverviewKpis> {
  const sql = `
    WITH counts AS (
      SELECT
        (SELECT COUNT(*) FROM products_unified WHERE is_active = true)                                         AS products,
        (SELECT COUNT(*) FROM products_unified WHERE stock_qty <= 5 AND stock_qty > 0)                  AS low_stock,
        (SELECT COUNT(*) FROM categories WHERE is_active = true)                                        AS categories,
        (SELECT COUNT(*) FROM users  WHERE created_at >= NOW() - make_interval(days => $1::int))        AS users,
        (SELECT COUNT(*) FROM banners WHERE active = true)                                               AS banners,
        (SELECT COUNT(*) FROM coupons
           WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW()))                       AS active_coupons
    ),
    orders_agg AS (
      SELECT
        COUNT(*)                                                                                       AS total_orders,
        COUNT(*) FILTER (WHERE status = 'cancelled')                                                   AS cancelled_orders,
        COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE)                                         AS orders_today,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')                                 AS orders_week,
        COALESCE(SUM(CASE WHEN ${REVENUE_ORDER_FRAGMENT} THEN total ELSE 0 END), 0)                     AS revenue_electronic,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' AND status NOT IN ('cancelled')
                          THEN total ELSE 0 END), 0)                                                    AS revenue_any_method,
        COUNT(*) FILTER (WHERE ${REVENUE_ORDER_FRAGMENT})                                              AS orders_confirmed,
        COUNT(DISTINCT user_id) FILTER (WHERE ${REVENUE_ORDER_FRAGMENT})                                AS active_customers
      FROM orders o
      WHERE created_at >= NOW() - make_interval(days => $1::int)
    ),
    visitors_agg AS (
      SELECT
        COUNT(*)                                     AS page_views,
        COUNT(DISTINCT session_id)                   AS unique_sessions
      FROM page_views
      WHERE occurred_at >= NOW() - make_interval(days => $1::int)
        AND event_type = 'pageview'
    )
    SELECT
      counts.products, counts.low_stock, counts.categories, counts.users,
      counts.banners, counts.active_coupons,
      orders_agg.total_orders, orders_agg.cancelled_orders, orders_agg.orders_today,
      orders_agg.orders_week, orders_agg.revenue_electronic, orders_agg.revenue_any_method,
      orders_agg.orders_confirmed, orders_agg.active_customers,
      visitors_agg.page_views, visitors_agg.unique_sessions
    FROM counts, orders_agg, visitors_agg
  `;
  const res = await query(sql, [periodDays]);
  const r = res.rows[0] as Record<string, string | number>;
  const revenueElectronic = Number(r.revenue_electronic) || 0;
  const ordersConfirmed = Number(r.orders_confirmed) || 0;
  const visitorsUnique = Number(r.unique_sessions) || 0;
  const averageOrderValue =
    revenueElectronic > 0 && ordersConfirmed > 0 ? revenueElectronic / ordersConfirmed : 0;
  const conversionRate =
    visitorsUnique > 0 ? (ordersConfirmed / visitorsUnique) * 100 : 0;

  return {
    revenueElectronic,
    revenueAnyMethod: Number(r.revenue_any_method) || 0,
    ordersTotal: Number(r.total_orders) || 0,
    ordersConfirmed,
    ordersCancelled: Number(r.cancelled_orders) || 0,
    ordersToday: Number(r.orders_today) || 0,
    ordersWeek: Number(r.orders_week) || 0,
    averageOrderValue,
    visitorsUnique,
    pageViews: Number(r.page_views) || 0,
    conversionRate,
    activeCustomers: Number(r.active_customers) || 0,
    products: Number(r.products) || 0,
    lowStockProducts: Number(r.low_stock) || 0,
    categories: Number(r.categories) || 0,
    users: Number(r.users) || 0,
    activeCoupons: Number(r.active_coupons) || 0,
    activeBanners: Number(r.banners) || 0,
  };
}

/** Orders + revenue per day for the chart. */
export async function getOrdersByDay(periodDays: PeriodDays): Promise<DayPoint[]> {
  const sql = `
    SELECT
      DATE(created_at)                                                            AS day,
      COUNT(*)                                                                    AS orders,
      COALESCE(SUM(CASE WHEN ${REVENUE_ORDER_FRAGMENT} THEN total ELSE 0 END), 0)  AS revenue
    FROM orders o
    WHERE created_at >= NOW() - make_interval(days => $1::int)
    GROUP BY DATE(created_at)
    ORDER BY day
  `;
  const res = await query(sql, [periodDays]);
  return res.rows.map((row: Record<string, string>) => ({
    day: row.day,
    orders: Number(row.orders) || 0,
    revenue: Number(row.revenue) || 0,
  }));
}

/** Visitors per day from the materialized view. Returns zero rows if MV is empty. */
export async function getVisitorsByDay(periodDays: PeriodDays): Promise<VisitorDayPoint[]> {
  const sql = `
    SELECT
      day::text AS day,
      page_views                                     AS views,
      unique_sessions                                AS unique_sessions
    FROM daily_visitor_stats
    WHERE day >= CURRENT_DATE - make_interval(days => $1::int)
    ORDER BY day
  `;
  const res = await query(sql, [periodDays]);
  return res.rows.map((row: Record<string, string>) => ({
    day: row.day,
    views: Number(row.views) || 0,
    uniqueSessions: Number(row.unique_sessions) || 0,
  }));
}

/** Top products by revenue from the unified view (vendor + legacy). */
export async function getTopProducts(
  periodDays: PeriodDays,
  limit = 10
): Promise<TopProduct[]> {
  const sql = `
    SELECT
      pu.id,
      pu.name_ar                                                            AS name,
      pu.image_url                                                          AS image,
      COALESCE(SUM(oi.qty), 0)                                              AS units,
      COALESCE(SUM(oi.unit_price * oi.qty), 0)                              AS revenue
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    JOIN products_unified pu ON oi.product_id = pu.id
    WHERE o.created_at >= NOW() - make_interval(days => $1::int)
      AND ${REVENUE_ORDER_FRAGMENT}
    GROUP BY pu.id, pu.name_ar, pu.image_url
    ORDER BY revenue DESC
    LIMIT $2::int
  `;
  const res = await query(sql, [periodDays, limit]);
  return res.rows.map((row: Record<string, string | null>) => ({
    id: String(row.id),
    name: String(row.name || ""),
    image: row.image ? String(row.image) : null,
    units: Number(row.units) || 0,
    revenue: Number(row.revenue) || 0,
  }));
}

/** Top paths by page views. */
export async function getTopPages(
  periodDays: PeriodDays,
  limit = 12
): Promise<TopPage[]> {
  const sql = `
    SELECT
      path,
      COUNT(*)              AS views,
      COUNT(DISTINCT session_id) AS unique_sessions
    FROM page_views
    WHERE occurred_at >= NOW() - make_interval(days => $1::int)
      AND event_type = 'pageview'
    GROUP BY path
    ORDER BY views DESC
    LIMIT $2::int
  `;
  const res = await query(sql, [periodDays, limit]);
  return res.rows.map((row: Record<string, string>) => ({
    path: String(row.path),
    views: Number(row.views) || 0,
    uniqueSessions: Number(row.unique_sessions) || 0,
  }));
}

/** Top countries by visits. */
export async function getTopCountries(
  periodDays: PeriodDays,
  limit = 8
): Promise<CountryRow[]> {
  const sql = `
    SELECT
      COALESCE(country, 'XX') AS country,
      COUNT(*)                AS views
    FROM page_views
    WHERE occurred_at >= NOW() - make_interval(days => $1::int)
      AND event_type = 'pageview'
    GROUP BY country
    ORDER BY views DESC
    LIMIT $2::int
  `;
  const res = await query(sql, [periodDays, limit]);
  return res.rows.map((row: Record<string, string>) => ({
    country: String(row.country),
    views: Number(row.views) || 0,
  }));
}

/** Status / payment breakdowns for the orders tab. */
export async function getOrdersBreakdown(periodDays: PeriodDays): Promise<{
  byStatus: Array<{ status: string; count: number }>;
  byPayment: Array<{ method: string; count: number; revenue: number }>;
}> {
  const statuses = await query(
    `SELECT status, COUNT(*)::bigint AS count
       FROM orders
      WHERE created_at >= NOW() - make_interval(days => $1::int)
      GROUP BY status
      ORDER BY count DESC`,
    [periodDays]
  );
  const payments = await query(
    `SELECT
        COALESCE(payment_method, 'unknown') AS method,
        COUNT(*)::bigint                    AS count,
        COALESCE(SUM(CASE WHEN ${REVENUE_ORDER_FRAGMENT} THEN total ELSE 0 END), 0) AS revenue
       FROM orders o
      WHERE created_at >= NOW() - make_interval(days => $1::int)
        AND payment_method IS NOT NULL
      GROUP BY payment_method
      ORDER BY revenue DESC`,
    [periodDays]
  );
  return {
    byStatus: statuses.rows.map((r: Record<string, string>) => ({
      status: r.status,
      count: Number(r.count) || 0,
    })),
    byPayment: payments.rows.map((r: Record<string, string>) => ({
      method: r.method,
      count: Number(r.count) || 0,
      revenue: Number(r.revenue) || 0,
    })),
  };
}

/**
 * Vendor leaderboard — aggregates per vendor from `vendor_orders`.
 * Filtered by `vendorType` if provided. Sorted by revenue desc.
 */
export async function getVendorLeaderboard(
  periodDays: PeriodDays,
  vendorType?: string | null
): Promise<VendorLeaderRow[]> {
  const params: Array<string | number> = [periodDays];
  let typeFilter = "";
  if (vendorType && /^[a-z_]+$/.test(vendorType)) {
    params.push(vendorType);
    typeFilter = `AND v.vendor_type = $${params.length}::text`;
  }
  const sql = `
    SELECT
      v.id,
      v.slug,
      v.name_ar                                       AS name,
      v.vendor_type                                   AS vendor_type,
      v.is_active                                     AS is_active,
      COUNT(vo.id)                                    AS orders,
      COALESCE(SUM(vo.total), 0)                      AS revenue,
      COALESCE(AVG(vo.total), 0)                      AS avg_order_value,
      COUNT(DISTINCT COALESCE(vo.customer_id::text, vo.customer_phone)) AS unique_customers
    FROM vendors v
    LEFT JOIN vendor_orders vo
      ON vo.vendor_id = v.id
     AND vo.created_at >= NOW() - make_interval(days => $1::int)
     AND ${VENDOR_REVENUE_FRAGMENT}
    WHERE 1 = 1 ${typeFilter}
    GROUP BY v.id, v.slug, v.name_ar, v.vendor_type, v.is_active
    ORDER BY revenue DESC, v.sort_order ASC, v.name_ar ASC
  `;
  const res = await query(sql, params);
  return res.rows.map((row: Record<string, string | number | boolean>) => ({
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    vendorType: String(row.vendor_type),
    isActive: row.is_active === true || row.is_active === "true",
    orders: Number(row.orders) || 0,
    revenue: Number(row.revenue) || 0,
    avgOrderValue: Number(row.avg_order_value) || 0,
    uniqueCustomers: Number(row.unique_customers) || 0,
  }));
}

/** Daily revenue per vendor for the detail view. */
export async function getVendorDailyStats(
  vendorId: string,
  periodDays: PeriodDays
): Promise<DayPoint[]> {
  const sql = `
    SELECT
      stat_date::text                          AS day,
      orders_count                             AS orders,
      revenue_total                            AS revenue
    FROM vendor_daily_stats
    WHERE vendor_id = $2::uuid
      AND stat_date >= CURRENT_DATE - make_interval(days => $1::int)
    ORDER BY stat_date
  `;
  const res = await query(sql, [periodDays, vendorId]);
  return res.rows.map((row: Record<string, string>) => ({
    day: row.day,
    orders: Number(row.orders) || 0,
    revenue: Number(row.revenue) || 0,
  }));
}

/** Top products for a single vendor. */
export async function getVendorTopProducts(
  vendorId: string,
  periodDays: PeriodDays,
  limit = 10
): Promise<VendorTopProduct[]> {
  const sql = `
    SELECT
      vp.id                                       AS product_id,
      vp.name_ar                                  AS name,
      COALESCE(SUM(voi.quantity), 0)              AS units,
      COALESCE(SUM(voi.line_total), 0)            AS revenue
    FROM vendor_products vp
    LEFT JOIN vendor_order_items voi ON voi.product_id = vp.id
    LEFT JOIN vendor_orders vo
      ON vo.id = voi.order_id
     AND vo.created_at >= NOW() - make_interval(days => $1::int)
     AND ${VENDOR_REVENUE_FRAGMENT}
    WHERE vp.vendor_id = $2::uuid
    GROUP BY vp.id, vp.name_ar
    ORDER BY revenue DESC, units DESC
    LIMIT $3::int
  `;
  const res = await query(sql, [periodDays, vendorId, limit]);
  return res.rows.map((row: Record<string, string>) => ({
    productId: String(row.product_id),
    name: String(row.name),
    units: Number(row.units) || 0,
    revenue: Number(row.revenue) || 0,
  }));
}

/** Vendor summary KPIs (single vendor). */
export async function getVendorSummary(
  vendorId: string,
  periodDays: PeriodDays
): Promise<{
  orders: number;
  revenue: number;
  avgOrderValue: number;
  uniqueCustomers: number;
  cancelledOrders: number;
}> {
  const sql = `
    SELECT
      COUNT(*) FILTER (WHERE ${VENDOR_REVENUE_FRAGMENT})              AS orders,
      COALESCE(SUM(vo.total) FILTER (WHERE ${VENDOR_REVENUE_FRAGMENT}), 0) AS revenue,
      COALESCE(AVG(vo.total) FILTER (WHERE ${VENDOR_REVENUE_FRAGMENT}), 0) AS avg_order_value,
      COUNT(DISTINCT COALESCE(vo.customer_id::text, vo.customer_phone))
        FILTER (WHERE ${VENDOR_REVENUE_FRAGMENT})                       AS unique_customers,
      COUNT(*) FILTER (WHERE vo.status = 'cancelled')                   AS cancelled_orders
    FROM vendor_orders vo
    WHERE vo.vendor_id = $2::uuid
      AND vo.created_at >= NOW() - make_interval(days => $1::int)
  `;
  const res = await query(sql, [periodDays, vendorId]);
  const r = res.rows[0] as Record<string, string>;
  return {
    orders: Number(r.orders) || 0,
    revenue: Number(r.revenue) || 0,
    avgOrderValue: Number(r.avg_order_value) || 0,
    uniqueCustomers: Number(r.unique_customers) || 0,
    cancelledOrders: Number(r.cancelled_orders) || 0,
  };
}
