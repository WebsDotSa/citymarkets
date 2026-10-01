"use client";

import { useEffect, useMemo, useState } from "react";
import { Award, Coins, TrendingUp, TrendingDown, Save } from "lucide-react";
import { csrfFetch } from "@/lib/csrf-client";

interface LoyaltySettings {
  enabled: boolean;
  earn_points_per_sar: number;
  redeem_value_per_point: number;
  min_redeem_points: number;
  max_redeem_percent: number;
}

interface LoyaltyStats {
  members: number;
  total_balance: number;
  total_earned: number;
  total_redeemed: number;
  last_7_days: Record<string, { count: number; volume: number }>;
}

const adminCred: RequestInit = { credentials: "include" };

export function AdminLoyalty() {
  const [settings, setSettings] = useState<LoyaltySettings | null>(null);
  const [defaults, setDefaults] = useState<LoyaltySettings | null>(null);
  const [stats, setStats] = useState<LoyaltyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  useEffect(() => {
    fetch("/api/admin/loyalty", adminCred)
      .then((r) => r.json())
      .then((res) => {
        if (!res.success) throw new Error(res.error || "fetch failed");
        setSettings(res.settings);
        setDefaults(res.defaults);
        setStats(res.stats);
      })
      .catch((err: unknown) =>
        setMessage({
          kind: "err",
          text: err instanceof Error ? err.message : "حصل خطأ",
        }),
      )
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await csrfFetch("/api/admin/loyalty", {
        ...adminCred,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "فشل الحفظ");
      }
      setSettings(json.settings);
      setMessage({ kind: "ok", text: "تم حفظ الإعدادات" });
    } catch (err: unknown) {
      setMessage({
        kind: "err",
        text: err instanceof Error ? err.message : "حصل خطأ",
      });
    } finally {
      setSaving(false);
    }
  };

  // Marketing-friendly summary: "100 pts = 5 SAR" — keeps the copy
  // in lockstep with what the /profile/loyalty page renders.
  const preview = useMemo(() => {
    if (!settings) return null;
    const pts = settings.min_redeem_points;
    const sar = (pts * settings.redeem_value_per_point).toFixed(2);
    const capPct = Math.round(settings.max_redeem_percent * 100);
    return { pts, sar, capPct };
  }, [settings]);

  if (loading || !settings) {
    return <p className="text-gray-500">جاري التحميل…</p>;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Award className="w-7 h-7 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">نقاط الولاء</h1>
          <p className="text-sm text-gray-500">
            إعدادات برنامج الولاء — التعديلات تنعكس على الطلبات القادمة فوراً.
          </p>
        </div>
      </header>

      {message && (
        <div
          className={
            "rounded-xl p-3 text-sm " +
            (message.kind === "ok"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-red-50 text-red-700 border border-red-200")
          }
        >
          {message.text}
        </div>
      )}

      {stats && (
        <section className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              icon={<Coins className="w-5 h-5 text-amber-600" />}
              label="إجمالي الأعضاء"
              value={stats.members.toLocaleString("ar-SA")}
            />
            <StatCard
              icon={<Award className="w-5 h-5 text-amber-500" />}
              label="رصيد النقاط الحالي"
              value={stats.total_balance.toLocaleString("ar-SA")}
            />
            <StatCard
              icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
              label="نقاط مكتسبة (تراكمي)"
              value={stats.total_earned.toLocaleString("ar-SA")}
            />
            <StatCard
              icon={<TrendingDown className="w-5 h-5 text-red-600" />}
              label="نقاط مستبدلة (تراكمي)"
              value={stats.total_redeemed.toLocaleString("ar-SA")}
            />
          </div>
          {stats.last_7_days && Object.keys(stats.last_7_days).length > 0 && (
            <Last7DaysChart data={stats.last_7_days} />
          )}
        </section>
      )}

      <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">الإعدادات</h2>
          {defaults && (
            <button
              type="button"
              onClick={() => setSettings({ ...defaults })}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              استعادة الافتراضي
            </button>
          )}
        </div>

        <label
          htmlFor="loyalty-enabled"
          className="flex items-center gap-3 text-sm"
        >
          <input
            id="loyalty-enabled"
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) =>
              setSettings({ ...settings, enabled: e.target.checked })
            }
            className="w-4 h-4 accent-primary"
          />
          <span>تفعيل برنامج الولاء</span>
        </label>

        <Field
          label="نقاط لكل ريال (الكسب)"
          help="مثال: 0.1 يعني 10 ر.س = 1 نقطة"
          htmlFor="loyalty-earn-points-per-sar"
        >
          <input
            id="loyalty-earn-points-per-sar"
            type="number"
            step="0.01"
            min={0}
            value={settings.earn_points_per_sar}
            onChange={(e) =>
              setSettings({
                ...settings,
                earn_points_per_sar: Number(e.target.value),
              })
            }
            className="w-full h-10 px-3 border border-gray-200 rounded-xl"
            dir="ltr"
          />
        </Field>

        <Field
          label="قيمة النقطة بالريال (الاستبدال)"
          help="مثال: 0.05 يعني 100 نقطة = 5 ر.س"
          htmlFor="loyalty-redeem-value-per-point"
        >
          <input
            id="loyalty-redeem-value-per-point"
            type="number"
            step="0.01"
            min={0}
            value={settings.redeem_value_per_point}
            onChange={(e) =>
              setSettings({
                ...settings,
                redeem_value_per_point: Number(e.target.value),
              })
            }
            className="w-full h-10 px-3 border border-gray-200 rounded-xl"
            dir="ltr"
          />
        </Field>

        <Field
          label="الحد الأدنى للاستبدال (نقاط)"
          help="يُمنع المستخدم من استبدال أقل من هذا العدد"
          htmlFor="loyalty-min-redeem-points"
        >
          <input
            id="loyalty-min-redeem-points"
            type="number"
            step="10"
            min={0}
            value={settings.min_redeem_points}
            onChange={(e) =>
              setSettings({
                ...settings,
                min_redeem_points: Number(e.target.value),
              })
            }
            className="w-full h-10 px-3 border border-gray-200 rounded-xl"
            dir="ltr"
          />
        </Field>

        <Field
          label="سقف الاستخدام من الطلب (نسبة)"
          help="الحد الأعلى من قيمة الطلب الذي يمكن دفعه بالنقاط (0.5 = 50%)"
          htmlFor="loyalty-max-redeem-percent"
        >
          <input
            id="loyalty-max-redeem-percent"
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={settings.max_redeem_percent}
            onChange={(e) =>
              setSettings({
                ...settings,
                max_redeem_percent: Number(e.target.value),
              })
            }
            className="w-full h-10 px-3 border border-gray-200 rounded-xl"
            dir="ltr"
          />
        </Field>

        {preview && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            المعاينة: كل {preview.pts} نقطة = {preview.sar} ر.س خصم، بسقف{" "}
            {preview.capPct}% من الطلب.
          </div>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? "جاري الحفظ…" : "حفظ"}
        </button>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center">
        {icon}
      </div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-lg font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  help,
  htmlFor,
  children,
}: {
  label: string;
  help?: string;
  /** Optional `htmlFor` to associate the inner input with the visible label (a11y). */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-gray-700 mb-1"
      >
        {label}
      </label>
      {children}
      {help && <p className="text-xs text-gray-400 mt-1">{help}</p>}
    </div>
  );
}

/**
 * Last-7-days timeline: shows daily earn count + volume.
 * Sorts by date ASC so the chart reads left-to-right.
 * Renders empty days as "—" so the timeline stays continuous.
 */
function Last7DaysChart({
  data,
}: {
  data: Record<string, { count: number; volume: number }>;
}) {
  const entries = useMemo(() => {
    const keys = Object.keys(data).sort();
    return keys.map((k) => ({
      day: k,
      count: data[k]?.count ?? 0,
      volume: data[k]?.volume ?? 0,
    }));
  }, [data]);

  const maxVolume = Math.max(1, ...entries.map((e) => e.volume));

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">
          آخر 7 أيام — نشاط الولاء
        </h3>
        <p className="text-xs text-gray-500">
          ارتفاع الشريط = حجم النقاط المكتسبة
        </p>
      </div>
      <div className="grid grid-cols-7 gap-2 items-end h-32">
        {entries.map((e) => {
          const pct = (e.volume / maxVolume) * 100;
          const date = new Date(e.day);
          const dayLabel = date.toLocaleDateString("ar-SA", {
            weekday: "short",
          });
          return (
            <div
              key={e.day}
              className="flex flex-col items-center gap-1 group"
              title={`${e.day}: ${e.count} عملية، ${e.volume} نقطة`}
            >
              <div className="relative w-full flex items-end justify-center h-24">
                {e.volume > 0 ? (
                  <div
                    className="w-full bg-emerald-100 rounded-t-md group-hover:bg-emerald-200 transition-colors"
                    style={{ height: `${pct}%` }}
                  />
                ) : (
                  <div className="w-full h-px bg-gray-200" />
                )}
              </div>
              <div className="text-center">
                <p className="text-[10px] font-medium text-gray-700">
                  {dayLabel}
                </p>
                <p className="text-[10px] text-gray-400">
                  {e.volume > 0 ? e.volume : "—"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
