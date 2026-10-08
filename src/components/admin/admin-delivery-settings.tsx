"use client";

import { useEffect, useMemo, useState } from "react";
import { formatPrice } from "@/lib/format";
import { csrfFetch } from "@/lib/csrf-client";
import { SearchableSelect } from "@/components/admin/SearchableSelect";
import { useFormFieldIdFromLabel, useIndexedFieldIds } from "@/hooks/use-form-field-id";

const adminCred: RequestInit = { credentials: "include" };

// Defaults used when the DB has no value yet AND when the user blanks
// the input. They MUST mirror `DELIVERY_*` in
// `@/lib/delivery-distance-fee` so the admin form behaves the same as
// the server before the first save.
const DEFAULT_BASE_SAR = 3;
// Migration 078 (2026-09-30): the canonical includedKm is 5 km, not 2.
// The pre-078 form shipped with 2, which silently overrode the server's
// `DELIVERY_INCLUDED_KM = 5` on the first save.
const DEFAULT_INCLUDED_KM = 5;
const DEFAULT_PER_EXTRA_KM_SAR = 1.5;

function computeFeeAt(
  km: number,
  baseSar: number,
  includedKm: number,
  perExtraKmSar: number,
): number {
  if (!Number.isFinite(km) || km <= 0) return 0;
  if (km <= includedKm) return Number(baseSar.toFixed(2));
  return Number((baseSar + perExtraKmSar * (km - includedKm)).toFixed(2));
}

function formatFeeAt(
  km: number,
  baseSar: number,
  includedKm: number,
  perExtraKmSar: number,
): string {
  const fee = computeFeeAt(km, baseSar, includedKm, perExtraKmSar);
  return fee === 0 ? "0.00 ر.س" : formatPrice(fee);
}

/**
 * Coerce a possibly-string number from the JSON payload into a finite
 * number, falling back to a default when the value is missing or NaN.
 * `delivery_settings.pricing` was originally written as numeric JSON
 * but old records may carry strings — we normalize either way.
 */
function numberOr(v: unknown, fallback: number): number {
  if (v == null || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function AdminDeliverySettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  // After migration 060 the `pricing` object carries every
  // admin-tunable knob: distance-based fee (`baseSar`, `includedKm`,
  // `perExtraKmSar`) plus service fee + tax. Distance is computed
  // server-side from the main store lat/lng.
  // Migration 078 (2026-09-30): the legacy `maxDiscount` field was
  // never read by `computeOrderFees` — it was a leftover from the
  // pre-migration coupon surface. Removed from the schema (and from
  // this UI state) so the admin form no longer surfaces a dead knob.
  const [pricing, setPricing] = useState({
    baseSar: DEFAULT_BASE_SAR,
    includedKm: DEFAULT_INCLUDED_KM,
    perExtraKmSar: DEFAULT_PER_EXTRA_KM_SAR,
    serviceFeeEnabled: true,
    serviceFeeType: "fixed" as "fixed" | "percent",
    serviceFeeValue: 3,
    taxEnabled: false,
    taxPercent: 0,
  });

  const [hours, setHours] = useState({
    enabled: true,
    open_time: "09:00",
    close_time: "23:00",
    timezone: "Asia/Riyadh",
    closed_message:
      "التوصيل متاح فقط خلال ساعات العمل — يرجى المحاولة لاحقاً",
  });

  const [slots, setSlots] = useState({
    enabled: true,
    lead_time_minutes: 120,
    max_days_ahead: 7,
    min_days_ahead: 0,
    timezone: "Asia/Riyadh",
    slot_duration_minutes: 120,
    windows: [
      { id: "morning", label_ar: "صباحاً", start: "09:00", end: "11:00", capacity: 20 },
      { id: "noon", label_ar: "ظهراً", start: "12:00", end: "14:00", capacity: 25 },
      { id: "afternoon", label_ar: "عصراً", start: "15:00", end: "17:00", capacity: 25 },
      { id: "evening", label_ar: "مساءً", start: "18:00", end: "20:00", capacity: 30 },
    ],
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/delivery-settings", adminCred).then((r) => r.json());
      if (res.success && res.data?.pricing) {
        // Server may still echo legacy zone-pricing fields (baseFee etc.)
        // — we ignore those and only pick up the knobs the new schema
        // still understands. `maxDiscount` was removed from the schema
        // in migration 078 — if an old DB record still carries the key,
        // it's silently dropped.
        const p = res.data.pricing;
        setPricing({
          baseSar: numberOr(p.baseSar, DEFAULT_BASE_SAR),
          includedKm: numberOr(p.includedKm, DEFAULT_INCLUDED_KM),
          perExtraKmSar: numberOr(p.perExtraKmSar, DEFAULT_PER_EXTRA_KM_SAR),
          serviceFeeEnabled: p.serviceFeeEnabled !== false,
          serviceFeeType:
            p.serviceFeeType === "percent" ? "percent" : "fixed",
          serviceFeeValue: Number(p.serviceFeeValue ?? 3),
          taxEnabled: p.taxEnabled === true,
          taxPercent: Number(p.taxPercent ?? 0),
        });
      }
      if (res.success && res.data?.hours) {
        setHours({
          enabled: !!res.data.hours.enabled,
          open_time: String(res.data.hours.open_time || "09:00"),
          close_time: String(res.data.hours.close_time || "23:00"),
          timezone: String(res.data.hours.timezone || "Asia/Riyadh"),
          closed_message:
            String(res.data.hours.closed_message || "").trim() ||
            "التوصيل متاح فقط خلال ساعات العمل — يرجى المحاولة لاحقاً",
        });
      }
      if (res.success && res.data?.slots) {
        setSlots({
          enabled: !!res.data.slots.enabled,
          lead_time_minutes: Number(res.data.slots.lead_time_minutes ?? 120),
          max_days_ahead: Number(res.data.slots.max_days_ahead ?? 7),
          min_days_ahead: Number(res.data.slots.min_days_ahead ?? 0),
          timezone: String(res.data.slots.timezone || "Asia/Riyadh"),
          slot_duration_minutes: Number(res.data.slots.slot_duration_minutes ?? 120),
          windows: Array.isArray(res.data.slots.windows) && res.data.slots.windows.length > 0
            ? res.data.slots.windows
            : slots.windows,
        });
      }
    } catch (e) {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess(false);

    const res = await csrfFetch("/api/admin/delivery-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pricing, hours, slots }),
      ...adminCred,
    }).then((r) => r.json());

    setSaving(false);

    if (res.success) {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } else {
      setError(res.error || "فشل الحفظ");
    }
  };

  // Stable ids for every visible label/input pair on the form so screen
  // readers associate the label with its input. Each call to
  // `useFormFieldIdFromLabel` is hook-ordered; the loader early-return
  // below would otherwise skip some of them and break hook ordering.
  const baseFareId = useFormFieldIdFromLabel("admin-delivery", "السعر الأساسي (ر.س)");
  const includedKmId = useFormFieldIdFromLabel("admin-delivery", "عدد الكيلو المشمولة");
  const perExtraKmId = useFormFieldIdFromLabel("admin-delivery", "سعر الكيلو الإضافي (ر.س)");
  const serviceFeeEnabledId = useFormFieldIdFromLabel("admin-delivery", "تفعيل رسوم الخدمة");
  const serviceFeeTypeId = useFormFieldIdFromLabel("admin-delivery", "النوع");
  const serviceFeeValueId = useFormFieldIdFromLabel("admin-delivery", "القيمة");
  const taxEnabledId = useFormFieldIdFromLabel("admin-delivery", "إضافة ضريبة (VAT) على الطلبات");
  const taxPercentId = useFormFieldIdFromLabel("admin-delivery", "نسبة الضريبة (%)");
  const hoursEnabledId = useFormFieldIdFromLabel("admin-delivery", "تفعيل قيد ساعات العمل (منع الطلبات خارج الوقت المحدد)");
  const openTimeId = useFormFieldIdFromLabel("admin-delivery", "من الساعة");
  const closeTimeId = useFormFieldIdFromLabel("admin-delivery", "إلى الساعة");
  const closedMessageId = useFormFieldIdFromLabel("admin-delivery", "رسالة للعميل خارج ساعات العمل");
  const slotsEnabledId = useFormFieldIdFromLabel("admin-delivery", "تفعيل الحجز المسبق بفترات محددة");
  const leadTimeId = useFormFieldIdFromLabel("admin-delivery", "أقل مدة تحضير (دقيقة)");
  const maxDaysAheadId = useFormFieldIdFromLabel("admin-delivery", "أقصى حجز مسبق (يوم)");
  const minDaysAheadId = useFormFieldIdFromLabel("admin-delivery", "أقل حجز مسبق (يوم)");
  // Per-iteration ids for the dynamic slot rows so each rendered row gets
  // its own `id`/`htmlFor` pair (same `useFormFieldIdFromLabel` value used
  // across multiple rows would create duplicate ids in the DOM).
  const slotRowId = useIndexedFieldIds("admin-delivery", "slot");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-secondary">إعدادات التوصيل</h1>
          <p className="text-gray-500 mt-1">
            رسوم الخدمة والضريبة، فترات التوصيل المجدولة، وساعات العمل
          </p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-xl text-green-700">
            ✓ تم حفظ الإعدادات بنجاح
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-6">
          {/* Distance-based delivery fee (admin-tunable) */}
          <div>
            <h2 className="text-lg font-bold text-secondary mb-4 flex items-center gap-2">
              📍 تسعيرة التوصيل حسب المسافة
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              تُحتسب رسوم التوصيل آلياً من موقع الفرع الرئيسي (من{" "}
              <a href="/admin/stores" className="text-primary hover:underline">
                /admin/stores
              </a>
              ) إلى عنوان العميل — كل المسافات مقبولة، لا يوجد حد أقصى.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label
                  htmlFor={baseFareId}
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  السعر الأساسي (ر.س)
                </label>
                <input
                  id={baseFareId}
                  type="number"
                  min={0}
                  step={0.5}
                  value={pricing.baseSar}
                  onChange={(e) =>
                    setPricing({
                      ...pricing,
                      baseSar: numberOr(e.target.value, DEFAULT_BASE_SAR),
                    })
                  }
                  className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">
                  يُحتسب لأول <strong>{pricing.includedKm}</strong> كم
                </p>
              </div>
              <div>
                <label
                  htmlFor={includedKmId}
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  عدد الكيلو المشمولة
                </label>
                <input
                  id={includedKmId}
                  type="number"
                  min={0}
                  step={0.5}
                  value={pricing.includedKm}
                  onChange={(e) =>
                    setPricing({
                      ...pricing,
                      includedKm: numberOr(
                        e.target.value,
                        DEFAULT_INCLUDED_KM,
                      ),
                    })
                  }
                  className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">
                  المسافة التي يغطيها السعر الأساسي
                </p>
              </div>
              <div>
                <label
                  htmlFor={perExtraKmId}
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  سعر الكيلو الإضافي (ر.س)
                </label>
                <input
                  id={perExtraKmId}
                  type="number"
                  min={0}
                  step={0.1}
                  value={pricing.perExtraKmSar}
                  onChange={(e) =>
                    setPricing({
                      ...pricing,
                      perExtraKmSar: numberOr(
                        e.target.value,
                        DEFAULT_PER_EXTRA_KM_SAR,
                      ),
                    })
                  }
                  className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">
                  يُحتسب على كل كيلو بعد المشمول
                </p>
              </div>
            </div>

            <div className="p-4 bg-blue-50 rounded-xl">
              <p className="text-sm font-medium text-blue-800 mb-2">
                📊 المعادلة الحالية:
              </p>
              <ul className="space-y-1 text-sm text-blue-700">
                <li>
                  • المسافة ≤ {pricing.includedKm} كم ←{" "}
                  <strong>{formatPrice(pricing.baseSar)}</strong> ثابت
                </li>
                <li>
                  • المسافة &gt; {pricing.includedKm} كم ←{" "}
                  {pricing.baseSar} + {pricing.perExtraKmSar} × (المسافة − {pricing.includedKm})
                </li>
              </ul>
              <p className="text-sm font-medium text-blue-800 mt-3 mb-2">
                💡 أمثلة على الاحتساب (مبنية على القيم أعلاه):
              </p>
              <div className="space-y-1 text-sm text-blue-700">
                {[3, 5, 7, 10, 15, 20].map((km) => (
                  <p key={km}>
                    • {km} كم:{" "}
                    {formatFeeAt(
                      km,
                      pricing.baseSar,
                      pricing.includedKm,
                      pricing.perExtraKmSar,
                    )}
                  </p>
                ))}
              </div>
            </div>
          </div>

          {/* Service Fee */}
          <div className="border-t border-gray-100 pt-6">
            <h2 className="text-lg font-bold text-secondary mb-4 flex items-center gap-2">
              🧾 رسوم الخدمة
            </h2>
            <div className="space-y-4">
              <label
                htmlFor={serviceFeeEnabledId}
                className="flex items-center gap-2"
              >
                <input
                  id={serviceFeeEnabledId}
                  type="checkbox"
                  checked={pricing.serviceFeeEnabled}
                  onChange={(e) => setPricing({ ...pricing, serviceFeeEnabled: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-700">تفعيل رسوم الخدمة</span>
              </label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor={serviceFeeTypeId}
                    className="block text-sm font-medium text-gray-700 mb-1.5"
                  >
                    النوع
                  </label>
                  <SearchableSelect
                    id={serviceFeeTypeId}
                    value={pricing.serviceFeeType}
                    onChange={(v) =>
                      setPricing({ ...pricing, serviceFeeType: v as "fixed" | "percent" })
                    }
                    options={[
                      { value: "fixed", label: "مبلغ ثابت (ر.س)" },
                      { value: "percent", label: "نسبة مئوية (%)" },
                    ]}
                    includePlaceholderOption={false}
                    searchable={false}
                    allowClear={false}
                    className="bg-gray-50"
                  />
                </div>
                <div>
                  <label
                    htmlFor={serviceFeeValueId}
                    className="block text-sm font-medium text-gray-700 mb-1.5"
                  >
                    القيمة {pricing.serviceFeeType === "percent" ? "(%)" : "(ر.س)"}
                  </label>
                  <input
                    id={serviceFeeValueId}
                    type="number"
                    min="0"
                    step={pricing.serviceFeeType === "percent" ? "0.1" : "0.5"}
                    value={pricing.serviceFeeValue}
                    onChange={(e) => setPricing({ ...pricing, serviceFeeValue: Number(e.target.value) })}
                    className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Tax */}
          <div className="border-t border-gray-100 pt-6">
            <h2 className="text-lg font-bold text-secondary mb-4 flex items-center gap-2">
              💸 الضريبة
            </h2>
            <div className="space-y-4">
              <label
                htmlFor={taxEnabledId}
                className="flex items-center gap-2"
              >
                <input
                  id={taxEnabledId}
                  type="checkbox"
                  checked={pricing.taxEnabled}
                  onChange={(e) => setPricing({ ...pricing, taxEnabled: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-700">إضافة ضريبة (VAT) على الطلبات</span>
              </label>
              <div>
                <label
                  htmlFor={taxPercentId}
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  نسبة الضريبة (%)
                </label>
                <input
                  id={taxPercentId}
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={pricing.taxPercent}
                  onChange={(e) => setPricing({ ...pricing, taxPercent: Number(e.target.value) })}
                  className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">النسبة تضاف على قيمة المنتجات قبل الخصم</p>
              </div>
            </div>
          </div>

          {/* Coupons hint */}
          <div className="border-t border-gray-100 pt-6">
            <h2 className="text-lg font-bold text-secondary mb-4 flex items-center gap-2">
              🎟️ الكوبونات
            </h2>
            <p className="text-sm text-gray-600">
              إدارة الكوبونات من صفحة{" "}
              <a href="/admin/coupons" className="text-primary hover:underline">/admin/coupons</a>{" "}
              (إنشاء كود خصم بنوع نسبة أو مبلغ ثابت مع حد أدنى وصلاحية).
            </p>
          </div>

          {/* Working Hours */}
          <div className="border-t border-gray-100 pt-6">
            <h2 className="text-lg font-bold text-secondary mb-4 flex items-center gap-2">
              ⏰ ساعات العمل اليومية
            </h2>
            <div className="space-y-4">
              <label
                htmlFor={hoursEnabledId}
                className="flex items-center gap-2"
              >
                <input
                  id={hoursEnabledId}
                  type="checkbox"
                  checked={hours.enabled}
                  onChange={(e) => setHours({ ...hours, enabled: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-700">
                  تفعيل قيد ساعات العمل (منع الطلبات خارج الوقت المحدد)
                </span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor={openTimeId}
                    className="block text-sm font-medium text-gray-700 mb-1.5"
                  >
                    من الساعة
                  </label>
                  <input
                    id={openTimeId}
                    type="time"
                    value={hours.open_time}
                    onChange={(e) => setHours({ ...hours, open_time: e.target.value })}
                    disabled={!hours.enabled}
                    className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
                  />
                </div>
                <div>
                  <label
                    htmlFor={closeTimeId}
                    className="block text-sm font-medium text-gray-700 mb-1.5"
                  >
                    إلى الساعة
                  </label>
                  <input
                    id={closeTimeId}
                    type="time"
                    value={hours.close_time}
                    onChange={(e) => setHours({ ...hours, close_time: e.target.value })}
                    disabled={!hours.enabled}
                    className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
                  />
                </div>
              </div>

              <p className="text-xs text-gray-400">
                يطبَّق على جميع أيام الأسبوع — التوقيت <span className="font-medium">{hours.timezone}</span>.
                إذا كانت <strong>إلى</strong> قبل <strong>من</strong> سيتم احتساب النطاق ليعبر منتصف الليل (مثلاً 18:00 → 02:00).
              </p>

              <div>
                <label
                  htmlFor={closedMessageId}
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  رسالة للعميل خارج ساعات العمل
                </label>
                <textarea
                  id={closedMessageId}
                  value={hours.closed_message}
                  onChange={(e) => setHours({ ...hours, closed_message: e.target.value })}
                  disabled={!hours.enabled}
                  rows={2}
                  maxLength={500}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
                />
                <p className="text-xs text-gray-400 mt-1">
                  ستظهر هذه الرسالة في الـ banner أعلى الموقع وفي صفحة الدفع.
                </p>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                ⚠️ التحقق من ساعات العمل يتم على السيرفر (لا يمكن للعميل تجاوزه بتعديل ساعته).
              </div>
            </div>
          </div>

          {/* Delivery Time Slots */}
          <div className="border-t border-gray-100 pt-6">
            <h2 className="text-lg font-bold text-secondary mb-4 flex items-center gap-2">
              📅 فترات التوصيل المجدولة
            </h2>

            <div className="space-y-4">
              <label
                htmlFor={slotsEnabledId}
                className="flex items-center gap-2"
              >
                <input
                  id={slotsEnabledId}
                  type="checkbox"
                  checked={slots.enabled}
                  onChange={(e) => setSlots({ ...slots, enabled: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-700">
                  تفعيل الحجز المسبق بفترات محددة
                </span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor={leadTimeId}
                    className="block text-sm font-medium text-gray-700 mb-1.5"
                  >
                    أقل مدة تحضير (دقيقة)
                  </label>
                  <input
                    id={leadTimeId}
                    type="number"
                    min={0}
                    max={1440}
                    step={15}
                    value={slots.lead_time_minutes}
                    onChange={(e) => setSlots({ ...slots, lead_time_minutes: Number(e.target.value) })}
                    disabled={!slots.enabled}
                    className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    لا يمكن الحجز قبل مرور هذا الوقت من الآن
                  </p>
                </div>
                <div>
                  <label
                    htmlFor={maxDaysAheadId}
                    className="block text-sm font-medium text-gray-700 mb-1.5"
                  >
                    أقصى حجز مسبق (يوم)
                  </label>
                  <input
                    id={maxDaysAheadId}
                    type="number"
                    min={0}
                    max={60}
                    value={slots.max_days_ahead}
                    onChange={(e) => setSlots({ ...slots, max_days_ahead: Number(e.target.value) })}
                    disabled={!slots.enabled}
                    className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
                  />
                </div>
                <div>
                  <label
                    htmlFor={minDaysAheadId}
                    className="block text-sm font-medium text-gray-700 mb-1.5"
                  >
                    أقل حجز مسبق (يوم)
                  </label>
                  <input
                    id={minDaysAheadId}
                    type="number"
                    min={0}
                    max={60}
                    value={slots.min_days_ahead}
                    onChange={(e) => setSlots({ ...slots, min_days_ahead: Number(e.target.value) })}
                    disabled={!slots.enabled}
                    className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">فترات التوصيل</h3>
                  <button
                    type="button"
                    onClick={() => {
                      const idx = slots.windows.length;
                      setSlots({
                        ...slots,
                        windows: [
                          ...slots.windows,
                          {
                            id: `slot-${Date.now()}`,
                            label_ar: `فترة ${idx + 1}`,
                            start: "10:00",
                            end: "12:00",
                            capacity: 20,
                          },
                        ],
                      });
                    }}
                    disabled={!slots.enabled || slots.windows.length >= 20}
                    className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50"
                  >
                    + إضافة فترة
                  </button>
                </div>

                <div className="space-y-2">
                  {slots.windows.map((w, idx) => {
                    const labelId = slotRowId(idx, "label");
                    const startId = slotRowId(idx, "start");
                    const endId = slotRowId(idx, "end");
                    const capacityId = slotRowId(idx, "capacity");
                    return (
                    <div
                      key={w.id || idx}
                      className="grid grid-cols-12 gap-2 p-3 bg-gray-50 rounded-xl border border-gray-200"
                    >
                      <div className="col-span-3">
                        <label
                          htmlFor={labelId}
                          className="block text-tiny text-gray-500 mb-1"
                        >
                          الاسم
                        </label>
                        <input
                          id={labelId}
                          type="text"
                          value={w.label_ar}
                          onChange={(e) => {
                            const next = [...slots.windows];
                            next[idx] = { ...w, label_ar: e.target.value };
                            setSlots({ ...slots, windows: next });
                          }}
                          disabled={!slots.enabled}
                          className="w-full h-9 px-2 bg-white border border-gray-200 rounded-lg text-sm disabled:opacity-50"
                        />
                      </div>
                      <div className="col-span-2">
                        <label
                          htmlFor={startId}
                          className="block text-tiny text-gray-500 mb-1"
                        >
                          من
                        </label>
                        <input
                          id={startId}
                          type="time"
                          value={w.start}
                          onChange={(e) => {
                            const next = [...slots.windows];
                            next[idx] = { ...w, start: e.target.value };
                            setSlots({ ...slots, windows: next });
                          }}
                          disabled={!slots.enabled}
                          className="w-full h-9 px-2 bg-white border border-gray-200 rounded-lg text-sm disabled:opacity-50"
                        />
                      </div>
                      <div className="col-span-2">
                        <label
                          htmlFor={endId}
                          className="block text-tiny text-gray-500 mb-1"
                        >
                          إلى
                        </label>
                        <input
                          id={endId}
                          type="time"
                          value={w.end}
                          onChange={(e) => {
                            const next = [...slots.windows];
                            next[idx] = { ...w, end: e.target.value };
                            setSlots({ ...slots, windows: next });
                          }}
                          disabled={!slots.enabled}
                          className="w-full h-9 px-2 bg-white border border-gray-200 rounded-lg text-sm disabled:opacity-50"
                        />
                      </div>
                      <div className="col-span-3">
                        <label
                          htmlFor={capacityId}
                          className="block text-tiny text-gray-500 mb-1"
                        >
                          السعة (طلب/فترة)
                        </label>
                        <input
                          id={capacityId}
                          type="number"
                          min={1}
                          max={10000}
                          value={w.capacity}
                          onChange={(e) => {
                            const next = [...slots.windows];
                            next[idx] = { ...w, capacity: Number(e.target.value) };
                            setSlots({ ...slots, windows: next });
                          }}
                          disabled={!slots.enabled}
                          className="w-full h-9 px-2 bg-white border border-gray-200 rounded-lg text-sm disabled:opacity-50"
                        />
                      </div>
                      <div className="col-span-2 flex items-end">
                        <button
                          type="button"
                          onClick={() => {
                            const next = slots.windows.filter((_, i) => i !== idx);
                            setSlots({ ...slots, windows: next });
                          }}
                          disabled={!slots.enabled || slots.windows.length <= 1}
                          className="w-full h-9 px-2 bg-red-50 text-red-600 rounded-lg text-sm hover:bg-red-100 disabled:opacity-50"
                        >
                          حذف
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="pt-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full h-12 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>جاري الحفظ...</span>
                </>
              ) : (
                <span>حفظ الإعدادات</span>
              )}
            </button>
          </div>
        </div>
    </div>
  );
}
