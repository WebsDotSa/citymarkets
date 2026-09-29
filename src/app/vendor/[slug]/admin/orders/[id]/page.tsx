"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, MapPin, Phone, User as UserIcon, MessageCircle, Tag, Clock } from "lucide-react";
import {
  getOrderStatusConfig,
  getPaymentStatusConfig,
  ORDER_STATUS_DISPLAY,
  PAYMENT_METHOD_AR,
} from '@/lib/orders';
import { csrfFetch } from "@/lib/csrf-client";
import { useVendorRole } from "../../_lib/vendor-role-context";

interface OrderDetailPageProps {
  params: Promise<{ slug: string; id: string }>;
}

interface OrderItem {
  id: string;
  productId: string;
  name: string;
  sku: string | null;
  image: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  notes: string | null;
}

interface OrderCustomer {
  id: string | null;
  name: string | null;
  phone: string;
  email: string | null;
}

interface OrderAddress {
  text: string | null;
  lat: number | null;
  lng: number | null;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  moyasarPaymentId: string | null;
  customer: OrderCustomer;
  address: OrderAddress;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  preparedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
}

interface VendorInfo {
  id: string;
  name: string;
}

/**
 * Vendor-scoped order detail.
 *
 * The API at `/api/v1/vendor/orders/[id]` already filters the underlying
 * `vendor_orders` row by `vendor_id = $session.vendorId`, so a vendor
 * hitting this page for a child that doesn't belong to them gets a 404
 * from the API and we render the not-found UI. Items shown are the
 * vendor's slice only — the parent admin view sees every vendor's
 * items together.
 */
export default function VendorOrderDetailPage({ params }: OrderDetailPageProps) {
  const { slug, id } = use(params);
  const router = useRouter();
  const { canDo, isReadOnly } = useVendorRole();
  const canManage = canDo("manage_orders");
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [vendor, setVendor] = useState<VendorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    loadOrder();
  }, [id]);

  async function loadOrder() {
    setLoading(true);
    setNotFound(false);
    try {
      const res = await fetch(`/api/v1/vendor/orders/${id}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        setUpdateError("تعذّر تحميل تفاصيل الطلب");
        return;
      }
      const data = await res.json();
      setOrder(data.order);
      setVendor(data.vendor);
    } catch {
      setUpdateError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(newStatus: string) {
    if (!order) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      const res = await csrfFetch(`/api/v1/vendor/orders/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setUpdateError(data.error || "تعذّر تحديث الحالة");
        return;
      }
      // Reload to get updated timestamps (confirmed_at / prepared_at / etc.)
      await loadOrder();
    } catch {
      setUpdateError("تعذّر الاتصال بالخادم");
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" dir="rtl">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-slate-500">جاري تحميل الطلب…</p>
        </div>
      </div>
    );
  }

  if (notFound || !order) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center" dir="rtl">
        <h1 className="text-lg font-bold text-slate-900 mb-2">الطلب غير موجود</h1>
        <p className="text-sm text-slate-500 mb-6">
          قد يكون الطلب تابعاً لمتجر آخر أو أُلغي.
        </p>
        <Link
          href={`/vendor/${slug}/admin/orders`}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primaryDark transition"
        >
          <ArrowRight className="w-4 h-4 rotate-180" />
          العودة إلى القائمة
        </Link>
      </div>
    );
  }

  const statusConfig = getOrderStatusConfig(order.status);
  const paymentConfig = getPaymentStatusConfig(order.paymentStatus);
  const StatusIcon = statusConfig.icon;
  const nextStatus = getNextStatus(order.status);
  const isTerminal =
    order.status === "delivered" ||
    order.status === "cancelled" ||
    order.status === "refunded";

  // Normalize phone for WhatsApp deep-link (strip non-digits, KSA default +966)
  const phoneDigits = (order.customer.phone || "").replace(/[^0-9]/g, "");
  const whatsappPhone = phoneDigits.startsWith("966")
    ? phoneDigits
    : phoneDigits.startsWith("0")
      ? `966${phoneDigits.slice(1)}`
      : `966${phoneDigits}`;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/vendor/${slug}/admin/orders`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-primary transition"
        >
          <ArrowRight className="w-4 h-4 rotate-180" />
          العودة إلى القائمة
        </Link>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${statusConfig.color}`}
          >
            <StatusIcon className="w-3.5 h-3.5" />
            {statusConfig.label}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${paymentConfig.color}`}
          >
            <span className={`w-1.5 h-1.5 ${paymentConfig.dotColor} rounded-full`} />
            {paymentConfig.label}
          </span>
        </div>
      </div>

      {/* Order number + meta */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{order.orderNumber}</h1>
            <p className="text-xs text-slate-500 mt-1">
              أُنشئ في {new Date(order.createdAt).toLocaleString("ar-SA")}
            </p>
            {vendor && (
              <p className="text-xs text-slate-500 mt-0.5">
                المتجر: <span className="font-semibold text-slate-700">{vendor.name}</span>
              </p>
            )}
          </div>
          <div className="text-left">
            <p className="text-xs text-slate-500">طريقة الدفع</p>
            <p className="font-semibold text-slate-900">
              {PAYMENT_METHOD_AR[order.paymentMethod] || order.paymentMethod}
            </p>
            {order.moyasarPaymentId && (
              <p className="text-[10px] text-slate-400 mt-1 font-mono">
                {order.moyasarPaymentId}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Timeline (rendered only when at least one transition happened) */}
      {(order.confirmedAt || order.preparedAt || order.deliveredAt || order.cancelledAt) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            سجل الحالات
          </h2>
          <ul className="space-y-2 text-xs text-slate-600">
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-300" />
              <span className="text-slate-500">أُنشئ:</span>
              <span className="font-medium">{new Date(order.createdAt).toLocaleString("ar-SA")}</span>
            </li>
            {order.confirmedAt && (
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-slate-500">تم التأكيد:</span>
                <span className="font-medium">{new Date(order.confirmedAt).toLocaleString("ar-SA")}</span>
              </li>
            )}
            {order.preparedAt && (
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-500" />
                <span className="text-slate-500">بدأ التحضير:</span>
                <span className="font-medium">{new Date(order.preparedAt).toLocaleString("ar-SA")}</span>
              </li>
            )}
            {order.deliveredAt && (
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-slate-500">تم التوصيل:</span>
                <span className="font-medium">{new Date(order.deliveredAt).toLocaleString("ar-SA")}</span>
              </li>
            )}
            {order.cancelledAt && (
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-slate-500">أُلغي:</span>
                <span className="font-medium">{new Date(order.cancelledAt).toLocaleString("ar-SA")}</span>
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Customer + Address */}
      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-primary" />
            العميل
          </h2>
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-slate-900">
              {order.customer.name || order.customer.phone}
            </p>
            <a
              href={`tel:${order.customer.phone}`}
              className="flex items-center gap-2 text-slate-700 hover:text-primary"
            >
              <Phone className="w-4 h-4 text-slate-400" />
              <span dir="ltr">{order.customer.phone}</span>
            </a>
            {order.customer.email && (
              <p className="text-xs text-slate-500" dir="ltr">
                {order.customer.email}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            عنوان التوصيل
          </h2>
          <p className="text-sm text-slate-700">
            {order.address.text || "—"}
          </p>
          {order.address.lat != null && order.address.lng != null && (
            <p className="text-[11px] text-slate-400 mt-2 font-mono" dir="ltr">
              {Number(order.address.lat).toFixed(5)}, {Number(order.address.lng).toFixed(5)}
            </p>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">
          المنتجات ({order.items.length})
        </h2>
        <div className="divide-y divide-slate-100">
          {order.items.map((item) => (
            <div key={item.id} className="py-3 flex items-center gap-3">
              <div className="w-14 h-14 rounded-xl bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image}
                    alt={item.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Tag className="w-5 h-5 text-slate-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-slate-900 truncate">{item.name}</p>
                {item.sku && (
                  <p className="text-[11px] text-slate-400 font-mono" dir="ltr">
                    SKU: {item.sku}
                  </p>
                )}
                <p className="text-xs text-slate-500 mt-0.5">
                  {item.unitPrice.toFixed(2)} ر.س × {item.quantity}
                </p>
                {item.notes && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1 mt-1.5 inline-block">
                    ملاحظة: {item.notes}
                  </p>
                )}
              </div>
              <div className="text-left shrink-0">
                <p className="font-bold text-sm text-slate-900">
                  {item.lineTotal.toFixed(2)} ر.س
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="border-t border-slate-200 mt-3 pt-3 space-y-1.5 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>المجموع الفرعي</span>
            <span className="font-medium" dir="ltr">
              {order.subtotal.toFixed(2)} ر.س
            </span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>رسوم التوصيل</span>
            <span className="font-medium" dir="ltr">
              {order.deliveryFee.toFixed(2)} ر.س
            </span>
          </div>
          <div className="flex justify-between text-base font-bold text-slate-900 pt-1.5 border-t border-slate-100">
            <span>الإجمالي</span>
            <span className="text-primary" dir="ltr">
              {order.total.toFixed(2)} ر.س
            </span>
          </div>
        </div>
      </div>

      {/* Notes (admin / customer notes) */}
      {order.notes && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold text-amber-800 mb-1">ملاحظات</p>
          <p className="text-sm text-amber-900">{order.notes}</p>
        </div>
      )}

      {/* Error inline */}
      {updateError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {updateError}
        </div>
      )}

      {/* Actions */}
      <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-white/95 backdrop-blur border-t border-slate-200 shadow-sm">
        {isReadOnly && (
          <div
            role="status"
            aria-live="polite"
            className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"
          >
            وضع القراءة فقط — لا يمكنك تغيير حالة هذا الطلب بهذه الصلاحية.
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          {nextStatus && (
            <button
              onClick={() => updateStatus(nextStatus)}
              disabled={updating || !canManage}
              title={canManage ? undefined : "ليس لديك صلاحية"}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primaryDark transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري التحديث…
                </>
              ) : (
                <>تأكيد: {getStatusLabel(nextStatus)}</>
              )}
            </button>
          )}

          {!isTerminal && order.status !== "pending" && (
            <button
              onClick={() => updateStatus("cancelled")}
              disabled={updating || !canManage}
              title={canManage ? undefined : "ليس لديك صلاحية"}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              إلغاء الطلب
            </button>
          )}

          <a
            href={`https://wa.me/${whatsappPhone}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-green-500 px-4 py-3 text-sm font-semibold text-white hover:bg-green-600 transition"
          >
            <MessageCircle className="w-4 h-4" />
            واتساب العميل
          </a>
        </div>
      </div>
    </div>
  );
}

function getNextStatus(current: string): string | null {
  // Vendor-side status flow. Mirrors the keys the API actually accepts
  // — `preparing` and `out_for_delivery` per the vendor_orders enum
  // (migration 010). Pending orders also surface "cancelled" via the
  // cancel button below rather than here.
  const flow: Record<string, string> = {
    pending: "confirmed",
    confirmed: "preparing",
    preparing: "out_for_delivery",
    out_for_delivery: "delivered",
  };
  return flow[current] || null;
}

function getStatusLabel(status: string): string {
  const entry = ORDER_STATUS_DISPLAY.find((s) => s.value === status);
  if (entry) return entry.label;
  // Statuses that exist in the API but not in the public display array
  // (vendor-only enum values).
  const aliases: Record<string, string> = {
    preparing: "جارٍ التحضير",
    out_for_delivery: "في الطريق",
    refunded: "مسترد",
  };
  return aliases[status] || status;
}