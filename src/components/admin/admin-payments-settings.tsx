"use client";

import { useEffect, useState } from "react";

const adminCred: RequestInit = { credentials: "include" };

export function AdminPaymentsSettings() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/settings/payments", adminCred)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setConfig(res.config);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <p className="text-gray-500">جاري التحميل…</p>;
  }

  const m = config?.moyasar || {};

  return (
    <div className="max-w-2xl space-y-4 rounded-xl border bg-white p-6">
      <h2 className="text-lg font-semibold">إعدادات الدفع</h2>
      <p className="text-sm text-gray-600">الموقع: {config?.site_url}</p>

      <div className="rounded-lg border border-gray-200 p-4 space-y-2">
        <h3 className="font-semibold text-sm text-gray-800">ميسر (Moyasar)</h3>
        <ul className="text-sm space-y-1.5">
          <li>ميسر مضبوط: {m.configured ? "نعم" : "لا"}</li>
          <li>مفتاح عام: {m.publishable_key_set ? "موجود" : "غير موجود"}</li>
          <li>مفتاح سري: {m.secret_key_set ? "موجود" : "غير موجود"}</li>
          <li>رابط العودة: {m.callback_url}</li>
        </ul>
        <p className="text-xs text-amber-700">{m.webhook_note}</p>
      </div>

      <div className="rounded-lg border border-gray-200 p-4 space-y-2">
        <h3 className="font-semibold text-sm text-gray-800">Apple Pay</h3>
        <p className="text-sm">
          النطاق: {config?.apple_pay?.domain} —{" "}
          <a
            href={config?.apple_pay?.association_file}
            className="text-primary-600 underline"
          >
            ملف التحقق
          </a>
        </p>
      </div>

      <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-4 space-y-2">
        <h3 className="font-semibold text-sm text-primary-800">
          التحويل البنكي — مصرف الراجحي
        </h3>
        <ul className="text-sm space-y-1.5 text-gray-800">
          <li>
            <span className="text-gray-500">اسم الحساب:</span>{" "}
            مؤسسة اسواق سيتي المركزية للمواد الغذائية
          </li>
          <li>
            <span className="text-gray-500">رقم الآيبان:</span>{" "}
            <span dir="ltr" className="font-mono">
              SA9580000422608016336661
            </span>
          </li>
          <li className="text-xs text-gray-500">
            يثقّل النظام الدفع عند الاستلام تلقائياً بعد تأكيد الإدارة للإيصال
            المُرفق مع الطلب
          </li>
        </ul>
      </div>

      <div className="rounded-lg border border-gray-200 p-4 space-y-1.5">
        <h3 className="font-semibold text-sm text-gray-800">الطرق المتاحة للعميل</h3>
        <p className="text-sm">
          {(config?.supported_methods || []).join("، ")}
        </p>
        <p className="text-xs text-gray-500">
          تم تعطيل الدفع عند الاستلام وSTC Pay وتمارا بناءً على قرار التشغيل
          بتاريخ 20-09-2026
        </p>
      </div>
    </div>
  );
}