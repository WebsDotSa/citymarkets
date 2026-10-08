"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Store, ChevronRight, Loader2, CheckCircle2 } from "lucide-react";
import { useFormFieldIdFromLabel } from "@/hooks/use-form-field-id";

const VENDOR_TYPES = [
  { value: "food_beverage", label: "طعام ومشروبات", icon: "🍽️" },
  { value: "fashion", label: "أزياء", icon: "👗" },
  { value: "gifts", label: "هدايا", icon: "🎁" },
  { value: "electronics", label: "إلكترونيات", icon: "📱" },
  { value: "services", label: "خدمات", icon: "🛠️" },
  { value: "grocery_supermarket", label: "بقالة وسوبرماركت", icon: "🛒" },
  { value: "restaurant_cafe", label: "مطاعم وكافيهات", icon: "🍴" },
  { value: "sweets_bakery", label: "حلويات ومعجنات", icon: "🥐" },
  { value: "pharmacy_health", label: "صيدلية ومستلزمات صحية", icon: "💊" },
  { value: "beauty_cosmetics", label: "تجميل وعطور", icon: "💄" },
  { value: "flowers_plants", label: "ورد ونباتات", icon: "🌹" },
  { value: "books_stationery", label: "كتب وقرطاسية", icon: "📚" },
  { value: "sports_fitness", label: "رياضة ولياقة", icon: "🏋️" },
  { value: "home_appliances", label: "أجهزة منزلية", icon: "🔌" },
  { value: "furniture_home", label: "أثاث وديكور منزل", icon: "🛋️" },
  { value: "jewelry_watches", label: "مجوهرات وساعات", icon: "💍" },
  { value: "cars_auto", label: "سيارات ومستلزمات", icon: "🚗" },
  { value: "pets_animals", label: "حيوانات أليفة", icon: "🐾" },
  { value: "kids_babies", label: "أطفال ورُضع", icon: "🍼" },
  { value: "music_instruments", label: "موسيقى وآلات", icon: "🎸" },
  { value: "tools_industrial", label: "عدد ومستلزمات صناعية", icon: "🧰" },
  { value: "travel_tourism", label: "سفر وسياحة", icon: "✈️" },
  { value: "real_estate", label: "عقارات", icon: "🏠" },
] as const;

const DELIVERY_MODES = [
  { value: "shared", label: "توصيل عبر أسواق سيتي", desc: "مندوبونا يوصلون الطلبات" },
  { value: "own_courier", label: "مندوب خاص بالمتجر", desc: "أنت تتولى التوصيل بنفسك" },
  { value: "pickup_only", label: "استلام فقط من المتجر", desc: "بدون خدمة توصيل" },
] as const;

type FormState = {
  businessNameAr: string;
  businessNameEn: string;
  vendorType: string;
  descriptionAr: string;
  ownerFullName: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerPasswordConfirm: string;
  ownerPhone: string;
  ownerWhatsapp: string;
  addressAr: string;
  city: string;
  deliveryMode: string;
  acceptsCod: boolean;
  acceptsOnlinePayment: boolean;
};

const INITIAL: FormState = {
  businessNameAr: "",
  businessNameEn: "",
  vendorType: "food_beverage",
  descriptionAr: "",
  ownerFullName: "",
  ownerEmail: "",
  ownerPassword: "",
  ownerPasswordConfirm: "",
  ownerPhone: "",
  ownerWhatsapp: "",
  addressAr: "",
  city: "",
  deliveryMode: "shared",
  acceptsCod: true,
  acceptsOnlinePayment: true,
};

const inputClass =
  "w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition bg-white";

export default function VendorRegisterPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Stable ids for every visible label/input pair. Hook order must be
  // stable across renders — declared up here so the `if (submitted)`
  // early-return below doesn't break hook ordering.
  const businessNameArId = useFormFieldIdFromLabel("vendor-register", "اسم المتجر بالعربية");
  const businessNameEnId = useFormFieldIdFromLabel("vendor-register", "اسم المتجر بالإنجليزية");
  const vendorTypeLegendId = useFormFieldIdFromLabel("vendor-register", "نوع النشاط");
  const descriptionArId = useFormFieldIdFromLabel("vendor-register", "وصف مختصر عن المتجر");
  const ownerFullNameId = useFormFieldIdFromLabel("vendor-register", "الاسم الكامل");
  const ownerEmailId = useFormFieldIdFromLabel("vendor-register", "البريد الإلكتروني");
  const ownerPhoneId = useFormFieldIdFromLabel("vendor-register", "رقم الجوال");
  const ownerWhatsappId = useFormFieldIdFromLabel("vendor-register", "رقم الواتساب");
  const ownerPasswordId = useFormFieldIdFromLabel("vendor-register", "كلمة المرور");
  const ownerPasswordConfirmId = useFormFieldIdFromLabel("vendor-register", "تأكيد كلمة المرور");
  const cityId = useFormFieldIdFromLabel("vendor-register", "المدينة");
  const addressArId = useFormFieldIdFromLabel("vendor-register", "عنوان المتجر");
  const deliveryModeLegendId = useFormFieldIdFromLabel("vendor-register", "طريقة التوصيل المفضلة");
  const acceptsCodId = useFormFieldIdFromLabel("vendor-register", "الدفع عند الاستلام");
  const acceptsOnlinePaymentId = useFormFieldIdFromLabel("vendor-register", "الدفع الإلكتروني (بطاقة / آبل باي)");

  const updateField = <K extends keyof FormState>(
    key: K,
    value: FormState[K],
  ) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  function validateStep1(): string | null {
    if (form.businessNameAr.trim().length < 2)
      return "اسم المتجر بالعربية مطلوب (حرفين على الأقل)";
    if (form.descriptionAr.trim().length > 0 && form.descriptionAr.trim().length < 10)
      return "الوصف يجب أن يكون 10 أحرف على الأقل أو اتركه فارغاً";
    return null;
  }

  function validateStep2(): string | null {
    if (form.ownerFullName.trim().length < 2) return "اسم المالك مطلوب";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.ownerEmail.trim()))
      return "البريد الإلكتروني غير صالح";
    if (form.ownerPassword.length < 8)
      return "كلمة المرور يجب أن تكون 8 أحرف على الأقل";
    if (form.ownerPassword !== form.ownerPasswordConfirm)
      return "كلمتا المرور غير متطابقتين";
    if (!/^[+\d][\d\s\-()]{5,20}$/.test(form.ownerPhone.trim()))
      return "رقم الجوال غير صالح";
    return null;
  }

  function goNext() {
    setError(null);
    const err = step === 1 ? validateStep1() : validateStep2();
    if (err) {
      setError(err);
      return;
    }
    setStep((s) => (s + 1) as 1 | 2 | 3);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/vendor-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessNameAr: form.businessNameAr,
          businessNameEn: form.businessNameEn || undefined,
          vendorType: form.vendorType,
          descriptionAr: form.descriptionAr || undefined,
          ownerFullName: form.ownerFullName,
          ownerEmail: form.ownerEmail,
          ownerPassword: form.ownerPassword,
          ownerPhone: form.ownerPhone,
          ownerWhatsapp: form.ownerWhatsapp || undefined,
          addressAr: form.addressAr || undefined,
          city: form.city || undefined,
          deliveryMode: form.deliveryMode,
          acceptsCod: form.acceptsCod,
          acceptsOnlinePayment: form.acceptsOnlinePayment,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "فشل إرسال الطلب");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("حدث خطأ في الاتصال. حاول مرة أخرى.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-white flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-lg w-full text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-12 h-12 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            تم استلام طلبك بنجاح! 🎉
          </h1>
          <p className="text-gray-600 mb-2">
            شكراً لاهتمامك بالانضمام إلى أسواق سيتي.
          </p>
          <p className="text-gray-600 mb-6">
            سيقوم فريقنا بمراجعة طلبك خلال <strong>1-3 أيام عمل</strong> والتواصل معك على البريد{" "}
            <strong className="text-primary" dir="text-primary">{form.ownerEmail}</strong>{" "}
            لإبلاغك بنتيجة المراجعة وبيانات الدخول إلى لوحة التحكم.
          </p>
          <Link
            href="/"
            className="inline-block bg-primary text-white px-6 py-3 rounded-xl hover:bg-primary-dark transition"
          >
            العودة للرئيسية
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 via-white to-white py-10 px-4" dir="rtl">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/20">
            <Store className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">
            افتح متجرك على أسواق سيتي
          </h1>
          <p className="text-gray-600 max-w-xl mx-auto">
            انضم لمئات المتاجر الناجحة. سجّل بياناتك الآن وسيتواصل معك فريقنا خلال أيام قليلة.
          </p>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-3 mb-8">
          {[
            { n: 1, label: "بيانات المتجر" },
            { n: 2, label: "بيانات المالك" },
            { n: 3, label: "التفاصيل" },
          ].map((s) => (
            <div key={s.n} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition ${
                  step >= s.n
                    ? "bg-primary text-white"
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                {s.n}
              </div>
              <span
                className={`text-sm hidden sm:inline ${
                  step >= s.n ? "text-gray-900 font-medium" : "text-gray-400"
                }`}
              >
                {s.label}
              </span>
              {s.n < 3 && <ChevronRight className="w-4 h-4 text-gray-300 rotate-180" />}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl p-6 md:p-8 space-y-5">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              {error}
            </div>
          )}

          {step === 1 && (
            <>
              <h2 className="text-xl font-bold text-gray-900 mb-2">بيانات المتجر</h2>

              <div>
                <label
                  htmlFor={businessNameArId}
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  اسم المتجر بالعربية <span className="text-red-500">*</span>
                </label>
                <input
                  id={businessNameArId}
                  type="text"
                  value={form.businessNameAr}
                  onChange={(e) => updateField("businessNameAr", e.target.value)}
                  className={inputClass}
                  placeholder="مثال: قهوة الأماز"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor={businessNameEnId}
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  اسم المتجر بالإنجليزية (اختياري)
                </label>
                <input
                  id={businessNameEnId}
                  type="text"
                  value={form.businessNameEn}
                  onChange={(e) => updateField("businessNameEn", e.target.value)}
                  className={inputClass}
                  placeholder="Example: Amaze Coffee"
                />
              </div>

              <div>
                <label
                  id={vendorTypeLegendId}
                  className="block text-sm font-medium text-gray-700 mb-3"
                >
                  نوع النشاط <span className="text-red-500">*</span>
                </label>
                <div
                  className="grid grid-cols-2 sm:grid-cols-3 gap-3"
                  role="radiogroup"
                  aria-labelledby={vendorTypeLegendId}
                >
                  {VENDOR_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => updateField("vendorType", t.value)}
                      className={`p-3 rounded-2xl border-2 text-center transition ${
                        form.vendorType === t.value
                          ? "border-primary bg-primary/5"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="text-2xl mb-1">{t.icon}</div>
                      <div className="text-sm font-medium text-gray-900">
                        {t.label}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label
                  htmlFor={descriptionArId}
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  وصف مختصر عن المتجر (اختياري)
                </label>
                <textarea
                  id={descriptionArId}
                  value={form.descriptionAr}
                  onChange={(e) => updateField("descriptionAr", e.target.value)}
                  rows={3}
                  className={inputClass}
                  placeholder="اكتب وصفاً قصيراً عن نشاطك وميزاتك"
                />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-xl font-bold text-gray-900 mb-2">بيانات المالك</h2>
              <p className="text-sm text-gray-500 mb-4">
                ستحتاج هذه البيانات لتسجيل الدخول إلى لوحة تحكم المتجر بعد الموافقة.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor={ownerFullNameId}
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    الاسم الكامل <span className="text-red-500">*</span>
                  </label>
                  <input
                    id={ownerFullNameId}
                    type="text"
                    value={form.ownerFullName}
                    onChange={(e) => updateField("ownerFullName", e.target.value)}
                    className={inputClass}
                    placeholder="الاسم الثلاثي"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor={ownerEmailId}
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    البريد الإلكتروني <span className="text-red-500">*</span>
                  </label>
                  <input
                    id={ownerEmailId}
                    type="email"
                    value={form.ownerEmail}
                    onChange={(e) => updateField("ownerEmail", e.target.value)}
                    className={inputClass}
                    placeholder="owner@example.com"
                    required
                    dir="ltr"
                  />
                </div>

                <div>
                  <label
                    htmlFor={ownerPhoneId}
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    رقم الجوال <span className="text-red-500">*</span>
                  </label>
                  <input
                    id={ownerPhoneId}
                    type="tel"
                    value={form.ownerPhone}
                    onChange={(e) => updateField("ownerPhone", e.target.value)}
                    className={inputClass}
                    placeholder="05xxxxxxxx"
                    required
                    dir="ltr"
                  />
                </div>

                <div>
                  <label
                    htmlFor={ownerWhatsappId}
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    رقم الواتساب (اختياري)
                  </label>
                  <input
                    id={ownerWhatsappId}
                    type="tel"
                    value={form.ownerWhatsapp}
                    onChange={(e) => updateField("ownerWhatsapp", e.target.value)}
                    className={inputClass}
                    placeholder="9665xxxxxxxx"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div>
                  <label
                    htmlFor={ownerPasswordId}
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    كلمة المرور <span className="text-red-500">*</span>
                  </label>
                  <input
                    id={ownerPasswordId}
                    type="password"
                    value={form.ownerPassword}
                    onChange={(e) => updateField("ownerPassword", e.target.value)}
                    className={inputClass}
                    placeholder="8 أحرف على الأقل"
                    required
                    minLength={8}
                  />
                </div>
                <div>
                  <label
                    htmlFor={ownerPasswordConfirmId}
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    تأكيد كلمة المرور <span className="text-red-500">*</span>
                  </label>
                  <input
                    id={ownerPasswordConfirmId}
                    type="password"
                    value={form.ownerPasswordConfirm}
                    onChange={(e) =>
                      updateField("ownerPasswordConfirm", e.target.value)
                    }
                    className={inputClass}
                    placeholder="أعد إدخال كلمة المرور"
                    required
                    minLength={8}
                  />
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-xl font-bold text-gray-900 mb-2">تفاصيل إضافية</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor={cityId}
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    المدينة (اختياري)
                  </label>
                  <input
                    id={cityId}
                    type="text"
                    value={form.city}
                    onChange={(e) => updateField("city", e.target.value)}
                    className={inputClass}
                    placeholder="الرياض"
                  />
                </div>
                <div>
                  <label
                    htmlFor={addressArId}
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    عنوان المتجر (اختياري)
                  </label>
                  <input
                    id={addressArId}
                    type="text"
                    value={form.addressAr}
                    onChange={(e) => updateField("addressAr", e.target.value)}
                    className={inputClass}
                    placeholder="الحي، الشارع"
                  />
                </div>
              </div>

              <div>
                <label
                  id={deliveryModeLegendId}
                  className="block text-sm font-medium text-gray-700 mb-3"
                >
                  طريقة التوصيل المفضلة
                </label>
                <div
                  className="space-y-2"
                  role="radiogroup"
                  aria-labelledby={deliveryModeLegendId}
                >
                  {DELIVERY_MODES.map((m) => (
                    <label
                      key={m.value}
                      className={`flex items-start gap-3 p-4 rounded-2xl border-2 cursor-pointer transition ${
                        form.deliveryMode === m.value
                          ? "border-primary bg-primary/5"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="deliveryMode"
                        value={m.value}
                        checked={form.deliveryMode === m.value}
                        onChange={() => updateField("deliveryMode", m.value)}
                        className="mt-1 accent-primary"
                      />
                      <div>
                        <div className="font-medium text-gray-900">{m.label}</div>
                        <div className="text-sm text-gray-500">{m.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  طرق الدفع المقبولة
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={form.acceptsCod}
                      onChange={(e) => updateField("acceptsCod", e.target.checked)}
                      className="w-5 h-5 accent-primary"
                    />
                    <span className="text-gray-900">الدفع عند الاستلام</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={form.acceptsOnlinePayment}
                      onChange={(e) =>
                        updateField("acceptsOnlinePayment", e.target.checked)
                      }
                      className="w-5 h-5 accent-primary"
                    />
                    <span className="text-gray-900">
                      الدفع الإلكتروني (بطاقة / آبل باي)
                    </span>
                  </label>
                </div>
              </div>
            </>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-between gap-3 pt-4 border-t">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
                className="px-5 py-3 rounded-xl text-gray-700 hover:bg-gray-100 transition"
                disabled={submitting}
              >
                السابق
              </button>
            ) : (
              <div />
            )}
            {step < 3 ? (
              <button
                type="button"
                onClick={goNext}
                className="px-6 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary-dark transition flex items-center gap-2"
              >
                التالي
                <ChevronRight className="w-4 h-4 rotate-180" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary-dark transition flex items-center gap-2 disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    جاري إرسال الطلب...
                  </>
                ) : (
                  "إرسال الطلب"
                )}
              </button>
            )}
          </div>
        </form>

        <p className="text-center text-xs text-gray-500 mt-6">
          بإرسالك الطلب فأنت توافق على{" "}
          <Link href="/terms" className="text-primary hover:underline">
            شروط الاستخدام
          </Link>{" "}
          و{" "}
          <Link href="/privacy" className="text-primary hover:underline">
            سياسة الخصوصية
          </Link>
        </p>
      </div>
    </div>
  );
}