"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { DataTable } from "@/components/admin/data-table";
import { AdminForm } from "@/components/admin/admin-form";
import { useToast, useConfirm } from "@/components/ui/toast";
import { safeFetchJson } from "@/lib/safe-fetch";
import { csrfFetch } from "@/lib/csrf-client";

const adminCred: RequestInit = { credentials: "include" };

type View = "list" | "new" | "edit";

type Store = {
  id: string;
  name_ar: string;
  name?: string;
  address: string;
  lat: number | string;
  lng: number | string;
  phone?: string;
  is_main?: boolean;
  is_active?: boolean;
};

const fields = [
  { key: "name_ar", label: "اسم الفرع (عربي)", type: "text" as const, required: true },
  { key: "name", label: "الاسم بالإنجليزية", type: "text" as const },
  { key: "address", label: "العنوان", type: "text" as const, required: true },
  { key: "lat", label: "خط العرض (Latitude)", type: "number" as const, required: true },
  { key: "lng", label: "خط الطول (Longitude)", type: "number" as const, required: true },
  { key: "phone", label: "رقم الهاتف", type: "text" as const },
  { key: "is_main", label: "فرع رئيسي", type: "checkbox" as const },
  { key: "is_active", label: "نشط", type: "checkbox" as const },
];

export function AdminStores() {
  const [view, setView] = useState<View>("list");
  const [stores, setStores] = useState<Store[]>([]);
  const [editing, setEditing] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    const res = await safeFetchJson<{ success: boolean; data: Store[] }>(
      "/api/admin/stores",
      { ...adminCred, signal }
    );
    if (signal?.aborted) return;
    if (res?.success) setStores(res.data);
    setLoading(false);
  };

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, []);

  const handleDelete = async (item: any) => {
    if (!(await confirm({ title: "حذف فرع", message: `حذف الفرع "${item.name || item.name_ar}"؟`, danger: true }))) return;
    const res = await csrfFetch(`/api/admin/stores?id=${item.id}`, { method: "DELETE", ...adminCred }).then((r) => r.json());
    if (!res.success) {
      showToast(res.error || "فشل الحذف", "error");
    } else {
      load();
      showToast("تم حذف الفرع", "success");
    }
  };

  const handleSubmit = async (data: Record<string, unknown>) => {
    setSubmitting(true);
    const payload = {
      name_ar: data.name_ar,
      name: data.name || data.name_ar,
      address: data.address,
      lat: Number(data.lat),
      lng: Number(data.lng),
      phone: data.phone || null,
      is_main: data.is_main === true,
      is_active: data.is_active !== false && data.is_active !== "false",
    };
    const url = editing
      ? `/api/admin/stores?id=${editing.id}`
      : "/api/admin/stores";
    const res = await csrfFetch(url, {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      ...adminCred,
    }).then((r) => r.json());
    setSubmitting(false);
    if (res.success) {
      setView("list");
      load();
      showToast("تم حفظ الفرع", "success");
    } else showToast(res.error || "فشل الحفظ", "error");
  };

  const columns = [
    { 
      key: "name_ar", 
      label: "الفرع",
      render: (r: any) => (
        <div className="flex items-center gap-2">
          <div>
            <div className="font-medium text-secondary">
              {r.name || r.name_ar}
            </div>
            {r.name && r.name_ar && r.name !== r.name_ar ? (
              <div className="text-[11px] text-gray-500" dir="rtl">
                {r.name_ar}
              </div>
            ) : null}
          </div>
          {r.is_main && (
            <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded">
              رئيسي
            </span>
          )}
        </div>
      ),
    },
    { key: "address", label: "العنوان" },
    { 
      key: "location", 
      label: "الموقع",
      render: (r: any) => (
        <span className="text-xs font-mono text-gray-500">
          {r.lat?.toFixed(4)}, {r.lng?.toFixed(4)}
        </span>
      ),
    },
    { key: "is_active", label: "الحالة", render: (r: any) => (r.is_active ? "نشط" : "متوقف") },
  ];

  if (view !== "list") {
    return (
      <AdminForm
        title={editing ? "تعديل الفرع" : "فرع جديد"}
        subtitle="هكذا سيظهر اسم الفرع في قائمة الفروع وفي منطقة المتجر على الخريطة."
        fields={fields}
        initialValues={
          editing || {
            lat: 24.7136,
            lng: 46.6753,
            is_active: true,
            is_main: stores.length === 0,
          }
        }
        onSubmit={handleSubmit}
        onCancel={() => setView("list")}
        loading={submitting}
        previewTitle="معاينة بطاقة الفرع"
        renderPreview={(data) => (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary-light flex items-center justify-center text-primary">
                <MapPin className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <div className="font-bold text-secondary text-lg">
                  {String(data.name || "") || String(data.name_ar || "") || "اسم الفرع"}
                </div>
                {data.name && data.name_ar && data.name !== data.name_ar ? (
                  <div className="text-xs text-gray-500" dir="rtl">
                    {String(data.name_ar)}
                  </div>
                ) : null}
                <div className="text-xs text-gray-500 mt-1">
                  {String(data.address || "") || "العنوان"}
                </div>
              </div>
              {data.is_main === true ? (
                <span className="text-[10px] px-2 py-1 bg-primary/10 text-primary rounded-lg font-bold">
                  رئيسي
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <div className="text-gray-400">خط العرض</div>
                <div className="font-mono text-secondary">
                  {Number(data.lat || 0).toFixed(4)}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <div className="text-gray-400">خط الطول</div>
                <div className="font-mono text-secondary">
                  {Number(data.lng || 0).toFixed(4)}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <div className="text-gray-400">الحالة</div>
                <div className="text-secondary">
                  {data.is_active !== false ? "نشط" : "متوقف"}
                </div>
              </div>
            </div>
            {data.phone ? (
              <div className="text-xs text-gray-500 pt-2 border-t border-gray-100">
                📞 {String(data.phone)}
              </div>
            ) : null}
          </div>
        )}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="mb-4 p-4 bg-blue-50 rounded-xl text-sm text-blue-700">
        <p className="font-medium">💡 تلميح</p>
        <p>حدد موقع الفرع على خرائط جوجل وانسخ الإحداثيات من شريط العنوان (مثال: 24.7136,46.6753)</p>
      </div>
      <DataTable
        title="الفروع والمخازن"
        columns={columns}
        data={stores}
        loading={loading}
        onAdd={() => {
          setEditing(null);
          setView("new");
        }}
        onEdit={(item) => {
          setEditing(item);
          setView("edit");
        }}
        onDelete={handleDelete}
      />
      {confirm.dialog}
    </div>
  );
}
