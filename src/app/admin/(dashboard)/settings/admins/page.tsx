"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Bike, ExternalLink } from "lucide-react";
import { DataTable } from "@/components/admin/data-table";
import { AdminForm } from "@/components/admin/admin-form";
import { ROLE_LABELS, type AdminUser } from "@/lib/admin-types";
import { useToast, useConfirm } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import { apiFetch } from "@/lib/api";

type View = "list" | "new" | "edit";

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-red-100 text-red-700",
  admin: "bg-blue-100 text-blue-700",
  editor: "bg-amber-100 text-amber-700",
  viewer: "bg-gray-100 text-gray-700",
  delivery_driver: "bg-teal-100 text-teal-700",
};

const adminCred = { credentials: "include" as const };

export default function AdminManagementPage() {
  const [view, setView] = useState<View>("list");
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [editingItem, setEditingItem] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    const ac = new AbortController();
    loadData(ac.signal);
    return () => ac.abort();
  }, []);

  const loadData = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await apiFetch<AdminUser[]>("/api/admin/admin-users", { signal });
      if (signal?.aborted) return;
      if (res.success) setAdminUsers(res.data);
    } catch (error) { if (!signal?.aborted) console.error(error); }
    if (!signal?.aborted) setLoading(false);
  };

  const handleDelete = async (item: any) => {
    if (!(await confirm({ title: "حذف موظف", message: `هل أنت متأكد من حذف "${item.name}"؟`, danger: true }))) return;
    try {
      const res = await csrfFetch(`/api/admin/admin-users?id=${item.id}`, { method: "DELETE", ...adminCred }).then((r) => r.json());
      if (res?.success) {
        showToast("تم حذف الموظف", "success");
        loadData();
      } else {
        showToast(res?.error || "فشل حذف الموظف", "error");
      }
    } catch (error) { showToast("فشل في حذف المستخدم", "error"); }
  };

  const handleSubmit = async (data: Record<string, any>) => {
    setSubmitting(true);
    try {
      const method = editingItem ? "PUT" : "POST";
      const url = editingItem ? `/api/admin/admin-users?id=${editingItem.id}` : "/api/admin/admin-users";
      const res = await csrfFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        ...adminCred,
      });
      const result = await res.json();
      if (result.success) { loadData(); setView("list"); showToast("تم حفظ الموظف", "success"); }
      else showToast(result.error || "فشل في حفظ المستخدم", "error");
    } catch (error) { showToast("حدث خطأ", "error"); }
    setSubmitting(false);
  };

  const columns = [
    { key: "name", label: "الاسم" },
    { key: "phone", label: "رقم الجوال" },
    { key: "email", label: "البريد الإلكتروني" },
    {
      key: "role",
      label: "الدور",
      render: (row: any) => (
        <span className={`text-xs font-medium px-2.5 py-1 rounded-lg ${ROLE_COLORS[row.role] || "bg-gray-100"}`}>
          {(ROLE_LABELS as Record<string, string>)[row.role] || row.role}
        </span>
      ),
    },
    {
      key: "is_active",
      label: "الحالة",
      render: (row: any) =>
        row.is_active ? (
          <span className="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-700">نشط</span>
        ) : (
          <span className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-700">معطّل</span>
        ),
    },
    {
      key: "last_login_at",
      label: "آخر دخول",
      render: (row: any) =>
        row.last_login_at ? new Date(row.last_login_at).toLocaleString("ar-SA") : "لم يسجل الدخول",
    },
  ];

  const fields = [
    { key: "name", label: "الاسم الكامل", type: "text" as const, required: true },
    // Phone is REQUIRED — admins sign in via phone+OTP (also enables
    // SMS notifications for orders / account changes). Email is now
    // optional so admins can be created with just a phone number.
    { key: "phone", label: "رقم الجوال", type: "tel" as const, required: true, placeholder: "5XXXXXXXX" },
    { key: "email", label: "البريد الإلكتروني (اختياري)", type: "text" as const, placeholder: "admin@citymarkets.sa" },
    { key: "password", label: view === "new" ? "كلمة المرور" : "كلمة المرور الجديدة (اتركه فارغاً للإبقاء على الحالية)", type: "text" as const, required: view === "new" },
    {
      key: "role",
      label: "الدور",
      type: "select" as const,
      required: true,
      options: [
        { label: ROLE_LABELS.super_admin, value: "super_admin" },
        { label: ROLE_LABELS.admin, value: "admin" },
        { label: ROLE_LABELS.editor, value: "editor" },
        { label: ROLE_LABELS.viewer, value: "viewer" },
        { label: "🚴 " + ROLE_LABELS.delivery_driver + " (مندوب)", value: "delivery_driver" },
      ],
    },
    { key: "is_active", label: "نشط", type: "checkbox" as const, placeholder: "السماح بتسجيل الدخول" },
  ];

  if (view === "new" || view === "edit") {
    return (
      <AdminForm
          fields={fields}
          title={view === "new" ? "إضافة موظف جديد" : "تعديل بيانات الموظف"}
          initialValues={editingItem || { role: "admin", is_active: true }}
          onSubmit={handleSubmit}
          onCancel={() => setView("list")}
          loading={submitting}
        />
    );
  }

  return (
    <>
      <div className="mb-4 p-4 rounded-2xl border border-primary/20 bg-primary/5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Bike className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-bold text-slate-800 text-sm">طلبات المناديب الجدد</p>
            <p className="text-xs text-slate-500">
              راجع طلبات التوظيف للمندوبين، وعند القبول أضفهم هنا بدور "مندوب".
            </p>
          </div>
        </div>
        <Link
          href="/admin/employment"
          className="inline-flex items-center gap-1.5 bg-white border border-primary/30 text-primary font-semibold text-sm px-4 py-2 rounded-xl hover:bg-primary hover:text-white transition-colors"
        >
          فتح طلبات التوظيف
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>
      <DataTable
        columns={columns}
        data={adminUsers}
        title="إدارة الموظفين"
        onAdd={() => { setEditingItem(null); setView("new"); }}
        onEdit={(item) => { setEditingItem(item); setView("edit"); }}
        onDelete={handleDelete}
        loading={loading}
      />
      {confirm.dialog}
    </>
  );
}
