"use client";

import { useEffect, useState, use } from "react";
import { csrfFetch } from "@/lib/csrf-client";
import { useFormFieldIdFromLabel } from "@/hooks/use-form-field-id";
import { useVendorRole } from "../_lib/vendor-role-context";

interface SettingsPageProps {
  params: Promise<{ slug: string }>;
}

interface VendorSettings {
  vendor: {
    name: string;
    nameEn?: string;
    description?: string;
    logo?: string;
    banner?: string;
    primaryColor: string;
    contact: {
      phone?: string;
      email?: string;
      whatsapp?: string;
    };
    address?: string;
    openTime: string;
    closeTime: string;
  };
  settings: {
    deliveryMode: string;
    deliveryFeeOverride?: number;
    minOrderAmount?: number;
    acceptsCod: boolean;
    acceptsOnlinePayment: boolean;
    notifyWhatsapp?: string;
    notifyEmail?: string;
    seo: {
      title?: string;
      description?: string;
    };
  };
}

export default function VendorSettingsPage({ params }: SettingsPageProps) {
  const { slug } = use(params);
  const { canDo, isReadOnly } = useVendorRole();
  const canManage = canDo("manage_settings");
  const [settings, setSettings] = useState<VendorSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState<any>({});

  // Stable ids for every visible label/input pair so screen readers
  // associate each label with its control. Declared before the
  // `if (loading)` early-return so React's hook order stays stable.
  const nameArId = useFormFieldIdFromLabel("vendor-settings", "اسم المتجر (عربي) *");
  const nameEnId = useFormFieldIdFromLabel("vendor-settings", "اسم المتجر (إنجليزي)");
  const descriptionId = useFormFieldIdFromLabel("vendor-settings", "وصف المتجر");
  const primaryColorId = useFormFieldIdFromLabel("vendor-settings", "لون المتجر");
  const primaryColorHexId = useFormFieldIdFromLabel("vendor-settings", "لون المتجر (hex)");
  const phoneId = useFormFieldIdFromLabel("vendor-settings", "رقم الجوال");
  const whatsappId = useFormFieldIdFromLabel("vendor-settings", "واتساب");
  const addressId = useFormFieldIdFromLabel("vendor-settings", "العنوان");
  const openTimeId = useFormFieldIdFromLabel("vendor-settings", "وقت الفتح");
  const closeTimeId = useFormFieldIdFromLabel("vendor-settings", "وقت الإغلاق");
  const deliveryModeId = useFormFieldIdFromLabel("vendor-settings", "طريقة التوصيل");
  const deliveryFeeId = useFormFieldIdFromLabel("vendor-settings", "رسوم التوصيل (ر.س) — غير نشط");
  const minOrderId = useFormFieldIdFromLabel("vendor-settings", "الحد الأدنى للطلب (ر.س)");
  const seoTitleId = useFormFieldIdFromLabel("vendor-settings", "عنوان الصفحة");
  const seoDescId = useFormFieldIdFromLabel("vendor-settings", "وصف الصفحة");

  useEffect(() => {
    fetchSettings();
  }, [slug]);

  async function fetchSettings() {
    try {
      const res = await fetch("/api/v1/vendor/settings");
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setFormData({
          name: data.vendor.name,
          nameEn: data.vendor.nameEn || "",
          description: data.vendor.description || "",
          primaryColor: data.vendor.primaryColor || "#009345",
          contactPhone: data.vendor.contact.phone || "",
          contactWhatsapp: data.vendor.contact.whatsapp || "",
          address: data.vendor.address || "",
          openTime: data.vendor.openTime || "09:00",
          closeTime: data.vendor.closeTime || "23:00",
          deliveryMode: data.settings.deliveryMode || "shared",
          deliveryFeeOverride: data.settings.deliveryFeeOverride || "",
          minOrderAmount: data.settings.minOrderAmount || "",
          acceptsCod: data.settings.acceptsCod,
          acceptsOnlinePayment: data.settings.acceptsOnlinePayment,
          notifyWhatsapp: data.settings.notifyWhatsapp || "",
          seoTitle: data.settings.seo.title || "",
          seoDescription: data.settings.seo.description || "",
        });
      }
    } catch (error) {
      console.error("Fetch settings error:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);

    try {
      const res = await csrfFetch("/api/v1/vendor/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor: {
            name: formData.name,
            nameEn: formData.nameEn || null,
            description: formData.description || null,
            primaryColor: formData.primaryColor,
            contactPhone: formData.contactPhone || null,
            contactWhatsapp: formData.contactWhatsapp || null,
            address: formData.address || null,
            openTime: formData.openTime,
            closeTime: formData.closeTime,
          },
          settings: {
            deliveryMode: formData.deliveryMode,
            deliveryFeeOverride: formData.deliveryFeeOverride || null,
            minOrderAmount: formData.minOrderAmount || null,
            acceptsCod: formData.acceptsCod,
            acceptsOnlinePayment: formData.acceptsOnlinePayment,
            notifyWhatsapp: formData.notifyWhatsapp || null,
            seoTitle: formData.seoTitle || null,
            seoDescription: formData.seoDescription || null,
          },
        }),
      });

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (error) {
      console.error("Save settings error:", error);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-32 bg-gray-100 rounded animate-pulse" />
        <div className="bg-white rounded-2xl p-6 space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">الإعدادات</h1>
        <p className="text-gray-500">إعدادات المتجر وطرق الدفع</p>
      </div>

      {isReadOnly && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
        >
          وضع القراءة فقط — لا يمكنك تعديل الإعدادات بهذه الصلاحية. اطلب من المالك أو المدير إجراء التغييرات.
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6" aria-disabled={!canManage}>
        {/* `fieldset disabled` cascades: every input/select/checkbox
            below becomes read-only when the role lacks
            `manage_settings`, so a staff/viewer can't even attempt
            to mutate the form. */}
        <fieldset disabled={!canManage} className="space-y-6 m-0 p-0 border-0">
        {/* Basic Info */}
        <div className="bg-white rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-gray-900">معلومات المتجر</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor={nameArId}
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                اسم المتجر (عربي) *
              </label>
              <input
                id={nameArId}
                type="text"
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
                required
              />
            </div>

            <div>
              <label
                htmlFor={nameEnId}
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                اسم المتجر (إنجليزي)
              </label>
              <input
                id={nameEnId}
                type="text"
                value={formData.nameEn || ""}
                onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor={descriptionId}
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              وصف المتجر
            </label>
            <textarea
              id={descriptionId}
              value={formData.description || ""}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor={primaryColorId}
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                لون المتجر
              </label>
              <div className="flex gap-2">
                <input
                  id={primaryColorId}
                  type="color"
                  value={formData.primaryColor || "#009345"}
                  onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
                  className="w-12 h-10 rounded-lg border cursor-pointer"
                  aria-label="لون المتجر (محدد)"
                />
                <input
                  id={primaryColorHexId}
                  type="text"
                  value={formData.primaryColor || "#009345"}
                  onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
                  className="flex-1 px-4 py-2 rounded-xl border focus:border-primary outline-none"
                  aria-label="لون المتجر (hex)"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Contact Info */}
        <div className="bg-white rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-gray-900">معلومات التواصل</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor={phoneId}
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                رقم الجوال
              </label>
              <input
                id={phoneId}
                type="tel"
                value={formData.contactPhone || ""}
                onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
              />
            </div>

            <div>
              <label
                htmlFor={whatsappId}
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                واتساب
              </label>
              <input
                id={whatsappId}
                type="tel"
                value={formData.contactWhatsapp || ""}
                onChange={(e) => setFormData({ ...formData, contactWhatsapp: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor={addressId}
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              العنوان
            </label>
            <input
              id={addressId}
              type="text"
              value={formData.address || ""}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
            />
          </div>
        </div>

        {/* Business Hours */}
        <div className="bg-white rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-gray-900">أوقات العمل</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor={openTimeId}
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                وقت الفتح
              </label>
              <input
                id={openTimeId}
                type="time"
                value={formData.openTime || "09:00"}
                onChange={(e) => setFormData({ ...formData, openTime: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
              />
            </div>

            <div>
              <label
                htmlFor={closeTimeId}
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                وقت الإغلاق
              </label>
              <input
                id={closeTimeId}
                type="time"
                value={formData.closeTime || "23:00"}
                onChange={(e) => setFormData({ ...formData, closeTime: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
              />
            </div>
          </div>
        </div>

        {/* Delivery & Payment */}
        <div className="bg-white rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-gray-900">التوصيل والدفع</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor={deliveryModeId}
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                طريقة التوصيل
              </label>
              <select
                id={deliveryModeId}
                value={formData.deliveryMode || "shared"}
                onChange={(e) => setFormData({ ...formData, deliveryMode: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
              >
                <option value="shared">نفس خدمة توصيل سيتي</option>
                <option value="own_courier">توصيل خاص</option>
                <option value="pickup_only">استلام فقط</option>
              </select>
            </div>

            <div>
              {/* Migration 078 (2026-09-30): `delivery_fee_override` is
                  no longer honored by the checkout pipeline — distance
                  pricing is universal (computed from `stores.is_main`).
                  The column is kept on `vendor_settings` for backward-
                  compat (iOS / data-export reads), but the vendor UI
                  no longer surfaces it. To re-introduce per-vendor
                  overrides, see `src/lib/orders/checkout/pricing.ts`. */}
              <label
                htmlFor={deliveryFeeId}
                className="block text-sm font-medium text-gray-400 mb-1"
              >
                رسوم التوصيل (ر.س) — غير نشط
              </label>
              <input
                id={deliveryFeeId}
                type="number"
                step="0.01"
                value={formData.deliveryFeeOverride || ""}
                disabled
                title="تم تعطيل رسوم التوصيل الخاصة بكل بائع — السعر يحتسب آلياً من المسافة (راجع إعدادات التوصيل في لوحة المدير)."
                className="w-full px-4 py-2 rounded-xl border bg-gray-50 text-gray-400 cursor-not-allowed outline-none"
                placeholder="يُحتسب آلياً من المسافة"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor={minOrderId}
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              الحد الأدنى للطلب (ر.س)
            </label>
            <input
              id={minOrderId}
              type="number"
              step="0.01"
              value={formData.minOrderAmount || ""}
              onChange={(e) => setFormData({ ...formData, minOrderAmount: e.target.value })}
              className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.acceptsCod}
                onChange={(e) => setFormData({ ...formData, acceptsCod: e.target.checked })}
                className="w-4 h-4"
                aria-label="الدفع عند الاستلام"
              />
              <span className="text-sm">الدفع عند الاستلام</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.acceptsOnlinePayment}
                onChange={(e) => setFormData({ ...formData, acceptsOnlinePayment: e.target.checked })}
                className="w-4 h-4"
                aria-label="الدفع الإلكتروني (بطاقة/آبل باي)"
              />
              <span className="text-sm">الدفع الإلكتروني (بطاقة/آبل باي)</span>
            </label>
          </div>
        </div>

        {/* SEO */}
        <div className="bg-white rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-gray-900">إعدادات SEO</h2>

          <div>
            <label
              htmlFor={seoTitleId}
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              عنوان الصفحة
            </label>
            <input
              id={seoTitleId}
              type="text"
              value={formData.seoTitle || ""}
              onChange={(e) => setFormData({ ...formData, seoTitle: e.target.value })}
              className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
            />
          </div>

          <div>
            <label
              htmlFor={seoDescId}
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              وصف الصفحة
            </label>
            <textarea
              id={seoDescId}
              value={formData.seoDescription || ""}
              onChange={(e) => setFormData({ ...formData, seoDescription: e.target.value })}
              className="w-full px-4 py-2 rounded-xl border focus:border-primary outline-none"
              rows={3}
            />
          </div>
        </div>

        {/* Success/Error messages */}
        {success && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-green-600 text-sm">
            ✓ تم حفظ الإعدادات بنجاح
          </div>
        )}

        {/* Submit */}
        {canManage ? (
          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 disabled:opacity-50 transition"
          >
            {saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
          </button>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
            لا تملك صلاحية حفظ الإعدادات. الإعدادات الحالية للعرض فقط.
          </div>
        )}
        </fieldset>
      </form>
    </div>
  );
}
