"use client";

import { useState, useEffect, useCallback } from "react";
import {
  TrendingUp,
  Truck,
  Wallet,
  CreditCard,
  CheckCircle,
  XCircle,
  RefreshCw,
  BarChart3,
  Calendar,
  Sparkles,
} from "lucide-react";
import { DriverLayout } from "@/components/admin/driver-layout";
import { BarChart, PeriodSelector, Sparkline } from "@/components/admin/charts";
import { formatPrice } from "@/lib/format";

interface Totals {
  deliveries: number;
  cancellations: number;
  handled_total: number;
  gross_revenue: number;
  delivery_fees: number;
  cod_revenue: number;
  online_revenue: number;
  avg_order_value: number;
  success_rate: number;
}

interface DailyPoint {
  day: string;
  deliveries: number;
  revenue: number;
}

interface EarningsResponse {
  success: boolean;
  period: 7 | 30 | 90;
  totals: Totals;
  by_payment_method: {
    cod: { count: number; amount: number };
    online: { count: number; amount: number };
  };
  daily: DailyPoint[];
  error?: string;
}

type PeriodKey = "7d" | "30d" | "90d";

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
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-secondary mt-1 tabular-nums">
            {value}
          </p>
          {sub ? <p className="text-xs text-gray-400 mt-1.5">{sub}</p> : null}
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

export default function DriverEarningsPage() {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const periodDays: 7 | 30 | 90 =
    period === "7d" ? 7 : period === "90d" ? 90 : 30;

  const fetchEarnings = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/driver/earnings?period=${periodDays}`,
          { credentials: "include", signal },
        );
        const json = (await res.json()) as EarningsResponse;
        if (signal?.aborted) return;
        if (!res.ok || !json.success) {
          setError(json.error || "تعذر جلب الأرباح");
          setData(null);
          return;
        }
        setData(json);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setError("تعذر الاتصال بالخادم");
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [periodDays],
  );

  useEffect(() => {
    const ac = new AbortController();
    void fetchEarnings(ac.signal);
    return () => ac.abort();
  }, [fetchEarnings]);

  // Pad missing days so the chart shows zeros instead of gaps. We don't want
  // drivers to think they had no activity on quiet days when it's just the
  // data shape (server only returns rows with at least one delivery).
  const paddedDaily: DailyPoint[] = (() => {
    if (!data) return [];
    const byKey = new Map(data.daily.map((d) => [d.day, d]));
    const out: DailyPoint[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = periodDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      out.push(
        byKey.get(key) ?? { day: key, deliveries: 0, revenue: 0 },
      );
    }
    return out;
  })();

  const totals = data?.totals;
  const sparkValues = paddedDaily.map((d) => d.revenue);

  return (
    <DriverLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-secondary flex items-center gap-2">
              <Wallet className="w-6 h-6 text-primary" />
              أرباحي
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              ملخص التوصيلات والإيرادات للفترة المختارة
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PeriodSelector value={period} onChange={setPeriod} />
            <button
              onClick={() => void fetchEarnings()}
              className="p-2 bg-white rounded-lg shadow hover:bg-gray-50 border border-gray-200"
              disabled={loading}
              aria-label="تحديث"
            >
              <RefreshCw
                className={`w-5 h-5 text-gray-600 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        {/* Error */}
        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {/* Sparkline summary — sits above KPIs so the trend is visible at a glance */}
        {totals ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm text-gray-500 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  اتجاه الإيرادات (آخر {periodDays} يوم)
                </p>
                <p className="text-2xl font-bold text-secondary mt-1 tabular-nums">
                  {formatPrice(totals.gross_revenue)}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {totals.deliveries} توصيلة منجزة •{" "}
                  {formatPrice(totals.delivery_fees)} رسوم توصيل
                </p>
              </div>
              <div className="text-primary">
                <Sparkline values={sparkValues} width={180} height={48} />
              </div>
            </div>
          </div>
        ) : null}

        {/* KPI grid */}
        {totals ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="التوصيلات المنجزة"
              value={totals.deliveries}
              sub={`من أصل ${totals.handled_total} طلب`}
              icon={CheckCircle}
              color="from-emerald-500 to-emerald-600"
            />
            <KpiCard
              label="إجمالي المبيعات"
              value={formatPrice(totals.gross_revenue)}
              sub={`${formatPrice(totals.avg_order_value)} متوسط الطلب`}
              icon={TrendingUp}
              color="from-primary-500 to-primary-600"
            />
            <KpiCard
              label="رسوم التوصيل"
              value={formatPrice(totals.delivery_fees)}
              sub="المحفوظة لصالحك"
              icon={Truck}
              color="from-sky-500 to-sky-600"
            />
            <KpiCard
              label="نسبة النجاح"
              value={`${totals.success_rate.toFixed(0)}%`}
              sub={`${totals.cancellations} إلغاء`}
              icon={XCircle}
              color="from-amber-500 to-amber-600"
            />
          </div>
        ) : null}

        {/* Charts row */}
        {totals ? (
          <div className="grid lg:grid-cols-2 gap-5">
            <BarChart
              title="الإيرادات اليومية"
              subtitle={`${paddedDaily.length} يوم`}
              rows={paddedDaily.map((d) => ({
                label: new Date(d.day).toLocaleDateString("ar-SA", {
                  day: "2-digit",
                  month: "2-digit",
                }),
                value: d.revenue,
              }))}
              valueKey="value"
              labelKey="label"
              formatValue={(v) => formatPrice(v)}
              emptyText="لا توجد توصيلات في هذه الفترة"
            />
            <BarChart
              title="عدد التوصيلات اليومي"
              subtitle={`${paddedDaily.length} يوم`}
              rows={paddedDaily.map((d) => ({
                label: new Date(d.day).toLocaleDateString("ar-SA", {
                  day: "2-digit",
                  month: "2-digit",
                }),
                value: d.deliveries,
              }))}
              valueKey="value"
              labelKey="label"
              formatValue={(v) => `${v} طلب`}
              emptyText="لا توجد توصيلات في هذه الفترة"
            />
          </div>
        ) : null}

        {/* Payment-method breakdown */}
        {totals ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <h2 className="text-lg font-bold text-secondary flex items-center gap-2 mb-4">
              <CreditCard className="w-5 h-5 text-primary" />
              توزيع طرق الدفع
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-primary-100 bg-primary-50/40 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet className="w-4 h-4 text-primary-700" />
                  <span className="text-sm font-semibold text-primary-900">
                    الدفع نقداً
                  </span>
                </div>
                <p className="text-xl font-bold text-primary-700 tabular-nums">
                  {formatPrice(totals.cod_revenue)}
                </p>
                <p className="text-xs text-primary-700/70 mt-1">
                  {data?.by_payment_method.cod.count ?? 0} طلب
                </p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CreditCard className="w-4 h-4 text-sky-700" />
                  <span className="text-sm font-semibold text-sky-900">
                    الدفع الإلكتروني
                  </span>
                </div>
                <p className="text-xl font-bold text-sky-700 tabular-nums">
                  {formatPrice(totals.online_revenue)}
                </p>
                <p className="text-xs text-sky-700/70 mt-1">
                  {data?.by_payment_method.online.count ?? 0} طلب
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {loading && !data ? (
          <div className="flex justify-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : null}

        {/* Empty-state nudge for brand-new drivers */}
        {!loading && totals && totals.deliveries === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center border border-gray-100">
            <BarChart3 className="w-10 h-10 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-600 font-medium">
              لا توجد توصيلات منجزة بعد في هذه الفترة
            </p>
            <p className="text-xs text-gray-400 mt-1 flex items-center justify-center gap-1">
              <Calendar className="w-3 h-3" />
              جرّب توسيع النطاق إلى 90 يوم
            </p>
          </div>
        ) : null}
      </div>
    </DriverLayout>
  );
}
