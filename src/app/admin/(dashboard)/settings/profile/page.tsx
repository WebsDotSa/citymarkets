"use client";

import { useState } from "react";
import { AdminForm } from "@/components/admin/admin-form";
import { csrfFetch } from "@/lib/csrf-client";
export default function AdminProfilePage() {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const user = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("admin_user") || "{}") : null;

  const handleSubmit = async (data: Record<string, any>) => {
    setSubmitting(true);
    setMessage("");
    setError("");

    if (data.new_password !== data.confirm_password) {
      setError("كلمة المرور الجديدة غير متطابقة");
      setSubmitting(false);
      return;
    }

    try {
      const res = await csrfFetch(`/api/admin/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: data.current_password,
          new_password: data.new_password,
        }),
        credentials: "include",
      });

      const result = await res.json();
      if (result.success) {
        setMessage("تم تغيير كلمة المرور بنجاح");
      } else {
        setError(result.error || "فشل تغيير كلمة المرور");
      }
    } catch (err) {
      setError("حدث خطأ");
    }
    setSubmitting(false);
  };

  const fields = [
    { key: "current_password", label: "كلمة المرور الحالية", type: "text" as const, required: true },
    { key: "new_password", label: "كلمة المرور الجديدة", type: "text" as const, required: true },
    { key: "confirm_password", label: "تأكيد كلمة المرور", type: "text" as const, required: true },
  ];

  return (
    <div className="max-w-xl mx-auto space-y-6">
        {/* Profile Card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary-dark rounded-full flex items-center justify-center text-white text-xl font-bold shadow-lg">
              {user?.name?.charAt(0) || "أ"}
            </div>
            <div>
              <h2 className="text-xl font-bold text-secondary">{user?.name}</h2>
              <p className="text-sm text-gray-500">{user?.email}</p>
              <p className="text-xs text-primary mt-0.5">{user?.role}</p>
            </div>
          </div>

          {message && (
            <div className="mb-4 p-3 bg-green-50 text-green-600 text-sm rounded-xl border border-green-100">
              {message}
            </div>
          )}
          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100">
              {error}
            </div>
          )}

          <AdminForm
            fields={fields}
            title="تغيير كلمة المرور"
            initialValues={{}}
            onSubmit={handleSubmit}
            onCancel={() => {}}
            loading={submitting}
          />
        </div>
      </div>
  );
}
