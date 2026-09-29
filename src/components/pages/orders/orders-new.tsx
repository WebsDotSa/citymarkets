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
import { OrderPaymentAction } from "./order-payment-action";
import { OrderTimeline } from "@/components/orders/order-timeline";
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
function deliveryTimeLabel(order: Order): string {
  if (order.status === "delivered") {
    return `تم التوصيل ${CLOCK_FORMAT.format(new Date(order.updated_at))}`;
  }
  if (order.status === "cancelled") return "ملغي";
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
  // BUGFIX: the previous build linked each card to `/orders/{id}`, but no
  // such dynamic route (or matching API) was ever created — every tap 404'd.
  // Render the detail view in-state from the already-loaded list, mirroring
  // the older OrdersPage pattern. See reviews/04-orders-404.md.
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

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

  // Render the selected order's detail view instead of the list.
  if (selectedOrderId) {
    const selected = orders.find((o) => o.id === selectedOrderId) ?? null;
    return (
      <OrderDetailNew
        orderId={selectedOrderId}
        initialOrder={selected}
        onBack={() => setSelectedOrderId(null)}
        onOrderUpdated={(updated) => {
          // Mirror the latest payment / status into the cached list so the
          // back navigation surfaces the new state without a full refetch.
          setOrders((prev) =>
            prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)),
          );
        }}
      />
    );
  }

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
                onSelect={(id) => setSelectedOrderId(id)}
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

// Order Detail Component
// BUGFIX: accepts an optional `initialOrder` so callers that already have
// the full order (the in-state list) can render without hitting a missing
// API. The fetch path remains so a future `/orders/[id]` page can still
// re-use the component.
export function OrderDetailNew({
  orderId,
  initialOrder,
  onBack,
  onOrderUpdated,
}: {
  orderId: string;
  initialOrder?: Order | null;
  onBack?: () => void;
  onOrderUpdated?: (order: Order) => void;
}) {
  const router = useRouter();
  const { user } = useAuthState();
  const [order, setOrder] = useState<Order | null>(initialOrder ?? null);
  const [loading, setLoading] = useState(initialOrder ? false : true);

  useEffect(() => {
    // If the caller already supplied the order, nothing to fetch.
    if (initialOrder) return;
    if (!user) {
      router.push("/auth/login");
      return;
    }

    apiFetch<Order>(`/api/v1/orders/${orderId}`)
      .then((res) => {
        if (res.success) setOrder(res.data ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [orderId, user, router, initialOrder]);

  // Re-pull the order after a payment retry so the status / payment_status
  // chips update without leaving the page. The retry API may flip
  // `cancelled + failed` back to `pending`, so we don't gate this on the
  // previous status.
  const handleRetryStarted = () => {
    apiFetch<Order>(`/api/v1/orders/${orderId}`)
      .then((res) => {
        if (res.success && res.data) {
          setOrder(res.data);
          onOrderUpdated?.(res.data);
        }
      })
      .catch(() => {
        /* keep stale view */
      });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary-600/30 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <p className="text-gray-500 mb-4">الطلب غير موجود</p>
        {onBack ? (
          <button onClick={onBack} className="text-primary-600 font-medium">
            العودة للطلبات
          </button>
        ) : (
          <Link href="/orders" className="text-primary-600 font-medium">
            العودة للطلبات
          </Link>
        )}
      </div>
    );
  }

  const statusConfig = getOrderStatusConfig(order.status);
  const StatusIcon = statusConfig.icon;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button
            onClick={() => (onBack ? onBack() : router.back())}
            className="p-2 -mr-2 hover:bg-gray-100 rounded-xl"
          >
            <ChevronRight className="w-6 h-6 text-gray-600" />
          </button>
          <div>
            <h1 className="font-bold text-gray-900">طلب #{order.order_number || order.id.slice(0, 8)}</h1>
            <p className="text-sm text-gray-500">تفاصيل الطلب</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-6 max-w-4xl mx-auto space-y-4">
        {/* Order Status Card */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <span className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 ${statusConfig.color}`}>
              <StatusIcon className="w-4 h-4" />
              {statusConfig.label}
            </span>
            <span className="text-sm text-gray-500">
              {new Date(order.created_at).toLocaleDateString("ar-SA")}
            </span>
          </div>

          {/* Phase 2 / P2: shared timeline component (5-step bar + log). */}
          <OrderTimeline currentStatus={order.status} orderId={order.id} />
        </div>

        {/* Delivery Info */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-3">معلومات التوصيل</h3>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center text-primary-600">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-gray-500">العنوان</p>
                <p className="font-medium text-gray-900">{deliveryAddressLabel(order)}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-gray-500">وقت التوصيل</p>
                <p className="font-medium text-gray-900">{deliveryTimeLabel(order)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Order Items */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-3">المنتجات ({order.items_count})</h3>
          <div className="space-y-4">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center gap-4">
                <OrderItemThumb
                  src={item.image_url}
                  alt={item.name_ar}
                  className="w-16 h-16 rounded-xl bg-gray-100 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 line-clamp-2">{item.name_ar}</p>
                  <p className="text-sm text-gray-500">الكمية: {item.quantity}</p>
                </div>
                <div className="text-left">
                  <p className="font-bold text-primary-600">
                    {(item.price * item.quantity).toFixed(2)} ر.س
                  </p>
                  <p className="text-xs text-gray-500">
                    {item.price.toFixed(2)} ر.س/الوحدة
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Order Summary */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-3">ملخص الطلب</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">طريقة الدفع</span>
              <span className="font-medium">
                {PAYMENT_METHOD_AR[order.payment_method] ?? order.payment_method}
              </span>
            </div>
            {order.payment_status ? (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">حالة الدفع</span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${
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
              </div>
            ) : null}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">المجموع</span>
              <span className="font-medium">{order.total.toFixed(2)} ر.س</span>
            </div>
          </div>
        </div>

        {/* Pay / Retry — only renders when the helper resolves to a CTA.
            Mounted before the "اطلب مرة أخرى" link so that for `cancelled +
            failed` orders the payment action takes priority over re-ordering. */}
        <OrderPaymentAction
          orderId={order.id}
          status={order.status}
          paymentStatus={order.payment_status ?? null}
          paymentMethod={order.payment_method ?? null}
          onRetryStarted={handleRetryStarted}
        />

        {/* Actions */}
        {order.status === "delivered" && (
          <button className="w-full py-4 bg-primary-600 text-white rounded-2xl font-semibold hover:bg-primary-700 transition-colors flex items-center justify-center gap-2">
            <Star className="w-5 h-5" />
            قيّم هذا الطلب
          </button>
        )}

        {order.status === "cancelled" && (
          <Link
            href="/catalog"
            className="block w-full py-4 bg-primary-600 text-white rounded-2xl font-semibold hover:bg-primary-700 transition-colors text-center"
          >
            اطلب مرة أخرى
          </Link>
        )}
      </div>
    </div>
  );
}
