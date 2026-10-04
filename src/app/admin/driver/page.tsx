"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Truck,
  MapPin,
  Phone,
  Package,
  Clock,
  CheckCircle,
  XCircle,
  Navigation,
  RefreshCw,
  User,
} from "lucide-react";
import { DriverLayout } from "@/components/admin/driver-layout";
import { SearchableSelect } from "@/components/admin/SearchableSelect";
import { useToast } from "@/components/ui/toast";
import { getOrderStatusConfig } from '@/lib/orders';

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
}

interface Order {
  id: string;
  order_number?: string | null;
  status: string;
  total: number;
  delivery_fee: number;
  payment_method: string;
  payment_status: string;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  delivery_lat: number;
  delivery_lng: number;
  address_text: string;
  address_label: string;
  items: OrderItem[];
  customer_order_count: number;
}

interface Counts {
  pending: number;
  on_the_way: number;
  delivered: number;
  cancelled: number;
}


export default function DriverDashboard() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [counts, setCounts] = useState<Counts>({
    pending: 0,
    on_the_way: 0,
    delivered: 0,
    cancelled: 0,
  });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [updatingOrder, setUpdatingOrder] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showFailModal, setShowFailModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [failureReason, setFailureReason] = useState("");
  const { showToast } = useToast();

  // Auth check removed - now handled by DriverLayout

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const url = filter
        ? `/api/admin/driver/orders?status=${filter}`
        : "/api/admin/driver/orders";
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders);
        setCounts(data.counts);
      } else {
        console.error(data.error);
      }
    } catch (error) {
      console.error("Error fetching orders:", error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const updateOrderStatus = async (orderId: string, status: string, reason?: string) => {
    setUpdatingOrder(orderId);
    try {
      // Phase 1 / T3: the on_the_way transition claims the order atomically
      // (sets driver_id). For delivered/cancelled, the order is already ours
      // and we just continue the lifecycle.
      const claim = status === "on_the_way";
      const res = await fetch(`/api/admin/driver/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, failureReason: reason, claim }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchOrders();
        setShowSuccessModal(false);
        setShowFailModal(false);
        setSelectedOrder(null);
        setFailureReason("");
      } else if (res.status === 409) {
        showToast("تم استلام الطلب من مندوب آخر", "warning");
        await fetchOrders();
        setShowSuccessModal(false);
        setShowFailModal(false);
        setSelectedOrder(null);
        setFailureReason("");
      } else {
        showToast(data.error || "فشل تحديث الطلب", "error");
      }
    } catch (error) {
      console.error("Error updating order:", error);
      showToast("حدث خطأ في تحديث الطلب", "error");
    } finally {
      setUpdatingOrder(null);
    }
  };

  const openMapsNavigation = (lat: number, lng: number, address?: string) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, "_blank");
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString("ar-SA", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const totalPending = counts.pending + counts.on_the_way;

  return (
    <DriverLayout>
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              طلبات التوصيل
            </h1>
            <p className="text-gray-600 mt-1">
              لديك {totalPending} طلب في الانتظار
            </p>
          </div>
          <button
            onClick={fetchOrders}
            className="p-2 bg-white rounded-lg shadow hover:bg-gray-50"
            disabled={loading}
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div
          className={`bg-white rounded-xl p-4 shadow cursor-pointer transition-all ${
            filter === "" ? "ring-2 ring-primary" : ""
          }`}
          onClick={() => setFilter("")}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">الكل</p>
              <p className="text-2xl font-bold text-gray-900">
                {Object.values(counts).reduce((a, b) => a + b, 0)}
              </p>
            </div>
            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
              <Package className="w-5 h-5 text-gray-600" />
            </div>
          </div>
        </div>

        <div
          className={`bg-white rounded-xl p-4 shadow cursor-pointer transition-all ${
            filter === "on_the_way" ? "ring-2 ring-blue-500" : ""
          }`}
          onClick={() => setFilter("on_the_way")}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">جاري التوصيل</p>
              <p className="text-2xl font-bold text-blue-600">
                {counts.on_the_way}
              </p>
            </div>
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <Truck className="w-5 h-5 text-blue-600" />
            </div>
          </div>
        </div>

        <div
          className={`bg-white rounded-xl p-4 shadow cursor-pointer transition-all ${
            filter === "pending" ? "ring-2 ring-amber-500" : ""
          }`}
          onClick={() => setFilter("pending")}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">في الانتظار</p>
              <p className="text-2xl font-bold text-amber-600">
                {counts.pending}
              </p>
            </div>
            <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
          </div>
        </div>

        <div
          className={`bg-white rounded-xl p-4 shadow cursor-pointer transition-all ${
            filter === "delivered" ? "ring-2 ring-green-500" : ""
          }`}
          onClick={() => setFilter("delivered")}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">تم التوصيل</p>
              <p className="text-2xl font-bold text-primary-600">
                {counts.delivered}
              </p>
            </div>
            <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-primary-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center shadow">
          <Package className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-500">لا توجد طلبات</p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const config = getOrderStatusConfig(order.status);
            const StatusIcon = config.icon;
            return (
              <div
                key={order.id}
                className="bg-white rounded-xl shadow overflow-hidden"
              >
                {/* Order Header */}
                <div className="p-4 border-b">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-lg">#{order.order_number || order.id.slice(0, 8)}</span>
                      <span className={`inline-flex items-center gap-1 mr-2 px-2 py-1 rounded-full text-xs ${config.color}`}>
                        <StatusIcon className="w-4 h-4" />
                        {config.label}
                      </span>
                    </div>
                    <span className="text-gray-500 text-sm">
                      {formatDate(order.created_at)}
                    </span>
                  </div>
                </div>

                {/* Customer Info */}
                <div className="p-4 border-b bg-gray-50">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                      <User className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">
                        {order.customer_name || "عميل"}
                      </p>
                      {order.customer_phone && (
                        <a
                          href={`tel:${order.customer_phone}`}
                          className="text-sm text-primary flex items-center gap-1"
                        >
                          <Phone className="w-3 h-3" />
                          {order.customer_phone}
                        </a>
                      )}
                      <p className="text-sm text-gray-500 mt-1">
                        طلبية رقم {order.customer_order_count + 1} للعميل
                      </p>
                    </div>
                  </div>
                </div>

                {/* Address & Location */}
                <div className="p-4 border-b">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                      <MapPin className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">
                        {order.address_label || "عنوان التوصيل"}
                      </p>
                      <p className="text-sm text-gray-600">{order.address_text}</p>
                      {order.delivery_lat && order.delivery_lng && (
                        <button
                          onClick={() =>
                            openMapsNavigation(
                              order.delivery_lat,
                              order.delivery_lng,
                              order.address_text
                            )
                          }
                          className="mt-2 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Navigation className="w-4 h-4" />
                          فتح الموقع في خرائط قوقل
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Order Items */}
                <div className="p-4 border-b">
                  <p className="text-sm font-medium text-gray-700 mb-2">المشتريات:</p>
                  <div className="space-y-2">
                    {order.items?.slice(0, 3).map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between text-sm"
                      >
                        <span className="text-gray-600">
                          {item.quantity}x {item.name}
                        </span>
                        <span className="font-medium">{item.price} ر.س</span>
                      </div>
                    ))}
                    {order.items?.length > 3 && (
                      <p className="text-sm text-gray-500">
                        +{order.items.length - 3} منتجات أخرى
                      </p>
                    )}
                  </div>
                  <div className="mt-3 pt-3 border-t flex justify-between font-bold">
                    <span>المجموع</span>
                    <span>{order.total} ر.س</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="p-4 bg-gray-50">
                  {order.status === "pending" && (
                    <button
                      onClick={() => {
                        setSelectedOrder(order);
                        updateOrderStatus(order.id, "on_the_way");
                      }}
                      disabled={updatingOrder === order.id}
                      className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {updatingOrder === order.id ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Truck className="w-4 h-4" />
                          ابدأ التوصيل
                        </>
                      )}
                    </button>
                  )}

                  {order.status === "on_the_way" && (
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setSelectedOrder(order);
                          setShowSuccessModal(true);
                        }}
                        disabled={updatingOrder === order.id}
                        className="flex-1 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        <CheckCircle className="w-4 h-4" />
                        تم التوصيل
                      </button>
                      <button
                        onClick={() => {
                          setSelectedOrder(order);
                          setShowFailModal(true);
                        }}
                        disabled={updatingOrder === order.id}
                        className="flex-1 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        <XCircle className="w-4 h-4" />
                        فشل
                      </button>
                    </div>
                  )}

                  {(order.status === "delivered" || order.status === "cancelled") && (
                    <div className="flex items-center justify-center text-gray-500">
                      <CheckCircle className="w-4 h-4 mr-2" />
                      {order.status === "delivered"
                        ? "تم التوصيل"
                        : "تم تسجيل الفشل"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Success Modal */}
      {showSuccessModal && selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1100] p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-primary-600" />
              </div>
              <h3 className="text-xl font-bold">تأكيد التوصيل</h3>
              <p className="text-gray-600 mt-2">
                هل تؤكد استلام العميل للطلب #{selectedOrder.order_number}؟
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowSuccessModal(false);
                  setSelectedOrder(null);
                }}
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200"
              >
                إلغاء
              </button>
              <button
                onClick={() =>
                  updateOrderStatus(selectedOrder.id, "delivered")
                }
                disabled={updatingOrder === selectedOrder.id}
                className="flex-1 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                {updatingOrder === selectedOrder.id ? (
                  <RefreshCw className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  "تأكيد"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Failure Modal */}
      {showFailModal && selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1100] p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-xl font-bold">تسجيل فشل التوصيل</h3>
              <p className="text-gray-600 mt-2">
                يرجى تحديد سبب فشل التوصيل للطلب #{selectedOrder.order_number}
              </p>
            </div>
            <div className="mb-4">
              <SearchableSelect
                value={failureReason}
                onChange={setFailureReason}
                options={[
                  { value: "customer_not_available", label: "العميل غير متوفر" },
                  { value: "wrong_address", label: "العنوان غير صحيح" },
                  { value: "customer_refused", label: "العميل رفض الاستلام" },
                  { value: "damaged", label: "المنتجات تالفة" },
                  { value: "other", label: "سبب آخر" },
                ]}
                placeholder="اختر السبب..."
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowFailModal(false);
                  setSelectedOrder(null);
                  setFailureReason("");
                }}
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200"
              >
                إلغاء
              </button>
              <button
                onClick={() =>
                  updateOrderStatus(selectedOrder.id, "cancelled", failureReason)
                }
                disabled={!failureReason || updatingOrder === selectedOrder.id}
                className="flex-1 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {updatingOrder === selectedOrder.id ? (
                  <RefreshCw className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  "تسجيل"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </DriverLayout>
  );
}
