"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";

const adminCred: RequestInit = { credentials: "include" };

export function AdminNotificationsSettings() {
  const [phone, setPhone] = useState("");
  const [notify, setNotify] = useState(true);
  const [template, setTemplate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/admin/settings/notifications", { ...adminCred, signal: ac.signal })
      .then((r) => r.json())
      .then((res) => {
        if (ac.signal.aborted) return;
        if (res.success && res.settings) {
          setPhone(res.settings.whatsapp_admin_phone || "");
          setNotify(res.settings.notify_new_order !== false);
          setTemplate(res.settings.message_template || "");
        }
        setLoading(false);
      })
      .catch(() => {});
    return () => ac.abort();
  }, []);

  const save = async () => {
    setSaving(true);
    const res = await csrfFetch("/api/admin/settings/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        whatsapp_admin_phone: phone,
        notify_new_order: notify,
        message_template: template,
      }),
      ...adminCred,
    }).then((r) => r.json());
    setSaving(false);
    if (!res.success) showToast(res.error || "فشل الحفظ", "error");
    else showToast("تم حفظ الإعدادات", "success");
  };

  const preview = async () => {
    const res = await csrfFetch("/api/admin/settings/notifications", {
      method: "POST",
      ...adminCred,
    }).then((r) => r.json());
    if (res.success) setPreviewUrl(res.whatsapp_url);
  };

  if (loading) {
    return (
      <p className="text-gray-500">جاري التحميل…</p>
    );
  }

  return (
    <div className="max-w-xl space-y-4 rounded-xl border bg-white p-6">
        <h2 className="text-lg font-semibold">إشعارات الطلبات</h2>
        <label className="block">
          <span className="text-sm text-gray-600">رقم واتساب المدير</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2"
            placeholder="9665xxxxxxxx"
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>إشعار عند طلب جديد</span>
        </label>
        <label className="block">
          <span className="text-sm text-gray-600">قالب الرسالة</span>
          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={4}
            className="mt-1 w-full border rounded-lg px-3 py-2"
          />
          <span className="text-xs text-gray-500">المتغيرات: order_id, customer, total</span>
        </label>
        <div>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white disabled:opacity-50"
          >
            {saving ? "جاري الحفظ…" : "حفظ"}
          </button>
          <button type="button" onClick={preview} className="px-4 py-2 rounded-lg border">
            معاينة واتساب
          </button>
        </div>
        {previewUrl && (
          <a href={previewUrl} target="_blank" rel="noreferrer" className="text-primary-600 text-sm">
            فتح رابط واتساب التجريبي
          </a>
        )}
    </div>
  );
}
