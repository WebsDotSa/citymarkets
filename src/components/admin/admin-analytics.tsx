"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp,
  ShoppingBag,
  Users,
  CreditCard,
  BarChart3,
  Calendar,
  Eye,
  Globe,
  Package,
  AlertTriangle,
  Tag,
  Star,
  Bell,
  Tags,
  ArrowUpRight,
} from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { safeFetchJsonStrict } from "@/lib/safe-fetch";
import { getOrderStatusConfig, PAYMENT_METHOD_AR } from '@/lib/orders';
import {
  ANALYTICS_TABS,
  getCountryAr,
  getVendorTypeAr,
  METRIC_LABELS,
} from "@/lib/analytics-labels";
import { BarChart, BarRow, PeriodSelector, Sparkline } from "@/components/admin/charts";

type Period = "7d" | "30d" | "90d";

type Overview = {
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
  activeCustomers: number;
  products: number;
  lowStockProducts: number;
  categories: number;
  users: number;
  activeCoupons: number;
  activeBanners: number;
};

type AnalyticsPayload = {
  period: Period;
  generatedAt: string;
  overview: Overview;
  ordersByDay: Array<{ day: string; orders: number; revenue: number }>;
  visitorsByDay: Array<{ day: string; views: number; uniqueSessions: number }>;
  topPages: Array<{ path: string; views: number; uniqueSessions: number }>;
  topCountries: Array<{ country: string; views: number }>;
  topProducts: Array<{
    id: string;
    name: string;
    image: string | null;
    units: number;
    revenue: number;
  }>;
  ordersByStatus: Array<{ status: string; count: number }>;
  paymentBreakdown: Array<{ method: string; count: number; revenue: number }>;
  vendors: Array<{
    id: string;
    slug: string;
    name: string;
    vendorType: string;
    isActive: boolean;
    orders: number;
    revenue: number;
    avgOrderValue: number;
    uniqueCustomers: number;
  }>;
};

const PAYMENT_AR: Record<string, string> = {
  ...PAYMENT_METHOD_AR,
  moyasar: "ميسر",
  wallet: "محفظة",
  unknown: "غير محدد",
};

function formatDay(day: string): string {
  // Server returns YYYY-MM-DD or DATE() string; toLocaleDateString parses both.
  const d = new Date(day);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("ar-SA", { month: "short", day: "numeric" });
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

export function AdminAnalytics() {
  const [period, setPeriod] = useState<Period>("30d");
  const [tab, setTab] = useState<(typeof ANALYTICS_TABS)[number]["value"]>("overview");
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError("");
    const result = await safeFetchJsonStrict<AnalyticsPayload>(
      `/api/admin/analytics?period=${p}`,
      { credentials: "include" },
    );
    if (!result) {
      setError("تعذر الاتصال بالخادم");
      setLoading(false);
      return;
    }
    if (!result.ok) {
      const body = (result.body as { error?: string } | null) || null;
      setError(body?.error || "فشل تحميل الإحصائيات");
      setLoading(false);
      return;
    }
    setData(result.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load(period);
  }, [period, load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        {error || "لا توجد بيانات"}
      </div>
    );
  }

  const overview = data.overview;
  const visitorsSize = data.visitorsByDay.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-secondary">
            الإحصائيات والتحليلات
          </h1>
          <p className="text-gray-500 mt-1 text-sm leading-relaxed">
            طلبات مؤكدة ومدفوعة إلكترونياً فقط تُحتسب في الإيرادات. الزوار
            والإحصاءات الأخرى تشمل الفترة المختارة.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodSelector value={period} onChange={setPeriod} />
          <Link
            href="/admin/vendors/analytics"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-sm font-medium rounded-xl hover:bg-gray-50"
          >
            <BarChart3 className="w-4 h-4" />
            المتاجر
          </Link>
          <Link
            href="/admin/notifications"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-sm font-medium rounded-xl hover:bg-gray-50"
          >
            <Bell className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div className="admin-tabs">
        {ANALYTICS_TABS.map((t) => (
          <button
            key={t.value}
            className={`admin-tab ${tab === t.value ? "admin-tab-active" : ""}`}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab
          overview={overview}
          ordersByDay={data.ordersByDay}
          visitorsByDay={data.visitorsByDay}
          visitorsSize={visitorsSize}
          vendors={data.vendors}
        />
      )}
      {tab === "visitors" && (
        <VisitorsTab
          overview={overview}
          visitorsByDay={data.visitorsByDay}
          topPages={data.topPages}
          topCountries={data.topCountries}
        />
      )}
      {tab === "orders" && (
        <OrdersTab
          ordersByDay={data.ordersByDay}
          ordersByStatus={data.ordersByStatus}
          paymentBreakdown={data.paymentBreakdown}
        />
      )}
      {tab === "products" && (
        <ProductsTab topProducts={data.topProducts} overview={overview} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab subcomponents
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-secondary mt-1 tabular-nums">
            {value}
          </p>
          {sub && <p className="text-xs text-gray-400 mt-2">{sub}</p>}
        </div>
        <div
          className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center flex-shrink-0`}
        >
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}

function OverviewTab({
  overview,
  ordersByDay,
  visitorsByDay,
  visitorsSize,
  vendors,
}: {
  overview: Overview;
  ordersByDay: AnalyticsPayload["ordersByDay"];
  visitorsByDay: AnalyticsPayload["visitorsByDay"];
  visitorsSize: number;
  vendors: AnalyticsPayload["vendors"];
}) {
  const kpis = [
    {
      label: METRIC_LABELS.revenue,
      value: formatPrice(overview.revenueElectronic),
      sub: `${overview.ordersConfirmed} طلب مؤكد`,
      icon: TrendingUp,
      color: "from-primary-500 to-primary-600",
    },
    {
      label: METRIC_LABELS.orders,
      value: overview.ordersTotal,
      sub: `${overview.ordersToday} طلب اليوم`,
      icon: ShoppingBag,
      color: "from-blue-500 to-blue-600",
    },
    {
      label: METRIC_LABELS.averageOrder,
      value: formatPrice(overview.averageOrderValue),
      sub: `${overview.activeCustomers} عميل نشط`,
      icon: CreditCard,
      color: "from-violet-500 to-violet-600",
    },
    {
      label: METRIC_LABELS.visitors,
      value: overview.visitorsUnique,
      sub: `${overview.pageViews} مشاهدة`,
      icon: Users,
      color: "from-amber-500 to-amber-600",
    },
    {
      label: METRIC_LABELS.conversion,
      value: formatPercent(overview.conversionRate),
      sub: `من ${overview.visitorsUnique} زائر`,
      icon: TrendingUp,
      color: "from-emerald-500 to-emerald-600",
    },
    {
      label: METRIC_LABELS.cancelled,
      value: overview.ordersCancelled,
      sub: `${overview.ordersWeek} طلب هذا الأسبوع`,
      icon: AlertTriangle,
      color: "from-red-500 to-red-600",
    },
  ];

  const revenueRows = ordersByDay.map((d) => ({
    label: formatDay(d.day),
    value: d.revenue,
  }));
  const orderRows = ordersByDay.map((d) => ({
    label: formatDay(d.day),
    value: d.orders,
  }));

  const topVendors = [...vendors]
    .filter((v) => v.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {kpis.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <BarChart
          title="الإيرادات الإلكترونية للفترة"
          subtitle={`${ordersByDay.length} يوم`}
          rows={revenueRows}
          valueKey="value"
          labelKey="label"
          formatValue={(v) => formatPrice(v)}
        />
        <BarChart
          title="الطلبات للفترة"
          subtitle={`${ordersByDay.length} يوم`}
          rows={orderRows}
          valueKey="value"
          labelKey="label"
        />
      </div>

      {visitorsSize > 0 && (
        <div className="grid lg:grid-cols-2 gap-6">
          <BarChart
            title="مشاهدات الزوار"
            rows={visitorsByDay.map((d) => ({
              label: formatDay(d.day),
              value: d.views,
            }))}
            valueKey="value"
            labelKey="label"
          />
          <BarChart
            title="جلسات فريدة"
            rows={visitorsByDay.map((d) => ({
              label: formatDay(d.day),
              value: d.uniqueSessions,
            }))}
            valueKey="value"
            labelKey="label"
          />
        </div>
      )}

      {topVendors.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-secondary">
                أفضل المتاجر أداءً
              </h2>
              <p className="text-xs text-gray-400 mt-1">
                مبيعات الفترة الحالية (مؤكدة + مدفوعة)
              </p>
            </div>
            <Link
              href="/admin/vendors/analytics"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              لوحة المتاجر
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {topVendors.map((v, i) => (
              <div key={v.id} className="p-4 flex items-center gap-4">
                <span className="w-7 h-7 rounded-lg bg-gray-100 text-xs font-bold flex items-center justify-center text-gray-500">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-secondary truncate">
                    {v.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {getVendorTypeAr(v.vendorType)} · {v.orders} طلب
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-secondary tabular-nums">
                    {formatPrice(v.revenue)}
                  </p>
                  <p className="text-xs text-gray-400">
                    متوسط {formatPrice(v.avgOrderValue)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VisitorsTab({
  overview,
  visitorsByDay,
  topPages,
  topCountries,
}: {
  overview: Overview;
  visitorsByDay: AnalyticsPayload["visitorsByDay"];
  topPages: AnalyticsPayload["topPages"];
  topCountries: AnalyticsPayload["topCountries"];
}) {
  const kpis = [
    {
      label: METRIC_LABELS.pageViews,
      value: overview.pageViews,
      sub: "كل الزيارات في الفترة",
      icon: Eye,
      color: "from-blue-500 to-blue-600",
    },
    {
      label: METRIC_LABELS.uniqueSessions,
      value: overview.visitorsUnique,
      sub: "جلسات فريدة",
      icon: Users,
      color: "from-primary-500 to-primary-600",
    },
    {
      label: METRIC_LABELS.topCountry,
      value: topCountries[0] ? getCountryAr(topCountries[0].country) : "—",
      sub: topCountries[0] ? `${topCountries[0].views} زيارة` : "—",
      icon: Globe,
      color: "from-emerald-500 to-emerald-600",
    },
    {
      label: METRIC_LABELS.pagesPerSession,
      value:
        overview.visitorsUnique > 0
          ? (overview.pageViews / overview.visitorsUnique).toFixed(1)
          : "0",
      sub: "متوسط المشاهدات لكل زائر",
      icon: BarChart3,
      color: "from-violet-500 to-violet-600",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>

      {visitorsByDay.length > 0 && (
        <BarChart
          title="مشاهدات الصفحات يومياً"
          rows={visitorsByDay.map((d) => ({
            label: formatDay(d.day),
            value: d.views,
          }))}
          valueKey="value"
          labelKey="label"
        />
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-gray-100">
          <div className="p-5 border-b border-gray-100">
            <h2 className="text-lg font-bold text-secondary">أكثر الصفحات زيارة</h2>
          </div>
          <div className="p-5">
            {topPages.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">
                لا توجد بيانات
              </p>
            ) : (
              <div className="space-y-3">
                {topPages.map((p, i) => {
                  const max = Math.max(...topPages.map((x) => x.views), 1);
                  return (
                    <BarRow
                      key={p.path}
                      label={`${i + 1}. ${p.path}`}
                      value={p.views}
                      max={max}
                      suffix={`${p.views} · ${p.uniqueSessions} زائر`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100">
          <div className="p-5 border-b border-gray-100">
            <h2 className="text-lg font-bold text-secondary">الزيارات حسب الدولة</h2>
          </div>
          <div className="p-5">
            {topCountries.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">
                لا توجد بيانات
              </p>
            ) : (
              <div className="space-y-3">
                {topCountries.map((c) => {
                  const max = Math.max(...topCountries.map((x) => x.views), 1);
                  return (
                    <BarRow
                      key={c.country}
                      label={getCountryAr(c.country)}
                      value={c.views}
                      max={max}
                      suffix={`${c.views}`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OrdersTab({
  ordersByDay,
  ordersByStatus,
  paymentBreakdown,
}: {
  ordersByDay: AnalyticsPayload["ordersByDay"];
  ordersByStatus: AnalyticsPayload["ordersByStatus"];
  paymentBreakdown: AnalyticsPayload["paymentBreakdown"];
}) {
  const kpis = [
    {
      label: METRIC_LABELS.orders,
      value: ordersByDay.reduce((sum, d) => sum + d.orders, 0),
      sub: "إجمالي الفترة",
      icon: ShoppingBag,
      color: "from-blue-500 to-blue-600",
    },
    {
      label: "نشط",
      value: ordersByStatus
        .filter((s) => s.status !== "cancelled" && s.status !== "delivered")
        .reduce((sum, s) => sum + s.count, 0),
      sub: "قيد المعالجة",
      icon: Calendar,
      color: "from-amber-500 to-amber-600",
    },
    {
      label: "مكتمل",
      value: ordersByStatus
        .filter((s) => s.status === "delivered")
        .reduce((sum, s) => sum + s.count, 0),
      sub: "تم التوصيل",
      icon: TrendingUp,
      color: "from-emerald-500 to-emerald-600",
    },
    {
      label: METRIC_LABELS.cancelled,
      value: ordersByStatus
        .filter((s) => s.status === "cancelled")
        .reduce((sum, s) => sum + s.count, 0),
      sub: "ملغاة",
      icon: AlertTriangle,
      color: "from-red-500 to-red-600",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <BarChart
          title="الطلبات يومياً"
          rows={ordersByDay.map((d) => ({
            label: formatDay(d.day),
            value: d.orders,
          }))}
          valueKey="value"
          labelKey="label"
        />
        <BarChart
          title="الطلبات حسب الحالة"
          rows={ordersByStatus.map((s) => ({
            label: getOrderStatusConfig(s.status).label,
            value: s.count,
          }))}
          valueKey="value"
          labelKey="label"
        />
      </div>

      <BarChart
        title="الإيراد حسب طريقة الدفع (مؤكدة + إلكتروني)"
        rows={paymentBreakdown.map((p) => ({
          label: PAYMENT_AR[p.method] || p.method,
          value: p.revenue,
        }))}
        valueKey="value"
        labelKey="label"
        formatValue={(v) => formatPrice(v)}
      />
    </div>
  );
}

function ProductsTab({
  topProducts,
  overview,
}: {
  topProducts: AnalyticsPayload["topProducts"];
  overview: Overview;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="المنتجات النشطة"
          value={overview.products}
          sub="متاحة للبيع"
          icon={Package}
          color="from-primary-500 to-primary-600"
        />
        <KpiCard
          label="المخزون المنخفض"
          value={overview.lowStockProducts}
          sub="منتج بحاجة لإعادة طلب"
          icon={AlertTriangle}
          color="from-amber-500 to-amber-600"
        />
        <KpiCard
          label="الفئات"
          value={overview.categories}
          sub="نشطة"
          icon={Tags}
          color="from-violet-500 to-violet-600"
        />
        <KpiCard
          label="كوبونات نشطة"
          value={overview.activeCoupons}
          sub="صالحة للاستخدام"
          icon={Tag}
          color="from-blue-500 to-blue-600"
        />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-secondary">الأكثر مبيعاً</h2>
            <p className="text-xs text-gray-400 mt-1">
              من طلبات مؤكدة ومدفوعة إلكترونياً
            </p>
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          {topProducts.length === 0 ? (
            <p className="p-8 text-center text-gray-400 text-sm">
              لا توجد مبيعات بعد
            </p>
          ) : (
            topProducts.map((p, idx) => (
              <Link
                key={p.id}
                href={`/admin/products/${p.id}/edit`}
                className="p-4 flex items-center gap-4 hover:bg-gray-50/50 transition-colors"
              >
                <span className="w-7 h-7 rounded-lg bg-gray-100 text-xs font-bold flex items-center justify-center text-gray-500">
                  {idx + 1}
                </span>
                {p.image && (
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.image}
                      alt={p.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-secondary truncate">
                    {p.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {p.units} وحدة · {formatPrice(p.revenue)}
                  </p>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h2 className="text-lg font-bold text-secondary mb-4">روابط سريعة</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Link
            href="/admin/products"
            className="rounded-xl border border-gray-200 p-4 text-center hover:border-primary"
          >
            <Package className="w-5 h-5 mx-auto text-gray-500" />
            <p className="text-sm font-medium mt-2">المنتجات</p>
          </Link>
          <Link
            href="/admin/categories"
            className="rounded-xl border border-gray-200 p-4 text-center hover:border-primary"
          >
            <Tags className="w-5 h-5 mx-auto text-gray-500" />
            <p className="text-sm font-medium mt-2">الفئات</p>
          </Link>
          <Link
            href="/admin/coupons"
            className="rounded-xl border border-gray-200 p-4 text-center hover:border-primary"
          >
            <Tag className="w-5 h-5 mx-auto text-gray-500" />
            <p className="text-sm font-medium mt-2">الكوبونات</p>
          </Link>
          <Link
            href="/admin/reviews"
            className="rounded-xl border border-gray-200 p-4 text-center hover:border-primary"
          >
            <Star className="w-5 h-5 mx-auto text-gray-500" />
            <p className="text-sm font-medium mt-2">تقييمات</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
