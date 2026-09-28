"use client";

// Offer edit form — used by the admin offers page (Pattern A, mirrors
// the coupons page). Handles all field state, validation, and submit.
// The form receives `mode` + `initial` (when editing) and an `onSubmit`
// callback that returns `true` on success.

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Save,
  Sparkles,
  EyeOff,
  Eye,
  Info,
  X,
  Loader2,
  Check,
} from "lucide-react";
import { ImageUploader } from "@/components/admin/image-uploader";
import type { AdminOffer, AdminOfferTarget, OfferTargetType } from "@/lib/admin-types";

export interface OfferFormValues {
  id?: string;
  title_ar: string;
  title_en: string;
  description_ar: string;
  description_en: string;
  image_url: string;
  discount_type: "percentage" | "fixed";
  discount_value: number | "";
  max_discount: number | "" | null;
  min_order: number | "" | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
  applies_to: "catalog" | "vendor" | "mixed";
  targets: AdminOfferTarget[];
}

export interface OfferTargetOption {
  id: string;
  label: string;
  secondary?: string | null;
}

interface OfferEditFormProps {
  mode: "create" | "edit";
  initial: OfferFormValues;
  backHref?: string;
  onSubmit: (data: OfferFormValues) => Promise<{ ok: boolean; error?: string }>;
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    // Format YYYY-MM-DDTHH:mm in local time so the input shows the user's tz.
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function fromDatetimeLocal(local: string): string {
  if (!local) return new Date().toISOString();
  const d = new Date(local);
  return d.toISOString();
}

export function OfferEditForm({
  mode,
  initial,
  backHref = "/admin/offers",
  onSubmit,
}: OfferEditFormProps) {
  const [titleAr, setTitleAr] = useState(initial.title_ar || "");
  const [titleEn, setTitleEn] = useState(initial.title_en || "");
  const [descriptionAr, setDescriptionAr] = useState(initial.description_ar || "");
  const [descriptionEn, setDescriptionEn] = useState(initial.description_en || "");
  const [imageUrl, setImageUrl] = useState(initial.image_url || "");
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">(initial.discount_type || "percentage");
  const [discountValue, setDiscountValue] = useState<number | "">(initial.discount_value || "");
  const [maxDiscount, setMaxDiscount] = useState<number | "">(initial.max_discount ?? "");
  const [minOrder, setMinOrder] = useState<number | "">(initial.min_order ?? "");
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(initial.starts_at) || toDatetimeLocal(new Date().toISOString()));
  const [endsAt, setEndsAt] = useState(toDatetimeLocal(initial.ends_at));
  const [isActive, setIsActive] = useState(initial.is_active !== false);
  const [isFeatured, setIsFeatured] = useState(!!initial.is_featured);
  const [sortOrder, setSortOrder] = useState<number>(initial.sort_order || 0);
  // The scope picker (radio buttons) drives `scopeType`. The database
  // stores a high-level descriptor `applies_to` (catalog | vendor | mixed)
  // derived from this and the current targets at submit time.
  const [scopeType, setScopeType] = useState<OfferTargetType>(() => {
    if (initial.targets?.some((t) => t.target_type === "all")) return "all";
    if (initial.targets?.some((t) => t.target_type === "vendor")) return "vendor";
    if (initial.targets?.some((t) => t.target_type === "category")) return "category";
    if (initial.targets?.some((t) => t.target_type === "product")) return "product";
    return "mixed" as OfferTargetType; // legacy initial value
  });
  const [targets, setTargets] = useState<AdminOfferTarget[]>(initial.targets || []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Picker state — search-by-typeahead for products/categories/vendors.
  const [pickerType, setPickerType] = useState<Exclude<OfferTargetType, "all">>("product");
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerOptions, setPickerOptions] = useState<OfferTargetOption[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  useEffect(() => {
    if (scopeType === "all") {
      setTargets([
        {
          id: "sentinel-all",
          offer_id: initial.id || "",
          target_type: "all",
          target_id: null,
        },
      ]);
      return;
    }
    setPickerType(scopeType as Exclude<OfferTargetType, "all">);
    // Drop any target rows that don't match the current scope.
    setTargets((prev) => prev.filter((t) => t.target_type === scopeType || t.target_type === "all"));
  }, [scopeType, initial.id]);

  // Debounced typeahead for the target picker.
  useEffect(() => {
    if (scopeType === "all") return;
    const ac = new AbortController();
    const timer = setTimeout(async () => {
      setPickerLoading(true);
      try {
        const url = `/api/admin/offers/targets?type=${pickerType}&q=${encodeURIComponent(pickerQuery)}`;
        const res = await fetch(url, { credentials: "include", signal: ac.signal });
        if (!res.ok) {
          setPickerOptions([]);
          return;
        }
        const data = await res.json();
        if (data.success) setPickerOptions(data.data || []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") console.error("Picker fetch error", err);
      } finally {
        if (!ac.signal.aborted) setPickerLoading(false);
      }
    }, 250);
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [pickerQuery, pickerType, scopeType]);

  const discountLabel = useMemo(() => {
    if (discountType === "percentage") return "نسبة الخصم %";
    return "قيمة الخصم (ر.س)";
  }, [discountType]);

  const addTarget = (opt: OfferTargetOption) => {
    const exists = targets.some((t) => t.target_type === pickerType && t.target_id === opt.id);
    if (exists) return;
    setTargets((prev) => [
      ...prev,
      {
        id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        offer_id: initial.id || "",
        target_type: pickerType,
        target_id: opt.id,
      },
    ]);
    setPickerQuery("");
  };

  const removeTarget = (id: string) => {
    setTargets((prev) => prev.filter((t) => t.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!titleAr.trim()) {
      setError("عنوان العرض بالعربية مطلوب");
      return;
    }
    if (!imageUrl.trim()) {
      setError("صورة العرض مطلوبة");
      return;
    }
    if (!discountValue || Number(discountValue) <= 0) {
      setError("قيمة الخصم يجب أن تكون موجبة");
      return;
    }
    if (discountType === "percentage" && Number(discountValue) > 100) {
      setError("نسبة الخصم يجب ألا تتجاوز 100");
      return;
    }
    if (!startsAt || !endsAt) {
      setError("تاريخ البداية والنهاية مطلوبان");
      return;
    }
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setError("تاريخ النهاية يجب أن يكون بعد البداية");
      return;
    }
    if (targets.length === 0) {
      setError("يجب اختيار هدف واحد على الأقل");
      return;
    }

    setSubmitting(true);
    // Derive the high-level `applies_to` from the current scope + targets.
    const derivedAppliesTo: "catalog" | "vendor" | "mixed" =
      scopeType === "vendor" ? "vendor" : scopeType === "all" ? "mixed" : "catalog";
    const result = await onSubmit({
      id: initial.id,
      title_ar: titleAr.trim(),
      title_en: titleEn.trim(),
      description_ar: descriptionAr.trim(),
      description_en: descriptionEn.trim(),
      image_url: imageUrl.trim(),
      discount_type: discountType,
      discount_value: Number(discountValue),
      max_discount: maxDiscount === "" ? null : Number(maxDiscount),
      min_order: minOrder === "" ? null : Number(minOrder),
      starts_at: fromDatetimeLocal(startsAt),
      ends_at: fromDatetimeLocal(endsAt),
      is_active: isActive,
      is_featured: isFeatured,
      sort_order: Number(sortOrder) || 0,
      applies_to: derivedAppliesTo,
      targets: targets.map((t) => ({
        id: t.id,
        offer_id: t.offer_id,
        target_type: t.target_type,
        target_id: t.target_id,
      })),
    });
    setSubmitting(false);
    if (!result.ok) setError(result.error || "فشل حفظ العرض. تحقق من البيانات وحاول مرة أخرى.");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-primary transition-colors"
      >
        <ArrowRight className="w-4 h-4" />
        العودة للعروض
      </Link>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500 to-orange-500 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-secondary">
              {mode === "edit" ? "تعديل العرض" : "إضافة عرض جديد"}
            </h1>
            <p className="text-sm text-gray-500">
              {mode === "edit" ? titleAr || initial.title_ar : "أنشئ عرضاً جديداً مع صورة وخصم وفترة صلاحية"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsActive(!isActive)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
              isActive
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-gray-100 text-gray-500 border border-gray-200"
            }`}
            aria-pressed={isActive}
          >
            {isActive ? (
              <>
                <Eye className="w-4 h-4" />
                مفعّل
              </>
            ) : (
              <>
                <EyeOff className="w-4 h-4" />
                مخفي
              </>
            )}
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Image uploader */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              صورة العرض <span className="text-red-500">*</span>
            </label>
            <ImageUploader
              value={imageUrl}
              onChange={setImageUrl}
              folder="offers"
              placeholder="اضغط لرفع صورة العرض (مستطيلة 16:9 موصى بها)"
              aspectRatio="aspect-video"
            />
          </div>

          {/* Title row */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                عنوان العرض بالعربية <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={titleAr}
                onChange={(e) => setTitleAr(e.target.value)}
                placeholder="مثال: خصومات الصيف"
                className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                عنوان العرض بالإنجليزية
              </label>
              <input
                type="text"
                value={titleEn}
                onChange={(e) => setTitleEn(e.target.value)}
                placeholder="Summer Deals"
                dir="ltr"
                className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Discount type + value */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                نوع الخصم
              </label>
              <div className="flex items-center gap-2 h-11">
                <button
                  type="button"
                  onClick={() => setDiscountType("percentage")}
                  className={`flex-1 h-11 rounded-xl text-sm font-medium border transition-colors ${
                    discountType === "percentage"
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  نسبة %
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType("fixed")}
                  className={`flex-1 h-11 rounded-xl text-sm font-medium border transition-colors ${
                    discountType === "fixed"
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  مبلغ ثابت
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {discountLabel} <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder={discountType === "percentage" ? "20" : "5"}
                step="0.01"
                min="0"
                className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            {discountType === "percentage" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  سقف الخصم (ر.س)
                </label>
                <input
                  type="number"
                  value={maxDiscount}
                  onChange={(e) => setMaxDiscount(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="بدون سقف"
                  step="0.01"
                  min="0"
                  className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-xs text-gray-400 mt-1">
                  اختياري — يحد أقصى مبلغ للخصم بالنسبة المئوية
                </p>
              </div>
            )}
          </div>

          {/* Time window */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                بداية العرض <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                نهاية العرض <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="w-full h-11 px-4 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                dir="ltr"
              />
            </div>
          </div>

          {/* Scope picker */}
          <div className="border-t border-gray-100 pt-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">نطاق العرض</h3>
            <p className="text-sm text-gray-500 mb-4">
              حدّد المنتجات أو التصنيفات أو المتاجر التي ينطبق عليها هذا العرض.
            </p>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {(["product", "category", "vendor", "all"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setScopeType(opt)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                    scopeType === opt
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {opt === "product" && "منتجات محددة"}
                  {opt === "category" && "تصنيف كامل"}
                  {opt === "vendor" && "متجر محدد"}
                  {opt === "all" && "كل المنتجات"}
                </button>
              ))}
            </div>

            {scopeType !== "all" && (
              <div className="space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder={`ابحث عن ${scopeType === "product" ? "منتج" : scopeType === "category" ? "تصنيف" : "متجر"}...`}
                    className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {pickerLoading && (
                    <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
                  )}
                  {pickerOptions.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                      {pickerOptions.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => addTarget(opt)}
                          className="w-full text-right px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2"
                        >
                          <span className="flex-1 text-sm text-gray-900 truncate">{opt.label}</span>
                          {opt.secondary && (
                            <span className="text-xs text-gray-400" dir="ltr">{opt.secondary}</span>
                          )}
                          <Check className="w-3.5 h-3.5 text-gray-400" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {targets.filter((t) => t.target_type === pickerType).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {targets
                      .filter((t) => t.target_type === pickerType)
                      .map((t) => (
                        <span
                          key={t.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-sm"
                        >
                          {t.target_id}
                          <button
                            type="button"
                            onClick={() => removeTarget(t.id)}
                            className="hover:text-red-500"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      ))}
                  </div>
                )}
              </div>
            )}
            {scopeType === "all" && (
              <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
                سيُطبَّق هذا العرض على كل المنتجات في المتجر.
              </p>
            )}
          </div>

          {/* Misc settings */}
          <div className="border-t border-gray-100 pt-6 grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                الحد الأدنى للطلب (ر.س)
              </label>
              <input
                type="number"
                value={minOrder}
                onChange={(e) => setMinOrder(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="بدون حد أدنى"
                step="0.01"
                min="0"
                className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ترتيب العرض
              </label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
                className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer h-11">
                <input
                  type="checkbox"
                  checked={isFeatured}
                  onChange={(e) => setIsFeatured(e.target.checked)}
                  className="w-4 h-4 text-primary"
                />
                <span className="text-sm text-gray-700">عرض مميز (يظهر في الصفحة الرئيسية)</span>
              </label>
            </div>
          </div>

          {/* Descriptions */}
          <div className="grid md:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">
                <Info className="w-3.5 h-3.5 text-gray-400" />
                وصف العرض (عربي)
              </label>
              <textarea
                value={descriptionAr}
                onChange={(e) => setDescriptionAr(e.target.value)}
                rows={3}
                className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">
                <Info className="w-3.5 h-3.5 text-gray-400" />
                وصف العرض (إنجليزي)
              </label>
              <textarea
                value={descriptionEn}
                onChange={(e) => setDescriptionEn(e.target.value)}
                rows={3}
                dir="ltr"
                className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50/50">
          <Link
            href={backHref}
            className="px-6 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-white transition-colors"
          >
            إلغاء
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                جاري الحفظ...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                حفظ العرض
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
