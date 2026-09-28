"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DataTable } from "@/components/admin/data-table";
import { useToast } from "@/components/ui/toast";
import { safeFetchJson } from "@/lib/safe-fetch";
import { csrfFetch } from "@/lib/csrf-client";

const adminCred: RequestInit = { credentials: "include" };

type InventoryRow = {
  id: string;
  name_ar: string;
  // API returns stock_qty (alias of products_unified.stock_qty). Declared
  // nullable because the "نفد المخزون" branch matches COALESCE(..., 0) = 0,
  // which can surface NULL rows when track_stock is off.
  stock_qty: number | null;
  category_name?: string;
  price?: number | string;
  image_url?: string | null;
  is_active?: boolean;
};

export function AdminInventory() {
  const [threshold, setThreshold] = useState(5);
  const [lowStock, setLowStock] = useState<InventoryRow[]>([]);
  const [outOfStock, setOutOfStock] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    const res = await safeFetchJson<{
      success: boolean;
      threshold: number;
      lowStock: InventoryRow[];
      outOfStock: InventoryRow[];
    }>("/api/admin/inventory", { ...adminCred, signal });
    if (signal?.aborted) return;
    if (res?.success) {
      setThreshold(res.threshold);
      setLowStock(res.lowStock);
      setOutOfStock(res.outOfStock);
    }
    setLoading(false);
  };

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, []);

  const saveThreshold = async () => {
    setSaving(true);
    const res = await csrfFetch("/api/admin/inventory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ low_stock_threshold: threshold }),
      ...adminCred,
    }).then((r) => r.json());
    setSaving(false);
    if (res.success) { load(); showToast("تم حفظ الحد الأدنى", "success"); }
    else showToast(res.error || "فشل الحفظ", "error");
  };

  const cols = [
    { key: "name_ar", label: "المنتج" },
    { key: "stock_qty", label: "المخزون" },
    { key: "category_name", label: "الفئة" },
    {
      key: "id",
      label: "",
      render: (r: any) => (
        <Link
          href={`/admin/products/${r.id}/edit`}
          className="text-primary-600 text-sm"
        >
          إدارة
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-white p-4 flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="text-sm text-gray-600">عتبة المخزون المنخفض</span>
            <input
              type="number"
              min={1}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="mt-1 block w-24 border rounded-lg px-3 py-2"
            />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={saveThreshold}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white disabled:opacity-50"
          >
            {saving ? "جاري الحفظ…" : "حفظ العتبة"}
          </button>
        </div>
        <DataTable title="نفاد المخزون" columns={cols} data={outOfStock} loading={loading} />
        <DataTable title={`مخزون منخفض (≤ ${threshold})`} columns={cols} data={lowStock} loading={loading} />
    </div>
  );
}
