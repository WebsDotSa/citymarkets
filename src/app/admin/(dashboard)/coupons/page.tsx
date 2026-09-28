"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { DataTable } from "@/components/admin/data-table";
import { AdminForm } from "@/components/admin/admin-form";
import { useToast, useConfirm } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import { apiFetch } from "@/lib/api";
import type { Coupon } from "@/lib/types";

const adminCred: RequestInit = { credentials: "include" };

type View = "list" | "new" | "edit";

function AdminCouponsContent() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>("list");
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [editingItem, setEditingItem] = useState<Coupon | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    const ac = new AbortController();
    loadData(ac.signal);
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setEditingItem(null);
      setView("new");
    }
  }, [searchParams]);

  const loadData = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await apiFetch<Coupon[]>("/api/admin/coupons", { signal });
      if (signal?.aborted) return;
      if (res.success) setCoupons(res.data);
    } catch (error) {
      if (!signal?.aborted) {
        console.error(error);
        showToast("فشل تحميل الكوبونات", "error");
      }
    }
    if (!signal?.aborted) setLoading(false);
  };

  const handleDelete = async (item: Coupon) => {
    if (!(await confirm({ title: "حذف كوبون", message: `هل أنت متأكد من حذف الكوبون "${item.code}"؟`, danger: true }))) return;
    try {
      const res = await csrfFetch(`/api/admin/coupons?id=${item.id}`, { method: "DELETE", ...adminCred }).then((r) => r.json());
      if (res?.success) {
        showToast("تم حذف الكوبون", "success");
        loadData();
      } else {
        showToast(res?.error || "فشل حذف الكوبون", "error");
      }
    } catch (error) { showToast("فشل في حذف الكوبون", "error"); }
  };

  const handleSubmit = async (data: Record<string, any>) => {
    setSubmitting(true);
    try {
      const method = editingItem ? "PUT" : "POST";
      const url = editingItem ? `/api/admin/coupons?id=${editingItem.id}` : "/api/admin/coupons";
      const res = await csrfFetch(url, {
        method,
        ...adminCred,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (result.success) { loadData(); setView("list"); showToast("تم حفظ الكوبون", "success"); }
      else showToast("فشل في حفظ الكوبون", "error");
    } catch (error) { showToast("حدث خطأ", "error"); }
    setSubmitting(false);
  };

  const typeLabels: Record<string, string> = {
    percentage: "نسبة مئوية",
    fixed: "مبلغ ثابت",
    free_delivery: "توصيل مجاني",
  };

  const sourceLabels: Record<string, string> = {
    spin: "عجلة الحظ",
    admin: "إدارة",
    event: "حدث",
    referral: "إحالة",
  };

  const columns = [
    { key: "code", label: "الكود" },
    {
      key: "type",
      label: "النوع",
      render: (row: Coupon) => typeLabels[row.type] || row.type,
    },
    {
      key: "value",
      label: "القيمة",
      render: (row: Coupon) =>
        row.type === "percentage" ? `${row.value}%` : row.type === "free_delivery" ? "مجاني" : `${row.value} ر`,
    },
    { key: "min_order", label: "الحد الأدنى", render: (row: Coupon) => row.min_order ? `${row.min_order} ر` : "—" },
    {
      key: "used_count",
      label: "الاستخدام",
      render: (row: Coupon) =>
        row.max_uses != null ? `${row.used_count ?? 0} / ${row.max_uses}` : `${row.used_count ?? 0} / ∞`,
    },
    {
      key: "source",
      label: "المصدر",
      render: (row: Coupon) => sourceLabels[row.source] || row.source,
    },
    {
      key: "is_active",
      label: "الحالة",
      render: (row: Coupon) =>
        row.is_active ? (
          <span className="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-700">نشط</span>
        ) : (
          <span className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-700">غير نشط</span>
        ),
    },
    {
      key: "expires_at",
      label: "تاريخ الانتهاء",
      render: (row: Coupon) => row.expires_at ? new Date(row.expires_at).toLocaleDateString("ar-SA") : "—",
    },
  ];

  const fields = [
    { key: "code", label: "كود الخصم", type: "text" as const, required: true, help: "مثال: WELCOME10" },
    {
      key: "type",
      label: "نوع الخصم",
      type: "select" as const,
      required: true,
      options: [
        { label: "نسبة مئوية", value: "percentage" },
        { label: "مبلغ ثابت", value: "fixed" },
        { label: "توصيل مجاني", value: "free_delivery" },
      ],
    },
    { key: "value", label: "القيمة", type: "number" as const, required: true },
    { key: "min_order", label: "الحد الأدنى للطلب", type: "number" as const },
    { key: "max_discount", label: "الحد الأقصى للخصم", type: "number" as const },
    { key: "max_uses", label: "عدد مرات الاستخدام", type: "number" as const, help: "اتركه فارغاً لعدد غير محدود" },
    {
      key: "source",
      label: "المصدر",
      type: "select" as const,
      options: [
        { label: "إدارة", value: "admin" },
        { label: "عجلة الحظ", value: "spin" },
        { label: "حدث", value: "event" },
        { label: "إحالة", value: "referral" },
      ],
    },
    { key: "expires_at", label: "تاريخ الانتهاء", type: "text" as const, help: "YYYY-MM-DD أو اتركه فارغاً" },
    { key: "is_active", label: "نشط", type: "checkbox" as const, placeholder: "الكوبون متاح للاستخدام" },
  ];

  if (view === "new" || view === "edit") {
    return (
      <AdminForm
          fields={fields}
          title={view === "new" ? "إضافة كوبون جديد" : "تعديل الكوبون"}
          initialValues={editingItem || { is_active: true, type: "percentage", source: "admin" }}
          onSubmit={handleSubmit}
          onCancel={() => setView("list")}
          loading={submitting}
        />
    );
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={coupons}
        title="إدارة كوبونات الخصم"
        onAdd={() => { setEditingItem(null); setView("new"); }}
        onEdit={(item) => { setEditingItem(item); setView("edit"); }}
        onDelete={handleDelete}
        loading={loading}
      />
      {confirm.dialog}
    </>
  );
}

export default function AdminCouponsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
      }
    >
      <AdminCouponsContent />
    </Suspense>
  );
}
