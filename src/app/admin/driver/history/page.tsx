"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Truck,
  Package,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  MapPin,
  Phone,
  Calendar,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { DriverLayout } from "@/components/admin/driver-layout";
import { getOrderStatusConfig, PAYMENT_METHOD_AR, getPaymentStatusConfig } from '@/lib/orders';
import { formatPrice } from "@/lib/format";

interface HistoryOrder {
  id: string;
  order_number: string | null;
  status: string;
  total: number;
  delivery_fee: number;
  payment_method: string;
  payment_status: string;
  created_at: string;
  delivered_at: string | null;
  cancelled_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  address_label: string | null;
  address_text: string | null;
}

interface Pagination {
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
}

const STATUS_FILTERS: Array<{ value: string; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: "", label: "الكل", icon: Package },
  { value: "delivered", label: "تم التوصيل", icon: CheckCircle },
  { value: "cancelled", label: "ملغي", icon: XCircle },
  { value: "on_the_way", label: "جاري التوصيل", icon: Truck },
];

const PAGE_SIZE = 20;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ar-SA", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function DriverHistoryPage() {
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    limit: PAGE_SIZE,
    offset: 0,
    total: 0,
    has_more: false,
  });
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(pagination.offset),
        });
        if (statusFilter) params.set("status", statusFilter);
        const res = await fetch(
          `/api/admin/driver/orders/history?${params.toString()}`,
          { credentials: "include", signal },
        );
        const json = await res.json();
        if (signal?.aborted) return;
        if (!res.ok || !json.success) {
          setError(json.error || "تعذر جلب السجل");
          setOrders([]);
          return;
        }
        setOrders(Array.isArray(json.orders) ? json.orders : []);
        setPagination(
          json.pagination ?? {
            limit: PAGE_SIZE,
            offset: 0,
            total: 0,
            has_more: false,
          },
        );
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setError("تعذر الاتصال بالخادم");
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [pagination.offset, statusFilter],
  );

  useEffect(() => {
    const ac = new AbortController();
    void fetchHistory(ac.signal);
    return () => ac.abort();
  }, [fetchHistory]);

  // Reset to first page when filter changes.
  const handleFilterChange = (next: string) => {
    setStatusFilter(next);
    setPagination((p) => ({ ...p, offset: 0 }));
  };

  const goToPage = (offset: number) => {
    setPagination((p) => ({ ...p, offset }));
  };

  const pageNum = Math.floor(pagination.offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(pagination.total / PAGE_SIZE));

  return (
    <DriverLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-secondary flex items-center gap-2">
              <Calendar className="w-6 h-6 text-primary" />
              سجل التوصيلات
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              جميع الطلبات التي قمت بتوصيلها أو العمل عليها
            </p>
          </div>
          <button
            onClick={() => void fetchHistory()}
            className="p-2 bg-white rounded-lg shadow hover:bg-gray-50 border border-gray-200"
            disabled={loading}
            aria-label="تحديث"
          >
            <RefreshCw className={`w-5 h-5 text-gray-600 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Status filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((f) => {
            const Icon = f.icon;
            const active = statusFilter === f.value;
            return (
              <button
                key={f.value || "all"}
                onClick={() => handleFilterChange(f.value)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  active
                    ? "bg-primary text-white border-primary"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {f.label}
              </button>
            );
          })}
          <span className="text-xs text-gray-400 mr-2">
            {pagination.total} طلب
          </span>
        </div>

        {/* Error state */}
        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-16">
            <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center shadow-sm">
            <Package className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">
              {statusFilter
                ? "لا توجد طلبات بهذه الحالة"
                : "لم تكمل أي طلب بعد"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => {
              const statusConfig = getOrderStatusConfig(o.status);
              const StatusIcon = statusConfig.icon;
              const paymentConfig = getPaymentStatusConfig(o.payment_status);
              const timestamp = o.delivered_at ?? o.cancelled_at ?? o.created_at;
              const timestampLabel =
                o.status === "delivered"
                  ? "تم التوصيل في"
                  : o.status === "cancelled"
                    ? "تم الإلغاء في"
                    : "بدأ في";
              return (
                <div
                  key={o.id}
                  className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 md:p-5"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    {/* Left: order meta + customer */}
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-secondary text-lg">
                          #
                          {o.order_number ??
                            o.id.slice(0, 8)}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${statusConfig.color}`}
                        >
                          <StatusIcon className="w-3.5 h-3.5" />
                          {statusConfig.label}
                        </span>
                        {paymentConfig ? (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${paymentConfig.color}`}
                          >
                            {paymentConfig.label}
                          </span>
                        ) : null}
                      </div>

                      {(o.customer_name || o.customer_phone) && (
                        <div className="flex items-center gap-3 text-sm text-gray-700 flex-wrap">
                          {o.customer_name ? (
                            <span>{o.customer_name}</span>
                          ) : null}
                          {o.customer_phone ? (
                            <a
                              href={`tel:${o.customer_phone}`}
                              dir="ltr"
                              className="text-primary inline-flex items-center gap-1 hover:underline"
                            >
                              <Phone className="w-3 h-3" />
                              {o.customer_phone}
                            </a>
                          ) : null}
                        </div>
                      )}

                      {o.address_text ? (
                        <p className="text-xs text-gray-500 flex items-start gap-1.5">
                          <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span className="line-clamp-1">
                            {o.address_label ? `${o.address_label} — ` : ""}
                            {o.address_text}
                          </span>
                        </p>
                      ) : null}

                      <p className="text-xs text-gray-400 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {timestampLabel} {formatDate(timestamp)}
                      </p>
                    </div>

                    {/* Right: amounts */}
                    <div className="text-left space-y-0.5">
                      <p className="text-xs text-gray-500">
                        {PAYMENT_METHOD_AR[o.payment_method] ?? o.payment_method}
                      </p>
                      <p className="text-lg font-bold text-primary tabular-nums">
                        {formatPrice(o.total)}
                      </p>
                      {Number(o.delivery_fee) > 0 ? (
                        <p className="text-xs text-gray-500">
                          رسوم التوصيل: {formatPrice(o.delivery_fee)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {!loading && pagination.total > PAGE_SIZE ? (
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => goToPage(Math.max(0, pagination.offset - PAGE_SIZE))}
              disabled={pagination.offset === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              <ChevronRight className="w-4 h-4" />
              السابق
            </button>
            <span className="text-sm text-gray-600">
              صفحة {pageNum} من {totalPages}
            </span>
            <button
              onClick={() => goToPage(pagination.offset + PAGE_SIZE)}
              disabled={!pagination.has_more}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              التالي
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        ) : null}
      </div>
    </DriverLayout>
  );
}
