"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  Phone,
  Eye,
  ShoppingCart,
  Package,
  TrendingUp,
  Wallet,
  RefreshCcw,
  Filter,
} from "lucide-react";
import { formatPrice, formatOrderId } from "@/lib/format";
import type {
  AdminAbandonedCart,
  AdminPagination,
} from "@/lib/admin-types";

type AbandonedCartRow = AdminAbandonedCart;
type PaginationInfo = AdminPagination;

const STATUS_FILTERS = [
  { value: "", label: "الكل" },
  { value: "abandoned", label: "متروكة" },
  { value: "recovered", label: "مستردة" },
] as const;

function relativeTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `قبل ${days} يوم`;
  return date.toLocaleDateString("ar-SA", { dateStyle: "short" });
}

function customerName(row: AbandonedCartRow): string {
  return row.user_name || row.guest_name || "زائر";
}

function customerPhone(row: AbandonedCartRow): string {
  return row.user_phone || row.guest_phone || "";
}

export default function AdminAbandonedCartsPage() {
  const [rows, setRows] = useState<AbandonedCartRow[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const fetchRows = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (statusFilter) params.set("status", statusFilter);
        if (search) params.set("search", search);
        params.set("page", String(pagination.page));
        params.set("limit", String(pagination.limit));
        const res = await fetch(
          `/api/admin/abandoned-carts?${params.toString()}`,
          { signal, credentials: "include" },
        );
        if (!res.ok) {
          throw new Error("fetch_failed");
        }
        const json = (await res.json()) as {
          success: boolean;
          data?: AbandonedCartRow[];
          pagination?: PaginationInfo;
          error?: string;
        };
        if (!json.success) {
          throw new Error(json.error ?? "fetch_failed");
        }
        setRows(Array.isArray(json.data) ? json.data : []);
        if (json.pagination) setPagination(json.pagination);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setError((err as Error)?.message || "حدث خطأ");
      } finally {
        setLoading(false);
      }
    },
    [pagination.page, pagination.limit, statusFilter, search],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchRows(controller.signal);
    return () => controller.abort();
  }, [fetchRows]);

  // Stats: count abandoned vs recovered in the current page.
  const stats = useMemo(() => {
    let abandoned = 0;
    let recovered = 0;
    let valueAbandoned = 0;
    let itemsTotal = 0;
    for (const r of rows) {
      if (r.status === "abandoned") {
        abandoned += 1;
        valueAbandoned += Number(r.subtotal) || 0;
      } else if (r.status === "recovered") {
        recovered += 1;
      }
      itemsTotal += Number(r.items_count) || 0;
    }
    return { abandoned, recovered, valueAbandoned, itemsTotal };
  }, [rows]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPagination((p) => ({ ...p, page: 1 }));
    setSearch(searchInput.trim());
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="p-3 rounded-2xl bg-amber-100 text-amber-700 shadow-sm">
          <ShoppingCart className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">السلات المتروكة</h1>
          <p className="text-sm text-gray-500 mt-1">
            عملاء وصلوا لمرحلة الدفع ثم لم يكملوا — يمكن مراسلتهم لاستعادة السلات.
          </p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">متروكة الآن</span>
            <Wallet className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-gray-800 mt-2">{stats.abandoned}</p>
          <p className="text-xs text-gray-400 mt-1">{formatPrice(stats.valueAbandoned)} قيمة متروكة</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">مستردة</span>
            <RefreshCcw className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-gray-800 mt-2">{stats.recovered}</p>
          <p className="text-xs text-gray-400 mt-1">تم استكمالها لاحقاً</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">الأصناف</span>
            <Package className="w-4 h-4 text-sky-500" />
          </div>
          <p className="text-2xl font-bold text-gray-800 mt-2">{stats.itemsTotal}</p>
          <p className="text-xs text-gray-400 mt-1">إجمالي أصناف الصفحة</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">إجمالي</span>
            <TrendingUp className="w-4 h-4 text-gray-400" />
          </div>
          <p className="text-2xl font-bold text-gray-800 mt-2">{pagination.total}</p>
          <p className="text-xs text-gray-400 mt-1">سلة على الصفحة الحالية</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
              {STATUS_FILTERS.map((opt) => (
                <button
                  key={opt.value || "all"}
                  onClick={() => {
                    setStatusFilter(opt.value);
                    setPagination((p) => ({ ...p, page: 1 }));
                  }}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    statusFilter === opt.value
                      ? "bg-white text-primary shadow-sm"
                      : "text-gray-600 hover:text-gray-800"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSearchSubmit} className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="ابحث بالاسم، الجوال، أو رقم الطلب"
                className="w-full h-10 pr-10 pl-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary focus:bg-white transition-all"
              />
            </div>
            <button
              type="submit"
              className="px-4 h-10 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors"
            >
              بحث
            </button>
          </form>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm">جاري التحميل…</div>
        ) : error ? (
          <div className="p-10 text-center text-red-600 text-sm">{error}</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <ShoppingCart className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">لا توجد سلات متروكة تطابق الفلتر</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-right font-semibold">العميل</th>
                  <th className="px-4 py-3 text-right font-semibold">رقم الطلب المقصود</th>
                  <th className="px-4 py-3 text-right font-semibold">الأصناف</th>
                  <th className="px-4 py-3 text-right font-semibold">المجموع</th>
                  <th className="px-4 py-3 text-right font-semibold">آخر نشاط</th>
                  <th className="px-4 py-3 text-right font-semibold">الحالة</th>
                  <th className="px-4 py-3 text-right font-semibold">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => {
                  const name = customerName(row);
                  const phone = customerPhone(row);
                  return (
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-semibold text-gray-700">{name}</span>
                          {phone ? (
                            <a
                              href={`tel:${phone}`}
                              className="text-xs text-gray-500 inline-flex items-center gap-1 mt-0.5 hover:text-primary"
                            >
                              <Phone className="w-3 h-3" />
                              {phone}
                            </a>
                          ) : (
                            <span className="text-xs text-gray-400 mt-0.5">بدون جوال</span>
                          )}
                          {row.user_id ? (
                            <span className="text-tiny text-emerald-600 mt-0.5">مسجّل</span>
                          ) : (
                            <span className="text-tiny text-gray-400 mt-0.5">زائر</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {row.intent_order_id ? (
                          <Link
                            href={`/admin/orders/${row.intent_order_id}`}
                            className="text-primary hover:underline font-mono text-xs"
                          >
                            #{formatOrderId(row.intent_order_id)}
                          </Link>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-gray-700">
                          <Package className="w-3 h-3 text-gray-400" />
                          {row.items_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-700">
                        {formatPrice(row.subtotal)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {relativeTime(row.last_seen_at)}
                      </td>
                      <td className="px-4 py-3">
                        {row.status === "recovered" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold">
                            <RefreshCcw className="w-3 h-3" /> مستردة
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">
                            <ShoppingCart className="w-3 h-3" /> متروكة
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row.intent_order_id ? (
                          <Link
                            href={`/admin/orders/${row.intent_order_id}`}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-primary hover:bg-primary/10 text-xs font-semibold"
                          >
                            <Eye className="w-3 h-3" /> عرض الطلب
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && !error && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm">
            <span className="text-gray-500">
              صفحة {pagination.page} من {pagination.totalPages} ({pagination.total} سلة)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  setPagination((p) => ({
                    ...p,
                    page: Math.max(1, p.page - 1),
                  }))
                }
                disabled={pagination.page <= 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50"
              >
                السابق
              </button>
              <button
                onClick={() =>
                  setPagination((p) => ({
                    ...p,
                    page: Math.min(p.totalPages, p.page + 1),
                  }))
                }
                disabled={pagination.page >= pagination.totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50"
              >
                التالي
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
