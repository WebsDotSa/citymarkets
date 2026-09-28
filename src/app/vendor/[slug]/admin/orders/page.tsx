"use client";

import { useEffect, useState, use, useRef } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Loader2, ArrowRight } from "lucide-react";
import { ORDER_STATUS_DISPLAY, getOrderStatusConfig } from "@/lib/order-status";
import { csrfFetch } from "@/lib/csrf-client";

interface OrdersPageProps {
  params: Promise<{ slug: string }>;
}

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  customerName?: string;
  customerPhone: string;
  total: number;
  itemsCount: number;
  createdAt: string;
}

interface StatusCounts {
  pending: number;
  confirmed: number;
  shopping: number;
  on_the_way: number;
  delivered: number;
  cancelled: number;
}

const STATUS_TABS = [
  { key: "all", label: "الكل" },
  ...ORDER_STATUS_DISPLAY.map(({ value, label }) => ({ key: value, label })),
];

function getNextStatus(current: string): string | null {
  // Vendor_orders.status enum (migration 010). Surfaced in the UI as
  // the localized "shopping" / "on_the_way" labels via getOrderStatusConfig.
  const flow: Record<string, string> = {
    pending: "confirmed",
    confirmed: "shopping",
    shopping: "on_the_way",
    on_the_way: "delivered",
  };
  return flow[current] || null;
}

export default function VendorOrdersPage({ params }: OrdersPageProps) {
  const { slug } = use(params);
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusCounts, setStatusCounts] = useState<StatusCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    fetchOrders();
  }, [slug, activeTab, page]);

  async function fetchOrders() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: page.toString(), limit: "20" });
      if (activeTab !== "all") params.set("status", activeTab);

      const res = await fetch(`/api/v1/vendor/orders?${params}`);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
        setStatusCounts(data.statusCounts);
        setTotalPages(data.pagination?.totalPages || 1);
      }
    } catch (error) {
      console.error("Fetch orders error:", error);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(order: Order, newStatus: string) {
    setUpdating(order.id);
    try {
      const res = await csrfFetch(`/api/v1/vendor/orders/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        fetchOrders();
      }
    } catch (error) {
      console.error("Update status error:", error);
    } finally {
      setUpdating(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">الأوردرات</h1>
        <p className="text-gray-500">إدارة طلبات متجرك</p>
      </div>

      {/* Status tabs */}
      <div className="bg-white rounded-2xl p-2 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {STATUS_TABS.map((tab) => {
            const count = tab.key === "all"
              ? Object.values(statusCounts || {}).reduce((a, b) => a + b, 0)
              : statusCounts?.[tab.key as keyof StatusCounts] || 0;
            
            return (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  setPage(1);
                }}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? "bg-primary text-white"
                    : "hover:bg-gray-100"
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`mr-1 px-1.5 py-0.5 rounded-full text-xs ${
                    activeTab === tab.key ? "bg-white/20" : "bg-gray-100"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Orders list */}
      <div className="bg-white rounded-2xl overflow-hidden">
        {loading ? (
          <div className="divide-y">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4">
                <div className="h-4 w-24 bg-gray-100 rounded animate-pulse mb-2" />
                <div className="h-3 w-32 bg-gray-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : orders.length > 0 ? (
          <div className="divide-y">
            {orders.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                slug={slug}
                onOpen={() => router.push(`/vendor/${slug}/admin/orders/${order.id}`)}
                onUpdateStatus={(s) => updateStatus(order, s)}
                isUpdating={updating === order.id}
              />
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="text-gray-500">لا توجد أوردرات</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-4 py-2 rounded-xl border hover:bg-gray-50 disabled:opacity-50"
          >
            السابق
          </button>
          <span className="px-4 py-2">
            {page} من {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 rounded-xl border hover:bg-gray-50 disabled:opacity-50"
          >
            التالي
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One row in the orders list.
 *
 * Click → navigates to the routed detail page (deep-linkable, browser
 * back works as expected, shareable URL). The trailing "..." menu holds
 * the in-place quick-status action so vendor staff can advance the
 * pipeline without leaving the list.
 */
function OrderRow({
  order,
  slug,
  onOpen,
  onUpdateStatus,
  isUpdating,
}: {
  order: Order;
  slug: string;
  onOpen: () => void;
  onUpdateStatus: (status: string) => void;
  isUpdating: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the dropdown on outside click / Esc so it doesn't sit floating
  // after a vendor picks an action.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const nextStatus = getNextStatus(order.status);
  const canCancel =
    order.status !== "cancelled" &&
    order.status !== "delivered" &&
    order.status !== "refunded";

  return (
    <div
      className="p-4 hover:bg-gray-50 cursor-pointer transition flex items-center justify-between gap-2"
      onClick={onOpen}
    >
      <div className="flex items-center gap-2 min-w-0">
        <ArrowRight className="w-4 h-4 text-gray-300 shrink-0 rotate-180" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-gray-900">{order.orderNumber}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs ${getOrderStatusConfig(order.status).color}`}>
              {getOrderStatusConfig(order.status).label}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {order.customerPhone} • {order.itemsCount} منتج
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {new Date(order.createdAt).toLocaleString("ar-SA")}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="text-left">
          <p className="font-bold text-lg text-gray-900">{order.total.toFixed(2)} ر.س</p>
          <p className={`text-xs ${
            order.paymentStatus === "paid" ? "text-green-600" : "text-orange-600"
          }`}>
            {order.paymentStatus === "paid" ? "مدفوع" : "غير مدفوع"}
          </p>
        </div>

        {/* Quick-action menu — kept inline so staff don't have to leave
            the list just to advance a status. Click events stopPropagation
            so the row navigation doesn't fire when they pop the menu. */}
        <div ref={menuRef} className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            disabled={!nextStatus && !canCancel}
            aria-label="إجراءات سريعة"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isUpdating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <MoreVertical className="w-4 h-4" />
            )}
          </button>

          {menuOpen && (
            <div
              className="absolute left-0 top-full mt-1 w-44 rounded-xl border border-gray-200 bg-white shadow-lg z-20 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {nextStatus && (
                <button
                  onClick={() => {
                    onUpdateStatus(nextStatus);
                    setMenuOpen(false);
                  }}
                  className="w-full text-right px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  تأكيد: {STATUS_TABS.find((t) => t.key === nextStatus)?.label}
                </button>
              )}
              {canCancel && (
                <button
                  onClick={() => {
                    onUpdateStatus("cancelled");
                    setMenuOpen(false);
                  }}
                  className="w-full text-right px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition border-t border-gray-100"
                >
                  إلغاء الطلب
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
