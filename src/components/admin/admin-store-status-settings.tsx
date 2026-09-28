"use client";

import { useEffect, useState } from "react";
import { Power, Save, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";

const adminCred: RequestInit = { credentials: "include" };

type StoreStatus = {
  is_open: boolean;
  message: string;
};

const DEFAULT_MESSAGE =
  "الموقع مغلق مؤقتاً — لا يمكن الشراء الآن عبر الموقع، يمكنكم التسوق من التطبيق أو العودة لاحقاً";

export function AdminStoreStatusSettings() {
  const [status, setStatus] = useState<StoreStatus>({
    is_open: true,
    message: DEFAULT_MESSAGE,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/admin/settings/store-status", { ...adminCred, signal: ac.signal })
      .then((r) => r.json())
      .then((res) => {
        if (ac.signal.aborted) return;
        if (res.success && res.settings) {
          setStatus({
            is_open: res.settings.is_open !== false,
            message: res.settings.message || DEFAULT_MESSAGE,
          });
        }
        setLoading(false);
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await csrfFetch("/api/admin/settings/store-status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(status),
        ...adminCred,
      }).then((r) => r.json());
      if (!res.success) {
        showToast(res.error || "فشل الحفظ", "error");
      } else {
        showToast("تم حفظ الإعدادات", "success");
        if (res.settings) {
          setStatus({
            is_open: res.settings.is_open !== false,
            message: res.settings.message || DEFAULT_MESSAGE,
          });
        }
      }
    } catch {
      showToast("تعذر الاتصال بالخادم", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-gray-500">جاري التحميل…</p>;
  }

  return (
    <div className="max-w-2xl space-y-5 rounded-xl border bg-white p-6">
      <header className="flex items-center gap-3 border-b border-gray-100 pb-4">
        <Power className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-lg font-semibold">حالة الموقع</h2>
          <p className="text-xs text-gray-500">
            إغلاق الموقع يخفي الشراء ويظهر إشعاراً ثابتاً للزوار
          </p>
        </div>
      </header>

      {/* Toggle */}
      <label className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 p-4">
        <div>
          <span className="block text-sm font-semibold text-gray-800">
            {status.is_open ? "الموقع مفتوح للشراء" : "الموقع مغلق — لا يمكن الشراء"}
          </span>
          <span className="block text-xs text-gray-500 mt-0.5">
            {status.is_open
              ? "الزوار يستطيعون إتمام الطلبات بشكل طبيعي"
              : "سيظهر إشعار ثابت في أعلى الموقع وسيتم رفض الطلبات الجديدة"}
          </span>
        </div>
        <span
          role="switch"
          aria-checked={!status.is_open}
          tabIndex={0}
          onClick={() => setStatus((s) => ({ ...s, is_open: !s.is_open }))}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              setStatus((s) => ({ ...s, is_open: !s.is_open }));
            }
          }}
          className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
            status.is_open ? "bg-gray-300" : "bg-red-600"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              status.is_open ? "translate-x-1" : "translate-x-6"
            }`}
          />
        </span>
      </label>

      {/* Banner message */}
      <label className="block">
        <span className="text-sm font-semibold text-gray-800">
          نص الإشعار الذي يظهر للزوار
        </span>
        <textarea
          value={status.message}
          onChange={(e) => setStatus((s) => ({ ...s, message: e.target.value }))}
          rows={3}
          maxLength={500}
          className="mt-2 w-full border rounded-lg px-3 py-2 text-sm"
          placeholder={DEFAULT_MESSAGE}
        />
        <span className="mt-1 block text-xs text-gray-500">
          {status.message.length} / 500 حرف — اتركه فارغاً لاستخدام النص الافتراضي
        </span>
      </label>

      {!status.is_open && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            تنبيه: الموقع مغلق حالياً. لن يستطيع أي زائر إنشاء طلب جديد، وسيظهر
            الإشعار الأحمر أعلى الموقع على كل الصفحات.
          </span>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? "جاري الحفظ…" : "حفظ"}
        </button>
      </div>
    </div>
  );
}
