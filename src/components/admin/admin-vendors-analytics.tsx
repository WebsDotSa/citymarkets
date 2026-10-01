"use client";

import { useEffect, useState, useCallback, createElement } from "react";
import Link from "next/link";
import {
  Store,
  TrendingUp,
  ShoppingBag,
  CreditCard,
  Users,
  AlertTriangle,
  ChevronLeft,
  Package,
  BarChart3,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import { safeFetchJsonStrict } from "@/lib/safe-fetch";
import { getVendorTypeAr, VENDOR_TYPE_FILTER } from "@/lib/analytics-labels";
import {
  BarChart,
  BarRow,
  PeriodSelector,
  Sparkline,
} from "@/components/admin/charts";

type Period = "7d" | "30d" | "90d";

type VendorRow = {
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

type VendorDetail = {
  vendor: {
    id: string;
    slug: string;
    name: string;
    nameEn: string | null;
    vendorType: string;
    categorySlug: string | null;
    isActive: boolean;
    isFeatured: boolean;
    logoUrl: string | null;
    primaryColor: string | null;
  };
  summary: {
    orders: number;
    revenue: number;
    avgOrderValue: number;
    uniqueCustomers: number;
    cancelledOrders: number;
  };
  daily: Array<{ day: string; orders: number; revenue: number }>;
  topProducts: Array<{
    productId: string;
    name: string;
    units: number;
    revenue: number;
  }>;
};

function formatDay(day: string): string {
  const d = new Date(day);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("ar-SA", { month: "short", day: "numeric" });
}

export function AdminVendorsAnalytics() {
  const [period, setPeriod] = useState<Period>("30d");
  const [vendorType, setVendorType] = useState<string>("");
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VendorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  const loadVendors = useCallback(async () => {
    setLoading(true);
    setError("");
    const result = await safeFetchJsonStrict<{
      success: true;
      vendors: VendorRow[];
    }>(`/api/admin/analytics?period=${period}`, { credentials: "include" });
    if (!result || !result.ok) {
      setError("تعذر تحميل المتاجر");
      setLoading(false);
      return;
    }
    const rows = (result.data.vendors || []).filter((v) =>
      vendorType ? v.vendorType === vendorType : true
    );
    setVendors(rows);
    setLoading(false);
    if (rows.length > 0 && !selectedId) {
      setSelectedId(rows[0].id);
    }
  }, [period, vendorType, selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    const result = await safeFetchJsonStrict<VendorDetail>(
      `/api/admin/vendors/${id}/analytics?period=${period}`,
      { credentials: "include" },
    );
    if (!result || !result.ok) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    setDetail(result.data);
    setDetailLoading(false);
  }, [period]);

  useEffect(() => {
    loadVendors();
  }, [loadVendors]);

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        {error}
      </div>
    );
  }

  const totalRevenue = vendors.reduce((s, v) => s + v.revenue, 0);
  const totalOrders = vendors.reduce((s, v) => s + v.orders, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-secondary">
            إحصائيات المتاجر
          </h1>
          <p className="text-gray-500 mt-1 text-sm leading-relaxed">
            أداء كل متجر، المبيعات، وأفضل المنتجات. يتضمن المتاجر الفاعلة
            والموقوفة.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/admin/analytics"
            className="inline-flex items-center gap-1 px-3 py-2 bg-white border border-gray-200 text-sm font-medium rounded-xl hover:bg-gray-50"
          >
            <ChevronLeft className="w-4 h-4" />
            الإحصائيات العامة
          </Link>
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-600">
          نوع المتجر:
        </span>
        <div className="inline-flex items-center bg-gray-50 rounded-xl p-1 flex-wrap gap-1">
          {VENDOR_TYPE_FILTER.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setVendorType(opt.value);
                setSelectedId(null);
              }}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                vendorType === opt.value
                  ? "bg-primary text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-sm text-gray-500">إجمالي المتاجر</p>
          <p className="text-2xl font-bold text-secondary mt-1 tabular-nums">
            {vendors.length}
          </p>
          <p className="text-xs text-gray-400 mt-2">
            {vendors.filter((v) => v.isActive).length} متجر نشط
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-sm text-gray-500">إيرادات الفترة</p>
          <p className="text-2xl font-bold text-secondary mt-1 tabular-nums">
            {formatPrice(totalRevenue)}
          </p>
          <p className="text-xs text-gray-400 mt-2">
            من {vendors.filter((v) => v.revenue > 0).length} متجر
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-sm text-gray-500">طلبات الفترة</p>
          <p className="text-2xl font-bold text-secondary mt-1 tabular-nums">
            {totalOrders}
          </p>
          <p className="text-xs text-gray-400 mt-2">
            متوسط {formatPrice(totalOrders > 0 ? totalRevenue / totalOrders : 0)}
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white rounded-2xl border border-gray-100">
          <div className="p-5 border-b border-gray-100">
            <h2 className="text-lg font-bold text-secondary flex items-center gap-2">
              <Store className="w-5 h-5" />
              ترتيب المتاجر
            </h2>
          </div>
          <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
            {vendors.length === 0 ? (
              <p className="p-8 text-center text-gray-400 text-sm">
                لا توجد متاجر في هذه الفئة
              </p>
            ) : (
              vendors.map((v, i) => {
                const active = v.id === selectedId;
                return (
                  <button
                    key={v.id}
                    onClick={() => setSelectedId(v.id)}
                    className={`w-full text-right p-4 flex items-center gap-3 transition-colors ${
                      active ? "bg-primary/5" : "hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0 ${
                        active
                          ? "bg-primary text-white"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
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
                      {!v.isActive && (
                        <span className="text-xs text-gray-400">موقوف</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          {detailLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : detail ? (
            <VendorDetailPanel detail={detail} />
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
              اختر متجراً لعرض تفاصيله
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VendorDetailPanel({ detail }: { detail: VendorDetail }) {
  const { vendor, summary, daily, topProducts } = detail;
  const kpis = [
    {
      label: "إيرادات",
      value: formatPrice(summary.revenue),
      sub: `${summary.orders} طلب`,
      icon: TrendingUp,
      color: "from-primary-500 to-primary-600",
    },
    {
      label: "متوسط الطلب",
      value: formatPrice(summary.avgOrderValue),
      sub: `${summary.uniqueCustomers} عميل`,
      icon: CreditCard,
      color: "from-blue-500 to-blue-600",
    },
    {
      label: "الطلبات",
      value: summary.orders,
      sub: `${summary.cancelledOrders} ملغاة`,
      icon: ShoppingBag,
      color: "from-violet-500 to-violet-600",
    },
    {
      label: "ملغاة",
      value: summary.cancelledOrders,
      sub: `${summary.orders > 0 ? formatPercent((summary.cancelledOrders / summary.orders) * 100) : "0%"} من الإجمالي`,
      icon: AlertTriangle,
      color: "from-red-500 to-red-600",
    },
  ];

  const dailyRevenue = daily.map((d) => ({
    label: formatDay(d.day),
    value: d.revenue,
  }));
  const dailyOrders = daily.map((d) => ({
    label: formatDay(d.day),
    value: d.orders,
  }));

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-white flex-shrink-0"
            style={{
              background: vendor.primaryColor || "#009345",
            }}
          >
            <Store className="w-7 h-7" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-secondary">{vendor.name}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {getVendorTypeAr(vendor.vendorType)}
              {vendor.categorySlug && ` · ${vendor.categorySlug}`}
              {vendor.isFeatured && (
                <span className="me-2 inline-flex items-center gap-1 text-amber-600">
                  <BarChart3 className="w-3 h-3" /> مميّز
                </span>
              )}
              {!vendor.isActive && (
                <span className="me-2 text-red-600">· موقوف</span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="bg-white rounded-2xl border border-gray-100 p-5"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">{k.label}</p>
                <p className="text-2xl font-bold text-secondary mt-1 tabular-nums">
                  {k.value}
                </p>
                <p className="text-xs text-gray-400 mt-2">{k.sub}</p>
              </div>
              <div
                className={`w-10 h-10 rounded-xl bg-gradient-to-br ${k.color} flex items-center justify-center flex-shrink-0`}
              >
                {k.icon ? createElement(k.icon, { className: "w-5 h-5 text-white" }) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      {daily.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-6">
          <BarChart
            title="الإيرادات اليومية"
            rows={dailyRevenue}
            valueKey="value"
            labelKey="label"
            formatValue={(v) => formatPrice(v)}
          />
          <BarChart
            title="الطلبات اليومية"
            rows={dailyOrders}
            valueKey="value"
            labelKey="label"
          />
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-secondary flex items-center gap-2">
            <Package className="w-5 h-5" />
            أكثر المنتجات مبيعاً
          </h2>
        </div>
        <div className="divide-y divide-gray-50">
          {topProducts.length === 0 ? (
            <p className="p-8 text-center text-gray-400 text-sm">
              لا توجد مبيعات بعد
            </p>
          ) : (
            topProducts.map((p, i) => (
              <div key={p.productId} className="p-4 flex items-center gap-4">
                <span className="w-7 h-7 rounded-lg bg-gray-100 text-xs font-bold flex items-center justify-center text-gray-500">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-secondary truncate">
                    {p.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {p.units} وحدة
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-secondary tabular-nums">
                    {formatPrice(p.revenue)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

// silence unused-import lint for Icons we render transitively
void Users;
void Sparkline;
