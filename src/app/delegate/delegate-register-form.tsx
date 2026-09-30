"use client";

import { getApiErrorMessage } from "@/lib/api-error";
import { useState } from "react";
import { Loader2, CheckCircle, Send } from "lucide-react";

export function DelegateRegisterForm() {
  // Operator decision (2026-09-20): CV upload + city picker were
  // dropped from the delegate registration surface to remove the
  // "السيرة مطلوبة" friction. The API still accepts an optional CV
  // (cv_url/cv_filename/cv_size_bytes), but the form no longer prompts
  // for one. City is now implicit (Riyadh-only for this launch); admins
  // can update it during onboarding.
  const [form, setForm] = useState({
    name: "",
    phone: "",
    vehicle: "car",
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/employment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.name,
          phone: form.phone,
          job_id: "delivery",
          message: `نوع المركبة: ${form.vehicle}`,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSubmitted(true);
      } else {
        setError(getApiErrorMessage(data, "حدث خطأ أثناء تقديم الطلب"));
      }
    } catch {
      setError("تعذر الاتصال بالسيرفر، يرجى المحاولة لاحقاً");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-white text-gray-900 rounded-2xl p-8 max-w-md mx-auto text-center shadow-xl">
        <CheckCircle className="w-12 h-12 text-primary mx-auto mb-4" />
        <h3 className="text-xl font-bold mb-2">تم استلام طلبك بنجاح!</h3>
        <p className="text-gray-600 text-sm">
          شكراً لاهتمامك بالانضمام لفريق مندوبي أسواق سيتي. سيتواصل معك فريق التوظيف خلال 24-48 ساعة.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white text-gray-900 rounded-2xl p-6 md:p-8 max-w-md mx-auto shadow-xl text-right space-y-4">
      <h3 className="text-xl font-bold text-gray-900 text-center mb-2">تسجيل مندوب جديد</h3>
      {error && (
        <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm border border-red-200">
          {error}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">الاسم الكامل *</label>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="أدخل اسمك الثلاثي"
          className="w-full h-11 px-4 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-primary"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">رقم الجوال *</label>
        <input
          type="tel"
          required
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="05xxxxxxxx"
          dir="ltr"
          className="w-full h-11 px-4 border border-gray-300 rounded-xl text-sm text-right focus:outline-none focus:border-primary"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">نوع المركبة *</label>
        <select
          value={form.vehicle}
          onChange={(e) => setForm({ ...form, vehicle: e.target.value })}
          className="w-full h-11 px-4 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-primary bg-white"
        >
          <option value="car">سيارة خاصة</option>
          <option value="motorcycle">دراجة نارية</option>
          <option value="van">فان / نقل</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full h-12 bg-primary text-white font-bold rounded-xl hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <>
            <Send className="w-4 h-4" />
            <span>إرسال طلب الانضمام</span>
          </>
        )}
      </button>
    </form>
  );
}