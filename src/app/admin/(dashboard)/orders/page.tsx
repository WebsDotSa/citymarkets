"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Phone,
  MapPin,
  Eye,
  Calendar,
  Wallet,
  Package,
  AlertCircle,
  X,
  Filter,
} from "lucide-react";
import { formatOrderId, formatPrice } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import {
  ACTIVE_ORDER_STATUSES,
  ORDER_STATUSES,
  ORDER_STATUS_DISPLAY,
  PAYMENT_METHOD_AR,
  PAYMENT_STATUS_AR,
  PAYMENT_STATUSES_CONFIG,
  getOrderStatusConfig,
} from '@/lib/orders';
import type { AdminPagination } from "@/lib/admin-types";

const STATUS_OPTIONS = ORDER_STATUS_DISPLAY;

const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(ORDER_STATUSES).map(([k, v]) => [k, v.color]),
);

type PaginationInfo = AdminPagination;

function customerName(row: Record<string, unknown>): string {
  return String(row.user_name || row.guest_name || "—");
}

function customerPhone(row: Record<string, unknown>): string {
  return String(row.user_phone || row.guest_phone || "");
}

function addressSnippet(row: Record<string, unknown>): string {
  const text = String(row.address_text || "").trim();
  if (text) return text.length > 50 ? `${text.slice(0, 50)}…` : text;
  const parts = [row.guest_city, row.guest_district, row.guest_street].filter(Boolean);
  return parts.length ? String(parts.join("، ")) : "—";
}

function relativeTime(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value));
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

function paymentStatusBadge(paymentStatus: string): {
  label: string;
  classes: string;
  dot: string;
} {
  const config = PAYMENT_STATUSES_CONFIG[paymentStatus];
  if (config) {
    return {
      label: config.label,
      classes: config.color,
      dot: config.dotColor,
    };
  }
  return {
    label: PAYMENT_STATUS_AR[paymentStatus] || paymentStatus || "—",
    classes: "bg-gray-100 text-gray-700",
    dot: "bg-gray-400",
  };
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  // Default to "all payment statuses" so the admin sees every order on first
  // load — paid and unpaid alike. Use the filter dropdown to narrow down to
  // a specific payment state. Unpaid online attempts also live in
  // /admin/abandoned-carts for a more focused view of revenue-at-risk.
  const [paymentFilter, setPaymentFilter] = useState<string>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Phase D (2026-09-30): scheduled-delivery filters — `?scheduled_date`
  // narrows the list to a Riyadh calendar day, `?slot_window` narrows
  // to one delivery slot (validated server-side against the live
  // `delivery_settings.slots` config). Both default to empty so the
  // existing behaviour is preserved when the admin hasn't picked one.
  const [scheduledDate, setScheduledDate] = useState<string>("");
  const [slotWindow, setSlotWindow] = useState<string>("");
  // The slot-window dropdown options are loaded alongside the orders
  // list (best-effort) so they always match the live config. Failing
  // to load leaves the dropdown in "any slot" mode.
  const [slotOptions, setSlotOptions] = useState<Array<{ id: string; label: string }>>(
    [],
  );
  const { showToast } = useToast();

  const fetchOrders = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(pagination.page),
          limit: String(pagination.limit),
        });
        if (statusFilter) params.set("status", statusFilter);
        if (paymentFilter) params.set("payment_status", paymentFilter);
        if (search) params.set("search", search);
        if (scheduledDate) params.set("scheduled_date", scheduledDate);
        if (slotWindow) params.set("slot_window", slotWindow);

        const res = await fetch(`/api/admin/orders?${params.toString()}`, {
          credentials: "include",
          signal,
        });
        const json = await res.json();
        if (signal?.aborted) return;
        if (!res.ok || !json.success) {
          setError(json.error || "فشل تحميل الطلبات");
          return;
        }
        setOrders(Array.isArray(json.data) ? json.data : []);
        if (json.pagination) setPagination(json.pagination);
      } catch {
        if (!signal?.aborted) setError("تعذر الاتصال بالخادم");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [
      pagination.page,
      pagination.limit,
      statusFilter,
      paymentFilter,
      search,
      scheduledDate,
      slotWindow,
    ]
  );

  useEffect(() => {
    const ac = new AbortController();
    fetchOrders(ac.signal);
    return () => ac.abort();
  }, [fetchOrders]);

  // Fetch the live slot config so the dropdown mirrors the actual
  // delivery window ids. Best-effort — a failure leaves the dropdown
  // empty (admin can still type-freeze or remove the filter).
  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/v1/delivery/slots", { credentials: "include", signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (ac.signal.aborted) return;
        const slots = Array.isArray(j?.slots) ? j.slots : [];
        setSlotOptions(
          slots.map((s: { id: string; label: string; label_ar?: string }) => ({
            id: String(s.id),
            label: String(s.label_ar || s.label || s.id),
          })),
        );
      })
      .catch(() => {
        /* leave dropdown empty */
      });
    return () => ac.abort();
  }, []);

  const handleStatusChange = async (orderId: string | number, newStatus: string) => {
    const id = String(orderId);
    setUpdating(id);
    try {
      const res = await csrfFetch(`/api/admin/orders?id=${encodeURIComponent(id)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showToast(json.error || "فشل في تحديث حالة الطلب", "error");
        return;
      }
      setOrders((prev) =>
        prev.map((o) => (String(o.id) === id ? { ...o, status: newStatus } : o))
      );
      showToast("تم تحديث حالة الطلب", "success");
    } catch {
      showToast("فشل في تحديث حالة الطلب", "error");
    }
    setUpdating(null);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPagination((p) => ({ ...p, page: 1 }));
    setSearch(searchInput.trim());
  };

  const clearFilters = () => {
    setStatusFilter("");
    setPaymentFilter("");
    setSearchInput("");
    setSearch("");
    setScheduledDate("");
    setSlotWindow("");
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const goToPage = (newPage: number) => {
    if (newPage < 1 || newPage > pagination.totalPages) return;
    setPagination((p) => ({ ...p, page: newPage }));
  };

  const stats = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayOrders = orders.filter((o) => {
      const ts = new Date(String(o.created_at ?? ""));
      return ts.getTime() >= todayStart.getTime();
    });
    const activeOrders = orders.filter((o) =>
      ACTIVE_ORDER_STATUSES.includes(String(o.status))
    );
    const revenue = orders
      .filter((o) => String(o.payment_status) === "paid")
      .reduce((acc, o) => acc + Number(o.total ?? 0), 0);
    return {
      total: pagination.total,
      todayCount: todayOrders.length,
      activeCount: activeOrders.length,
      paidRevenue: revenue,
    };
  }, [orders, pagination.total]);

  const filtersActive = Boolean(
    statusFilter || paymentFilter || search || scheduledDate || slotWindow,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-primary">
          <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary px-2.5 py-1 rounded-full">
            <Package className="w-3.5 h-3.5" />
            لوحة الإدارة
          </span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-secondary">إدارة الطلبات</h1>
            <p className="text-sm text-gray-500 mt-1">
              جميع طلبات المتجر. استخدم الفلاتر أعلاه للبحث حسب الحالة أو طريقة الدفع. الطلبات الإلكترونية غير المدفوعة تظهر أيضاً في
              {" "}
              <Link
                href="/admin/abandoned-carts"
                className="text-primary hover:underline font-medium"
              >
                السلات المتروكة
              </Link>
              .
            </p>
          </div>
          <div className="text-sm text-gray-500 bg-white border border-gray-200 rounded-xl px-3 py-2">
            إجمالي <span className="font-bold text-secondary">{pagination.total}</span> طلب
            {pagination.totalPages > 1 && (
              <span className="text-gray-400">
                {" · "}صفحة {pagination.page} من {pagination.totalPages}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="إجمالي الطلبات"
          value={stats.total}
          icon={<Package className="w-5 h-5" />}
          tone="primary"
        />
        <StatCard
          label="طلبات اليوم"
          value={stats.todayCount}
          icon={<Calendar className="w-5 h-5" />}
          tone="blue"
        />
        <StatCard
          label="طلبات نشطة"
          value={stats.activeCount}
          icon={<AlertCircle className="w-5 h-5" />}
          tone="amber"
        />
        <StatCard
          label="إيرادات مدفوعة"
          value={formatPrice(stats.paidRevenue)}
          icon={<Wallet className="w-5 h-5" />}
          tone="emerald"
          isString
        />
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <form onSubmit={handleSearchSubmit} className="flex-1 relative">
            <Search className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="ابحث برقم الطلب، اسم العميل، الجوال..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full h-10 pe-9 ps-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary focus:bg-white transition-colors"
            />
          </form>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPagination((p) => ({ ...p, page: 1 }));
            }}
            className="h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-white"
            aria-label="فلتر حالة الطلب"
          >
            <option value="">كل حالات الطلب</option>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={paymentFilter}
            onChange={(e) => {
              setPaymentFilter(e.target.value);
              setPagination((p) => ({ ...p, page: 1 }));
            }}
            className="h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-white"
            aria-label="فلتر حالة الدفع"
          >
            <option value="">كل حالات الدفع</option>
            <option value="paid">مدفوع</option>
            <option value="unpaid">غير مدفوع</option>
            <option value="pending">قيد الدفع</option>
            <option value="failed">فشل</option>
            <option value="refunded">مسترد</option>
          </select>
          <input
            type="date"
            value={scheduledDate}
            onChange={(e) => {
              setScheduledDate(e.target.value);
              setPagination((p) => ({ ...p, page: 1 }));
            }}
            className="h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-white"
            aria-label="فلتر تاريخ التوصيل المجدول"
            title="تاريخ التوصيل المجدول"
          />
          <select
            value={slotWindow}
            onChange={(e) => {
              setSlotWindow(e.target.value);
              setPagination((p) => ({ ...p, page: 1 }));
            }}
            className="h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-white"
            aria-label="فلتر فترة التوصيل"
            title="فترة التوصيل"
          >
            <option value="">كل فترات التوصيل</option>
            {slotOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="h-10 px-4 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 inline-flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" />
              مسح الفلاتر
            </button>
          )}
        </div>
        {filtersActive && (
          <div className="flex items-center gap-2 text-xs text-gray-500 pt-2 border-t border-gray-100 flex-wrap">
            <Filter className="w-3.5 h-3.5" />
            <span>الفلاتر المفعّلة:</span>
            {statusFilter && (
              <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-full font-medium">
                {STATUS_OPTIONS.find((s) => s.value === statusFilter)?.label}
              </span>
            )}
            {paymentFilter && (
              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full font-medium">
                {PAYMENT_STATUS_AR[paymentFilter] || paymentFilter}
              </span>
            )}
            {search && (
              <span
                className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium"
                dir="ltr"
              >
                &quot;{search}&quot;
              </span>
            )}
            {scheduledDate && (
              <span className="px-2 py-0.5 bg-amber-50 text-amber-800 rounded-full font-medium" dir="ltr">
                📅 {scheduledDate}
              </span>
            )}
            {slotWindow && (
              <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full font-medium">
                ⏰ {slotOptions.find((s) => s.id === slotWindow)?.label || slotWindow}
              </span>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <p className="text-sm text-gray-500">جاري تحميل الطلبات...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Package className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-gray-700 font-medium">لا توجد طلبات</p>
            <p className="text-sm text-gray-500 mt-1">
              {filtersActive
                ? "لا توجد نتائج تطابق الفلاتر المحددة"
                : "لم يتم تسجيل أي طلبات بعد"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gradient-to-l from-gray-50 to-gray-100/80 text-gray-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-right font-semibold">رقم الطلب</th>
                  <th className="px-4 py-3 text-right font-semibold">التاريخ</th>
                  <th className="px-4 py-3 text-right font-semibold">العميل</th>
                  <th className="px-4 py-3 text-right font-semibold">العنوان</th>
                  <th className="px-4 py-3 text-right font-semibold">الإجمالي</th>
                  <th className="px-4 py-3 text-right font-semibold">الدفع</th>
                  <th className="px-4 py-3 text-right font-semibold">الحالة</th>
                  <th className="px-4 py-3 text-right font-semibold">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((row) => (
                  <OrderRow
                    key={String(row.id)}
                    row={row}
                    updating={updating === String(row.id)}
                    onStatusChange={(s) =>
                      handleStatusChange(row.id as string | number, s)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-3">
          <p className="text-sm text-gray-500">
            عرض{" "}
            <span className="font-medium text-secondary">
              {((pagination.page - 1) * pagination.limit) + 1}-
              {Math.min(pagination.page * pagination.limit, pagination.total)}
            </span>{" "}
            من <span className="font-medium text-secondary">{pagination.total}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToPage(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="h-9 px-3 text-sm border border-gray-200 rounded-xl disabled:opacity-40 hover:bg-gray-50 flex items-center gap-1 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
              السابق
            </button>
            <span className="text-sm text-gray-600 px-3 bg-gray-50 rounded-lg py-1.5">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              type="button"
              onClick={() => goToPage(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="h-9 px-3 text-sm border border-gray-200 rounded-xl disabled:opacity-40 hover:bg-gray-50 flex items-center gap-1 transition-colors"
            >
              التالي
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
  isString,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone: "primary" | "blue" | "amber" | "emerald";
  isString?: boolean;
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    blue: "bg-blue-50 text-blue-600",
    amber: "bg-amber-50 text-amber-600",
    emerald: "bg-emerald-50 text-emerald-600",
  };
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3 hover:shadow-sm transition-shadow">
      <div
        className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${tones[tone]}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 truncate">{label}</p>
        <p
          className={`font-bold text-secondary truncate ${
            isString ? "text-base" : "text-xl"
          }`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

function OrderRow({
  row,
  updating,
  onStatusChange,
}: {
  row: Record<string, unknown>;
  updating: boolean;
  onStatusChange: (status: string) => void;
}) {
  const id = row.id;
  const phone = customerPhone(row);
  const status = String(row.status ?? "");
  const paymentStatus = String(row.payment_status ?? "");
  const paymentMethod = String(row.payment_method ?? "");
  const statusConfig = getOrderStatusConfig(status);
  const StatusIcon = statusConfig.icon;
  const payment = paymentStatusBadge(paymentStatus);

  return (
    <tr className="hover:bg-gray-50/50 transition-colors group">
      <td className="px-4 py-3">
        <Link
          href={`/admin/orders/${id}`}
          className="font-mono font-bold text-secondary hover:text-primary transition-colors"
        >
          #{formatOrderId(id as string | number)}
        </Link>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-gray-700 text-xs">
            {row.created_at
              ? new Date(String(row.created_at)).toLocaleString("ar-SA", {
                  dateStyle: "short",
                  timeStyle: "short",
                })
              : "—"}
          </span>
          <span className="text-[10px] text-gray-400">
            {relativeTime(row.created_at)}
          </span>
          {row.scheduled && row.scheduled_for ? (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 w-fit"
              title={`مجدول — فترة ${String(row.slot_window || "")}`}
            >
              📅 مجدول · {new Date(String(row.scheduled_for)).toLocaleString(
                "ar-SA",
                { dateStyle: "short", timeStyle: "short" },
              )}
              {row.slot_window ? ` · ${String(row.slot_window)}` : ""}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="font-medium text-secondary">{customerName(row)}</span>
          {phone ? (
            <a
              href={`tel:${phone}`}
              dir="ltr"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-0.5"
            >
              <Phone className="w-3 h-3" />
              {phone}
            </a>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3 max-w-[200px]">
        <span
          className="text-xs text-gray-600 inline-flex items-center gap-1 max-w-full"
          title={addressSnippet(row)}
        >
          <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
          <span className="truncate">{addressSnippet(row)}</span>
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="font-bold text-primary">
          {formatPrice(Number(row.total ?? 0))}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-700">
            {PAYMENT_METHOD_AR[paymentMethod] || paymentMethod || "—"}
          </span>
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full w-fit ${payment.classes}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${payment.dot}`} />
            {payment.label}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="relative inline-block">
          <select
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
            disabled={updating}
            className={`appearance-none text-xs font-semibold ps-7 pe-3 py-1.5 rounded-full cursor-pointer border-0 focus:outline-none focus:ring-2 focus:ring-primary/30 ${STATUS_COLORS[status] || "bg-gray-100 text-gray-700"}`}
            aria-label="تغيير حالة الطلب"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <StatusIcon className="w-3.5 h-3.5 absolute end-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-70" />
        </div>
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/admin/orders/${id}`}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary hover:text-white rounded-lg transition-colors"
        >
          <Eye className="w-3.5 h-3.5" />
          عرض
        </Link>
      </td>
    </tr>
  );
}