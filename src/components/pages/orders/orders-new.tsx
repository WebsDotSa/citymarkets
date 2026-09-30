"use client";

/**
 * OrdersNew — customer-facing order list with timeline + retry CTAs.
 *
 * The `-new` suffix is intentional (audit H34): this file replaced an
 * older single-page `orders.tsx` flow during the orders-page redesign
 * (see docs/01). The legacy file was removed; the new one kept the
 * `-new` discriminator so the route import at src/app/orders/page.tsx
 * doesn't need to change. Do NOT rename without auditing the 1 importer.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthState, useAuthActions } from "@/contexts/auth-context";
import { OrderItemThumb } from "@/components/ui/order-item-thumb";
import {
  Package,
  ChevronRight,
  Clock,
  MapPin,
  ArrowLeft,
  Truck,
  Star,
  Search,
  Plus,
} from "lucide-react";
import {
  ACTIVE_ORDER_STATUSES,
  PAYMENT_METHOD_AR,
  PAYMENT_STATUS_AR,
  getOrderStatusConfig,
  getPaymentStatusConfig,
} from '@/lib/orders';
import { apiFetch } from '@/lib/catalog';

interface Order {
  id: string;
  order_number?: string | null;
  // Backend stores the value as `shopping`; accept both shapes so older
  // snapshots and any in-flight payloads still render.
  status: string;
  total: number;
  items_count: number;
  created_at: string;
  updated_at: string;
  delivery_address: string | null;
  payment_method: string;
  payment_status?: string;
  // Phase E1 (2026-09-30): scheduled-delivery fields surfaced from
  // `orders.scheduled_for` / `orders.slot_window`. Both are optional
  // because the catalog only stores them on scheduled orders — a
  // missing value means "immediate delivery" and we keep the standing
  // "30-45 دقيقة" promise.
  scheduled?: boolean;
  scheduled_for?: string | null;
  slot_window?: string | null;
  items: {
    id: string;
    name_ar: string;
    image_url: string;
    quantity: number;
    price: number;
  }[];
}

// `getOrderStatusConfig` is the single lookup helper shared with the admin UI.
// Use it directly rather than indexing the status map so unknown backend
// values fall back to a safe placeholder instead of throwing.

const FILTER_OPTIONS = [
  { value: "all", label: "الكل" },
  { value: "active", label: "نشطة" },
  { value: "completed", label: "مكتملة" },
  { value: "cancelled", label: "ملغية" },
];

const CLOCK_FORMAT = new Intl.DateTimeFormat("ar-SA", {
  hour: "2-digit",
  minute: "2-digit",
});

// `orders` has no delivery_time column — catalog orders are same-day express.
// Show the real drop-off time once delivered, otherwise the standing promise.
// For scheduled orders we honour the customer-picked window.
function deliveryTimeLabel(order: Order): string {
  if (order.status === "delivered") {
    return `تم التوصيل ${CLOCK_FORMAT.format(new Date(order.updated_at))}`;
  }
  if (order.status === "cancelled") return "ملغي";
  if (order.scheduled && order.scheduled_for) {
    const when = new Date(order.scheduled_for);
    if (!Number.isNaN(when.getTime())) {
      const date = when.toLocaleDateString("ar-SA", { dateStyle: "medium" });
      const time = CLOCK_FORMAT.format(when);
      const slot = order.slot_window ? ` — ${order.slot_window}` : "";
      return `مجدول · ${date} · ${time}${slot}`;
    }
  }
  return "متوقع خلال 30-45 دقيقة";
}

function deliveryAddressLabel(order: Order): string {
  const raw = order.delivery_address?.trim();
  if (!raw) return "لم يتم تحديد العنوان";
  // Hide raw lat,lng stored as text (legacy addresses saved without reverse-geocode)
  if (/^\d+(\.\d+)?,\s*\d+(\.\d+)?$/.test(raw)) {
    return "حدد العنوان على الخريطة";
  }
  return raw;
}

export function OrdersNew() {
  const router = useRouter();
  const { user } = useAuthState();
  const { refreshUser } = useAuthActions();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  // P1-9 (full-system audit 2026-09-30): navigate to the dedicated
  // `/orders/{id}` route instead of rendering an in-state duplicate
  // of `OrderDetailClient`. The detail client already polls + invoices,
  // and the canonical route makes the URL shareable. The previous
  // BUGFIX comment is stale — the route has existed for some time
  // and `src/app/orders/[id]/page.test.tsx` pins the contract.

  useEffect(() => {
    if (!user) {
      router.push("/auth/login?redirect=/orders");
      return;
    }

    (async () => {
      try {
        const r = await fetch("/api/v1/orders", { credentials: "include" });
        if (r.status === 401) {
          // Stale optimistic state: header shows a name but the cookie was
          // rejected by the server. Drop back to login.
          await refreshUser();
          window.location.assign("/auth/login?redirect=/orders");
          return;
        }
        const res = await r.json();
        if (res.success) setOrders(res.data || []);
      } catch {
        /* keep existing state */
      } finally {
        setLoading(false);
      }
    })();
  }, [user, router, refreshUser]);

  const filteredOrders = orders.filter((order) => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!(order.order_number || '').toLowerCase().includes(query)) {
        return false;
      }
    }

    // Status filter — uses the canonical active-status list so customers see
    // the same "active" bucket admin/staff use, including the `shopping` value
    // the backend actually stores.
    if (filter === "all") return true;
    if (filter === "active") {
      return ACTIVE_ORDER_STATUSES.includes(order.status);
    }
    if (filter === "completed") return order.status === "delivered";
    if (filter === "cancelled") return order.status === "cancelled";
    return true;
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("ar-SA", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("ar-SA", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary-600/30 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  // P1-9: the in-state detail fallback was removed; card clicks now
  // navigate to `/orders/{id}` which renders the canonical
  // `OrderDetailClient` (server component) — polling, invoice,
  // chat panel for direct orders, and a shareable URL.

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-l from-primary-600 to-primary-700 px-4 pt-6 pb-20">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <Link href="/profile" className="p-2 -mr-2 hover:bg-white/20 rounded-xl transition-colors">
              <ChevronRight className="w-6 h-6 text-white" />
            </Link>
            <h1 className="text-2xl font-bold text-white">طلباتي</h1>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-white/20 backdrop-blur rounded-2xl p-4 text-center">
              <p className="text-3xl font-bold text-white">{orders.length}</p>
              <p className="text-sm text-white/80">إجمالي الطلبات</p>
            </div>
            <div className="bg-white/20 backdrop-blur rounded-2xl p-4 text-center">
              <p className="text-3xl font-bold text-white">
                {orders.filter((o) => o.status === "delivered").length}
              </p>
              <p className="text-sm text-white/80">مكتملة</p>
            </div>
            <div className="bg-white/20 backdrop-blur rounded-2xl p-4 text-center">
              <p className="text-3xl font-bold text-white">
                {orders.filter((o) => ACTIVE_ORDER_STATUSES.includes(o.status)).length}
              </p>
              <p className="text-sm text-white/80">نشطة</p>
            </div>
          </div>

          {/* Direct Order CTA */}
          <Link
            href="/orders/direct"
            className="flex items-center justify-center gap-2 bg-white text-primary-700 font-bold py-3 rounded-xl hover:bg-white/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            طلب مباشر جديد
          </Link>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="px-4 -mt-10 relative z-10">
        <div className="bg-white rounded-2xl shadow-lg p-4">
          {/* Search */}
          <div className="relative mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث برقم الطلب..."
              className="w-full h-12 pr-12 pl-4 bg-gray-50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 border border-gray-200 focus:border-primary-500 transition-all"
            />
            <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          </div>

          {/* Filters */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setFilter(option.value)}
                className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  filter === option.value
                    ? "bg-primary-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Orders List */}
      <div className="px-4 mt-4 max-w-4xl mx-auto">
        {filteredOrders.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Package className="w-10 h-10 text-gray-400" />
            </div>
            <h3 className="font-bold text-gray-900 mb-2">لا توجد طلبات</h3>
            <p className="text-gray-500 text-sm mb-4">
              {searchQuery || filter !== "all"
                ? "لم يتم العثور على نتائج مطابقة"
                : "لم تقم بأي طلبات بعد"}
            </p>
            <Link
              href="/catalog"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 transition-colors"
            >
              تسوق الآن
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                formatDate={formatDate}
                formatTime={formatTime}
                onSelect={(id) => router.push(`/orders/${id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface OrderCardProps {
  order: Order;
  formatDate: (date: string) => string;
  formatTime: (date: string) => string;
  onSelect: (orderId: string) => void;
}

function OrderCard({ order, formatDate, formatTime, onSelect }: OrderCardProps) {
  const statusConfig = getOrderStatusConfig(order.status);
  const StatusIcon = statusConfig.icon;

  return (
    <button
      type="button"
      onClick={() => onSelect(order.id)}
      className="block w-full text-right"
    >
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all">
        {/* Header */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-bold text-gray-900">#{order.order_number || order.id.slice(0, 8)}</p>
              <p className="text-xs text-gray-500">
                {formatDate(order.created_at)} - {formatTime(order.created_at)}
              </p>
            </div>
            <span className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 ${statusConfig.color}`}>
              <StatusIcon className="w-3.5 h-3.5" />
              {statusConfig.label}
            </span>
          </div>

          {/* Delivery Info */}
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <div className="flex items-center gap-1.5 min-w-0">
              <MapPin className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{deliveryAddressLabel(order)}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Clock className="w-4 h-4" />
              <span>{deliveryTimeLabel(order)}</span>
            </div>
          </div>
        </div>

        {/* Items Preview */}
        <div className="p-4">
          <div className="flex items-center gap-3">
            {/* Items Images */}
            <div className="flex -space-x-2 space-x-reverse">
              {order.items.slice(0, 3).map((item, index) => (
                <div
                  key={item.id}
                  style={{ zIndex: 3 - index }}
                >
                  <OrderItemThumb
                    src={item.image_url}
                    alt={item.name_ar}
                    className="w-12 h-12 rounded-xl bg-gray-100 border-2 border-white"
                  />
                </div>
              ))}
              {order.items_count > 3 && (
                <div className="w-12 h-12 rounded-xl bg-gray-100 border-2 border-white flex items-center justify-center">
                  <span className="text-xs font-semibold text-gray-600">+{order.items_count - 3}</span>
                </div>
              )}
            </div>

            <div className="flex-1">
              <p className="text-sm text-gray-500">{order.items_count} منتجات</p>
            </div>

            <div className="text-left">
              <p className="font-bold text-primary-600">{order.total.toFixed(2)} ر.س</p>
              <p className="text-xs text-gray-500">
                {PAYMENT_METHOD_AR[order.payment_method] ?? order.payment_method}
              </p>
              {order.payment_status ? (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full w-fit ${
                    getPaymentStatusConfig(order.payment_status).color
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      getPaymentStatusConfig(order.payment_status).dotColor
                    }`}
                  />
                  {PAYMENT_STATUS_AR[order.payment_status] ?? order.payment_status}
                </span>
              ) : null}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
            <div className="flex gap-2">
              {order.status === "delivered" && (
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-100 transition-colors">
                  <Star className="w-4 h-4" />
                  قيّم
                </button>
              )}
              {order.status === "on_the_way" && (
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-50 text-primary-700 rounded-lg text-sm font-medium hover:bg-primary-100 transition-colors">
                  <Truck className="w-4 h-4" />
                  تتبع
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 text-primary-600 text-sm font-medium">
              <span>التفاصيل</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

// P1-9 (full-system audit 2026-09-30): the in-state `OrderDetailNew`
// component was removed. Customers now navigate to `/orders/{id}`
// which renders the canonical `OrderDetailClient` (see
// `src/app/orders/[id]/page.tsx`). The previous duplicate rendered
// ~230 lines of detail UI here with its own data-fetch path — the
// route's `OrderDetailClient` already covers polling + invoice +
// chat-for-direct and lives behind a shareable URL.
