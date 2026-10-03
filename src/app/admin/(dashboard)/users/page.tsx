"use client";

import { useState, useEffect } from "react";
import { DataTable } from "@/components/admin/data-table";
import { AdminForm } from "@/components/admin/admin-form";
import { useToast, useConfirm } from "@/components/ui/toast";
import { Users, Award, TrendingUp, UserCheck } from "lucide-react";
import type { User } from "@/lib/types";
import { csrfFetch } from "@/lib/csrf-client";
import { apiFetch } from '@/lib/catalog';
import { formatDate } from "@/lib/format";

type View = "list" | "new" | "edit";

const TIER_LABELS: Record<string, string> = {
  bronze: "عادي",
  silver: "فضي",
  gold: "ذهبي",
  platinum: "بلاتيني",
};

const adminCred = { credentials: "include" as const };

export default function AdminUsersPage() {
  const [view, setView] = useState<View>("list");
  const [users, setUsers] = useState<User[]>([]);
  const [editingItem, setEditingItem] = useState<User | null>(null);
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
      const res = await apiFetch<User[]>("/api/admin/users", { signal });
      if (signal?.aborted) return;
      if (res.success) setUsers(res.data);
    } catch (error) { if (!signal?.aborted) console.error(error); }
    if (!signal?.aborted) setLoading(false);
  };

  const handleDelete = async (item: any) => {
    if (!(await confirm({ title: "حذف مستخدم", message: "هل أنت متأكد من حذف هذا المستخدم؟", danger: true }))) return;
    try {
      const res = await csrfFetch(`/api/admin/users?id=${item.id}`, { method: "DELETE", ...adminCred }).then((r) => r.json());
      if (res?.success) {
        showToast("تم حذف المستخدم", "success");
        loadData();
      } else {
        showToast(res?.error || "فشل حذف المستخدم", "error");
      }
    } catch (error) { showToast("فشل في حذف المستخدم", "error"); }
  };

  const handleSubmit = async (data: Record<string, any>) => {
    setSubmitting(true);
    try {
      const method = editingItem ? "PUT" : "POST";
      const url = editingItem ? `/api/admin/users?id=${editingItem.id}` : "/api/admin/users";
      const res = await csrfFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        ...adminCred,
      });
      const result = await res.json();
      if (result.success) { loadData(); setView("list"); showToast("تم حفظ المستخدم", "success"); }
      else showToast(result.error || "فشل في حفظ المستخدم", "error");
    } catch (error) { showToast("حدث خطأ في الاتصال", "error"); }
    setSubmitting(false);
  };

  const columns = [
    { key: "name", label: "الاسم" },
    { key: "phone", label: "الجوال" },
    { key: "email", label: "البريد الإلكتروني" },
    { key: "loyalty_points", label: "نقاط الولاء" },
    {
      key: "loyalty_tier",
      label: "المستوى",
      render: (row: any) => {
        const colors: Record<string, string> = {
          bronze: "bg-amber-100 text-amber-700",
          silver: "bg-gray-100 text-gray-700",
          gold: "bg-yellow-100 text-yellow-700",
          platinum: "bg-purple-100 text-purple-700",
        };
        return (
          <span className={`text-xs px-2 py-1 rounded-lg ${colors[row.loyalty_tier] || "bg-gray-100"}`}>
            {TIER_LABELS[row.loyalty_tier] || row.loyalty_tier}
          </span>
        );
      },
    },
    {
      key: "created_at",
      label: "تاريخ التسجيل",
      render: (row: any) => formatDate(row.created_at),
    },
  ];

  const fields = [
    { key: "phone", label: "رقم الجوال", type: "text" as const, required: true },
    { key: "name", label: "الاسم", type: "text" as const },
    { key: "email", label: "البريد الإلكتروني", type: "text" as const },
    { key: "loyalty_points", label: "نقاط الولاء", type: "number" as const },
    {
      key: "loyalty_tier",
      label: "مستوى الولاء",
      type: "select" as const,
      options: [
        { label: "عادي", value: "bronze" },
        { label: "فضي", value: "silver" },
        { label: "ذهبي", value: "gold" },
        { label: "بلاتيني", value: "platinum" },
      ],
    },
  ];

  if (view === "new" || view === "edit") {
    return (
      <AdminForm
          fields={fields}
          title={view === "new" ? "إضافة مستخدم جديد" : "تعديل المستخدم"}
          initialValues={editingItem || { loyalty_tier: "bronze", loyalty_points: 0 }}
          onSubmit={handleSubmit}
          onCancel={() => setView("list")}
          loading={submitting}
        />
    );
  }

  const stats = [
    {
      label: "إجمالي المستخدمين",
      value: users.length,
      icon: Users,
      color: "text-blue-600 bg-blue-100",
    },
    {
      label: "الأعضاء العاديين",
      value: users.filter((u) => u.loyalty_tier === "bronze" || !u.loyalty_tier).length,
      icon: UserCheck,
      color: "text-gray-600 bg-gray-100",
    },
    {
      label: "أعضاء النخبة (فضي فأعلى)",
      value: users.filter((u) => ["silver", "gold", "platinum"].includes(u.loyalty_tier || "")).length,
      icon: Award,
      color: "text-amber-600 bg-amber-100",
    },
    {
      label: "متوسط نقاط الولاء",
      value: users.length ? Math.round(users.reduce((acc, u) => acc + (u.loyalty_points || 0), 0) / users.length) : 0,
      icon: TrendingUp,
      color: "text-emerald-600 bg-emerald-100",
    }
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={i} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 mb-1">{stat.label}</p>
                <p className="text-2xl font-bold">{stat.value}</p>
              </div>
              <div className={`p-3 rounded-lg ${stat.color}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
          );
        })}
      </div>

      <DataTable
        columns={columns}
        data={users}
        title="إدارة المستخدمين"
        onAdd={() => { setEditingItem(null); setView("new"); }}
        onEdit={(item) => { setEditingItem(item); setView("edit"); }}
        onDelete={handleDelete}
        loading={loading}
      />
      {confirm.dialog}
    </div>
  );
}
