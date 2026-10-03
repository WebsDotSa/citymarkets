"use client";

// Metrics tab — aggregate of broadcast performance over a selected period,
// plus a per-broadcast drill-down with per-channel breakdown.

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Loader2, RefreshCcw } from "lucide-react";
import { StatCard } from "@/components/admin/admin-header";
import { BarChart, PeriodSelector } from "@/components/admin/charts";
import { SearchableSelect } from "@/components/admin/SearchableSelect";
import { useToast } from "@/components/ui/toast";
import { broadcastApi } from "./api";
import { CHANNELS, type Broadcast, type BroadcastMetrics } from "./types";

interface StatsAgg {
  broadcasts: number;
  delivered: number;
  opened: number;
  clicked: number;
  openRate: number; // 0..1
  clickRate: number; // 0..1
}

function aggregate(broadcasts: Broadcast[]): StatsAgg {
  let broadcastsN = 0;
  let delivered = 0;
  let opened = 0;
  let clicked = 0;
  let deliveredBase = 0; // delivered+opened+clicked (sent deliveries)
  for (const b of broadcasts) {
    const stats = b.stats ?? {};
    broadcastsN += 1;
    delivered += numberOf(stats, "delivered");
    opened += numberOf(stats, "opened");
    clicked += numberOf(stats, "clicked");
    deliveredBase +=
      numberOf(stats, "delivered") +
      numberOf(stats, "opened") +
      numberOf(stats, "clicked") +
      numberOf(stats, "sent");
  }
  return {
    broadcasts: broadcastsN,
    delivered,
    opened,
    clicked,
    openRate: deliveredBase === 0 ? 0 : opened / deliveredBase,
    clickRate: deliveredBase === 0 ? 0 : clicked / deliveredBase,
  };
}

function numberOf(stats: Record<string, unknown>, key: string): number {
  const v = stats[key];
  return typeof v === "number" ? v : 0;
}

export function NotificationsMetricsTab() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");
  const [rows, setRows] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<BroadcastMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    broadcastApi
      .listBroadcasts()
      .then((bs) => {
        if (!cancelled) setRows(bs);
      })
      .catch((err) => {
        if (!cancelled) showToast((err as Error).message || "فشل التحميل", "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const filtered = useMemo(() => {
    const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return rows.filter((b) => Date.parse(b.created_at) >= cutoff);
  }, [rows, period]);

  const agg = useMemo(() => aggregate(filtered), [filtered]);

  useEffect(() => {
    if (!selectedId) {
      setMetrics(null);
      return;
    }
    let cancelled = false;
    setMetricsLoading(true);
    broadcastApi
      .broadcastMetrics(selectedId)
      .then((m) => {
        if (!cancelled) setMetrics(m);
      })
      .catch((err) => {
        if (!cancelled) showToast((err as Error).message || "فشل المؤشرات", "error");
      })
      .finally(() => {
        if (!cancelled) setMetricsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, showToast]);

  const topBroadcasts = useMemo(
    () =>
      [...filtered]
        .sort(
          (a, b) =>
            numberOf(b.stats ?? {}, "delivered") +
            numberOf(b.stats ?? {}, "sent") -
            (numberOf(a.stats ?? {}, "delivered") + numberOf(a.stats ?? {}, "sent")),
        )
        .slice(0, 5)
        .map((b) => ({
          label: b.title,
          value:
            numberOf(b.stats ?? {}, "delivered") + numberOf(b.stats ?? {}, "sent"),
        })),
    [filtered],
  );

  const channelRows = useMemo(() => {
    if (!metrics) return [];
    return Object.entries(metrics.by_channel ?? {}).map(([channel, v]) => ({
      label: CHANNELS.find((c) => c.value === channel)?.label ?? channel,
      value: Number(v.sent ?? 0) + Number(v.failed ?? 0),
      sent: Number(v.sent ?? 0),
      failed: Number(v.failed ?? 0),
      skipped: Number(v.skipped ?? 0),
    }));
  }, [metrics]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-700">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h2 className="font-bold">مؤشرات الأداء</h2>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="عدد الحملات"
          value={loading ? "…" : agg.broadcasts.toLocaleString("ar-SA")}
          icon={<BarChart3 className="text-2xl text-white" />}
          variant="primary"
        />
        <StatCard
          title="تم التسليم"
          value={loading ? "…" : agg.delivered.toLocaleString("ar-SA")}
          icon={<BarChart3 className="text-2xl text-white" />}
          variant="success"
        />
        <StatCard
          title="معدل الفتح"
          value={loading ? "…" : `${(agg.openRate * 100).toFixed(1)}%`}
          icon={<BarChart3 className="text-2xl text-white" />}
          variant="info"
        />
        <StatCard
          title="معدل النقر"
          value={loading ? "…" : `${(agg.clickRate * 100).toFixed(1)}%`}
          icon={<BarChart3 className="text-2xl text-white" />}
          variant="warning"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BarChart
          title="أعلى 5 حملات"
          subtitle={`حسب عدد التسليم خلال آخر ${period === "7d" ? "7" : period === "30d" ? "30" : "90"} يوم`}
          rows={topBroadcasts.map((r) => ({ label: r.label, value: r.value }))}
          valueKey="value"
          labelKey="label"
          emptyText="لا توجد حملات في هذه الفترة"
        />
        <div className="admin-card p-5">
          <h2 className="text-lg font-bold text-gray-800 mb-3">مؤشرات بث محدد</h2>
          <div className="flex items-center gap-2 mb-4">
            <SearchableSelect
              value={selectedId ?? ""}
              onChange={(v) => setSelectedId(v || null)}
              options={filtered.map((b) => ({ value: b.id, label: b.title }))}
              placeholder="— اختر بثاً —"
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => selectedId && setSelectedId(selectedId)}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"
              title="تحديث"
            >
              <RefreshCcw className="w-4 h-4 text-gray-500" />
            </button>
          </div>
          {selectedId === null ? (
            <p className="text-sm text-gray-500">اختر بثاً لعرض المؤشرات التفصيلية.</p>
          ) : metricsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : metrics ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">إرسال</p>
                  <p className="font-bold text-gray-800">{metrics.sent}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">فتح</p>
                  <p className="font-bold text-gray-800">
                    {metrics.opened} ({(metrics.open_rate * 100).toFixed(0)}%)
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">نقر</p>
                  <p className="font-bold text-gray-800">
                    {metrics.clicked} ({(metrics.click_rate * 100).toFixed(0)}%)
                  </p>
                </div>
              </div>
              <BarChart
                title="حسب القناة"
                rows={channelRows.map((r) => ({ label: r.label, value: r.value }))}
                valueKey="value"
                labelKey="label"
                emptyText="لا توجد بيانات لهذه القناة"
              />
              <table className="admin-table text-sm">
                <thead>
                  <tr>
                    <th>القناة</th>
                    <th>أُرسلت</th>
                    <th>فشلت</th>
                    <th>تم تخطيها</th>
                  </tr>
                </thead>
                <tbody>
                  {channelRows.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td className="text-emerald-600">{r.sent}</td>
                      <td className="text-red-600">{r.failed}</td>
                      <td className="text-gray-500">{r.skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">لا توجد مؤشرات.</p>
          )}
        </div>
      </div>
    </div>
  );
}
