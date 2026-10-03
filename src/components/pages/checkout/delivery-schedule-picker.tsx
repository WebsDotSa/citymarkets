"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar, Clock, Zap, Loader2, Check } from "lucide-react";

/**
 * Scheduled delivery picker.
 *
 * Two-mode UI:
 *   - "توصيل فوري" (express): no slot, orders ship ASAP.
 *   - "جدولة الطلب" (scheduled): user picks a Riyadh date + one of the
 *     4 windows the API returns.
 *
 * Calls `GET /api/v1/delivery/slots?date=YYYY-MM-DD` whenever the
 * selected date changes, falling back gracefully on network errors.
 *
 * `enabled` controls whether the scheduled branch is even offered
 * (the server may have `delivery_settings.slots.enabled = false` —
 * in that case this component renders only the express toggle).
 */

type SlotWindow = {
  id: string;
  label_ar: string;
  start: string; // HH:MM Riyadh
  end: string;
  start_at: string; // ISO UTC
  end_at: string;
  capacity: number;
  booked: number;
  available: boolean;
};

type SlotsResponse = {
  success: true;
  data: {
    date: string;
    timezone: string;
    enabled: boolean;
    lead_time_minutes: number;
    min_date: string;
    max_date: string;
    zone_id: string | null;
    windows: SlotWindow[];
  };
};

export type ScheduledSelection =
  | { mode: "express" }
  | { mode: "scheduled"; slot_id: string; scheduled_for: string /* ISO UTC */; label_ar: string; date: string };

export function DeliverySchedulePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: ScheduledSelection;
  onChange: (v: ScheduledSelection) => void;
  disabled?: boolean;
}) {
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [slotsEnabled, setSlotsEnabled] = useState(false);
  const [dateKey, setDateKey] = useState<string | null>(null);
  const [minDate, setMinDate] = useState<string | null>(null);
  const [maxDate, setMaxDate] = useState<string | null>(null);
  const [windows, setWindows] = useState<SlotWindow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Initial meta fetch — establishes enabled flag + min/max date range.
  useEffect(() => {
    let cancelled = false;
    setLoadingMeta(true);
    fetch("/api/v1/delivery/slots", { cache: "no-store" })
      .then((r) => r.json() as Promise<SlotsResponse>)
      .then((d) => {
        if (cancelled) return;
        setSlotsEnabled(Boolean(d.data?.enabled));
        setMinDate(d.data?.min_date ?? null);
        setMaxDate(d.data?.max_date ?? null);
        setDateKey(d.data?.date ?? null);
        setWindows(d.data?.windows ?? []);
      })
      .catch(() => {
        if (!cancelled) setSlotsEnabled(false);
      })
      .finally(() => {
        if (!cancelled) setLoadingMeta(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-fetch windows whenever dateKey changes.
  useEffect(() => {
    if (!dateKey || !slotsEnabled) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/v1/delivery/slots?date=${encodeURIComponent(dateKey)}`, {
      cache: "no-store",
    })
      .then((r) => r.json() as Promise<SlotsResponse>)
      .then((d) => {
        if (cancelled) return;
        setWindows(d.data?.windows ?? []);
      })
      .catch(() => {
        if (!cancelled) setErr("تعذر تحميل الفتحات");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateKey, slotsEnabled]);

  // Auto-pick the first available window when entering scheduled mode
  // or when the current date changes (unless already picked).
  useEffect(() => {
    if (value.mode !== "scheduled") return;
    if (!windows.length) return;
    // Keep current pick if still available in this date.
    const stillValid = windows.some(
      (w) => w.id === value.slot_id && w.available,
    );
    if (stillValid) return;
    const first = windows.find((w) => w.available);
    if (!first) return;
    onChange({
      mode: "scheduled",
      slot_id: first.id,
      scheduled_for: first.start_at,
      label_ar: first.label_ar,
      date: dateKey ?? value.date,
    });
  }, [windows, value, dateKey, onChange]);

  const dayOptions = useMemo(() => {
    if (!minDate || !maxDate) return [] as { key: string; label: string }[];
    const out: { key: string; label: string }[] = [];
    const cur = new Date(minDate + "T00:00:00Z");
    const end = new Date(maxDate + "T00:00:00Z");
    const weekdayFmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
      weekday: "long",
    });
    const dayFmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
      day: "numeric",
      month: "long",
    });
    let i = 0;
    while (cur <= end && i < 14) {
      const key = cur.toISOString().slice(0, 10);
      const label = i === 0
        ? `اليوم · ${dayFmt.format(cur)}`
        : i === 1
          ? `غداً · ${dayFmt.format(cur)}`
          : `${weekdayFmt.format(cur)} · ${dayFmt.format(cur)}`;
      out.push({ key, label });
      cur.setUTCDate(cur.getUTCDate() + 1);
      i++;
    }
    return out;
  }, [minDate, maxDate]);

  // Mode toggle handler (express vs scheduled).
  const setMode = (mode: "express" | "scheduled") => {
    if (mode === "express") {
      onChange({ mode: "express" });
      return;
    }
    // Pick the first available window in the current date.
    const first = windows.find((w) => w.available);
    if (!first) return; // no windows yet — wait for fetch
    onChange({
      mode: "scheduled",
      slot_id: first.id,
      scheduled_for: first.start_at,
      label_ar: first.label_ar,
      date: dateKey ?? "",
    });
  };

  const pickSlot = (w: SlotWindow) => {
    onChange({
      mode: "scheduled",
      slot_id: w.id,
      scheduled_for: w.start_at,
      label_ar: w.label_ar,
      date: dateKey ?? "",
    });
  };

  const isScheduled = value.mode === "scheduled";

  // Loading skeleton — first paint while meta is loading.
  if (loadingMeta) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          جاري التحميل...
        </div>
      </div>
    );
  }

  // Server has scheduling disabled → show only the express option
  // (no toggle visible at all). The picker becomes a static label.
  if (!slotsEnabled) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 flex items-start gap-3">
        <Zap className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-semibold text-gray-900 text-sm">توصيل فوري</p>
          <p className="text-xs text-gray-500 mt-0.5">
            متوقع خلال 30-45 دقيقة من تأكيد الطلب
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMode("express")}
          className={`p-3 rounded-2xl border-2 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            !isScheduled
              ? "border-primary-600 bg-primary-50 text-primary-700"
              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
          }`}
          aria-pressed={!isScheduled}
        >
          <Zap className="w-4 h-4" />
          <div className="text-right">
            <div className="text-sm font-semibold">توصيل فوري</div>
            <div className="text-tiny opacity-75">30-45 دقيقة</div>
          </div>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMode("scheduled")}
          className={`p-3 rounded-2xl border-2 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            isScheduled
              ? "border-primary-600 bg-primary-50 text-primary-700"
              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
          }`}
          aria-pressed={isScheduled}
        >
          <Calendar className="w-4 h-4" />
          <div className="text-right">
            <div className="text-sm font-semibold">جدولة الطلب</div>
            <div className="text-tiny opacity-75">اختر وقت يناسبك</div>
          </div>
        </button>
      </div>

      {/* Scheduled body */}
      {isScheduled && (
        <div className="rounded-2xl border border-primary-200 bg-primary-50/50 p-3 space-y-3">
          {/* Date selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">
              <Calendar className="w-3.5 h-3.5 inline-block ml-1" />
              اليوم
            </label>
            <div className="relative">
              <select
                value={dateKey ?? ""}
                onChange={(e) => setDateKey(e.target.value)}
                disabled={disabled}
                className="w-full appearance-none rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 focus:border-primary-500 focus:outline-none disabled:opacity-50"
              >
                {dayOptions.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
              <Calendar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            </div>
          </div>

          {/* Window grid */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">
              <Clock className="w-3.5 h-3.5 inline-block ml-1" />
              الفترة
            </label>
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-3">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                جاري تحميل الفتحات...
              </div>
            ) : err ? (
              <div className="text-xs text-red-600 py-2">{err}</div>
            ) : windows.length === 0 ? (
              <div className="text-xs text-gray-500 py-2">
                لا توجد فترات متاحة
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {windows.map((w) => {
                  const selected = value.mode === "scheduled" && value.slot_id === w.id;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      disabled={disabled || !w.available}
                      onClick={() => pickSlot(w)}
                      aria-pressed={selected}
                      className={`relative p-2.5 rounded-xl border-2 text-right transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        selected
                          ? "border-primary-600 bg-white text-primary-700"
                          : w.available
                            ? "border-gray-200 bg-white hover:border-gray-300 text-gray-700"
                            : "border-gray-100 bg-gray-50 text-gray-400"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-sm font-semibold">
                          {w.label_ar}
                        </span>
                        {selected && (
                          <Check className="w-4 h-4 text-primary-600 flex-shrink-0" />
                        )}
                      </div>
                      <div className="text-xs opacity-75 mt-0.5 tabular-nums">
                        {w.start} – {w.end}
                      </div>
                      <div className="text-tiny opacity-60 mt-0.5 tabular-nums">
                        {w.available
                          ? `${w.capacity - w.booked} مقعد متبقي`
                          : "ممتلئة"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected summary */}
          {value.mode === "scheduled" && value.slot_id && (
            <div className="flex items-start gap-2 bg-white rounded-xl border border-primary-200 p-2.5">
              <Check className="w-4 h-4 text-primary-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-gray-700">
                <span className="font-semibold">تم اختيار:</span>{" "}
                {formatRiyadhFromIso(value.scheduled_for)}
                <span className="text-gray-500"> · {value.label_ar}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Render the user-facing Arabic label for a scheduled slot start.
 * e.g. "الأحد 12 ص – 2 م".
 */
function formatRiyadhFromIso(iso: string): string {
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Riyadh",
    });
    return fmt.format(d);
  } catch {
    return iso;
  }
}