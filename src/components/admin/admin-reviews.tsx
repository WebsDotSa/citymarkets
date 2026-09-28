"use client";

import { useEffect, useState } from "react";
import { DataTable } from "@/components/admin/data-table";
import type { Review } from "@/lib/types";
import { useToast } from "@/components/ui/toast";
import { safeFetchJson } from "@/lib/safe-fetch";
import { csrfFetch } from "@/lib/csrf-client";

const adminCred: RequestInit = { credentials: "include" };

export function AdminReviews() {
  const [rows, setRows] = useState<Review[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    const res = await safeFetchJson<{
      success: boolean;
      error?: string;
      data: Review[];
      summary: Record<string, unknown>;
    }>("/api/admin/reviews", { ...adminCred, signal });
    if (signal?.aborted) return;
    if (res?.success) {
      setRows(res.data);
      setSummary(res.summary);
    } else {
      showToast(res?.error || "فشل تحميل التقييمات", "error");
    }
    setLoading(false);
  };

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, []);

  const updateReview = async (id: number, patch: Record<string, unknown>) => {
    const res = await csrfFetch(`/api/admin/reviews?id=${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      ...adminCred,
    }).then((r) => r.json());
    if (res.success) load();
    else showToast(res.error || "فشل التحديث", "error");
  };

  const columns = [
    {
      key: "product_name",
      label: "المنتج",
      render: (r: any) =>
        r.product_name ? (
          <span title={r.product_id}>{r.product_name}</span>
        ) : (
          <span className="text-gray-400 text-xs" title={r.product_id}>
            منتج محذوف (#{String(r.product_id).slice(0, 8)})
          </span>
        ),
    },
    { key: "user_name", label: "العميل" },
    { key: "rating", label: "التقييم" },
    {
      key: "comment",
      label: "التعليق",
      render: (r: any) => (
        <span className="line-clamp-2 max-w-md" title={r.comment}>
          {r.comment}
        </span>
      ),
    },
    {
      key: "created_at",
      label: "التاريخ",
      render: (r: any) =>
        r.created_at
          ? new Date(r.created_at).toLocaleDateString("ar-SA")
          : "—",
    },
    {
      key: "is_approved",
      label: "معتمد",
      render: (r: any) => (
        <button
          type="button"
          className="text-sm text-primary-600"
          onClick={() => updateReview(r.id, { is_approved: !r.is_approved })}
        >
          {r.is_approved ? "إخفاء" : "إظهار"}
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {summary && (
          <p className="text-sm text-gray-600">
            متوسط التقييم: {Number(summary.avg_rating ?? 0).toFixed(1)} — ({Number(summary.total ?? 0)}{" "}
            تقييم)
          </p>
        )}
        <DataTable title="تقييمات المنتجات" columns={columns} data={rows} loading={loading} />
    </div>
  );
}
