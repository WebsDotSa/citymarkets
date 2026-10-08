"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  buildOrderPreparingWhatsAppMessage,
  buildWhatsAppUrl,
  formatOrderId,
  formatPrice,
  googleMapsDirectionsUrl,
  googleMapsPlaceUrl,
  parseCoords,
} from "@/lib/format";
import {
  CUSTOMER_PROGRESS_STEPS,
  ORDER_STATUS_DISPLAY,
  PAYMENT_METHOD_AR,
  PAYMENT_STATUS_AR,
  canTransition,
  getOrderStatusConfig,
  getPaymentStatusConfig,
} from '@/lib/orders';
import {
  ArrowRight,
  Camera,
  Calendar,
  ExternalLink,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Package,
  User,
  StickyNote,
  MessageSquare,
  AlertCircle,
  Clock,
  CreditCard,
  Receipt,
  Save,
  RefreshCw,
  Truck,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import { OrderItemThumb } from "@/components/ui/order-item-thumb";
import { InvoiceActions } from "@/components/orders/invoice-actions";
import { OrderTimeline } from "@/components/orders/order-timeline";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.881 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

const STATUS_OPTIONS = ORDER_STATUS_DISPLAY;

function buildAddressLine(order: Record<string, unknown>): string {
  const saved = String(order.address_text || "").trim();
  if (saved) return saved;
  return [
    order.guest_city,
    order.guest_district,
    order.guest_street,
    order.guest_building,
  ]
    .filter(Boolean)
    .join("، ");
}

// Render the "who flipped the status last" badge shown under the order
// header. Distinguishes delivery drivers (Truck icon + blue) from admins
// (ShieldCheck icon + neutral). Falls back to a generic dot when the
// change was system-triggered (no admin_user_id link).
function LastStatusChangeBadge({
  change,
}: {
  change: {
    old_status: string | null;
    new_status: string;
    created_at: string;
    changed_by_admin_id: string | null;
    changed_by_name: string | null;
    changed_by_role: string | null;
    changed_by_legacy: string | null;
  } | null;
}) {
  if (!change) {
    return (
      <span className="inline-flex items-center gap-1.5 text-2xs text-gray-400 mt-2">
        <Clock className="w-3 h-3" />
        لم يتم تسجيل أي تغيير على الحالة بعد
      </span>
    );
  }

  const isDriver = change.changed_by_role === "delivery_driver";
  const Icon = isDriver ? Truck : change.changed_by_admin_id ? ShieldCheck : Clock;
  const colorClass = isDriver
    ? "bg-sky-50 text-sky-700 border-sky-200"
    : change.changed_by_admin_id
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-gray-50 text-gray-600 border-gray-200";
  const roleLabel = isDriver
    ? "مندوب توصيل"
    : change.changed_by_role === "super_admin"
      ? "مدير النظام"
      : change.changed_by_role === "editor"
        ? "موظف"
        : change.changed_by_role === "viewer"
          ? "مراقب"
          : "النظام";

  const actorName =
    change.changed_by_name ||
    (change.changed_by_legacy === "driver" ? "مندوب التوصيل" : null) ||
    "النظام";

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-2xs mt-2 px-2.5 py-1 rounded-full border ${colorClass}`}
    >
      <Icon className="w-3 h-3" />
      <span className="font-semibold">آخر تحديث:</span>
      <span>{actorName}</span>
      <span className="opacity-60">•</span>
      <span>{roleLabel}</span>
      <span className="opacity-60">•</span>
      <time
        dateTime={change.created_at}
        title={new Date(change.created_at).toLocaleString("ar-SA")}
      >
        {new Date(change.created_at).toLocaleString("ar-SA", {
          dateStyle: "short",
          timeStyle: "short",
        })}
      </time>
    </span>
  );
}

export default function AdminOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [internalNotes, setInternalNotes] = useState("");
  const [status, setStatus] = useState("");
  // Who flipped the status last, and when. Null when no transition has
  // been logged yet (e.g. brand-new order that hasn't moved off 'pending'
  // after the seed insert).
  const [lastStatusChange, setLastStatusChange] = useState<{
    old_status: string | null;
    new_status: string;
    created_at: string;
    changed_by_admin_id: string | null;
    changed_by_name: string | null;
    changed_by_role: string | null;
    changed_by_legacy: string | null;
  } | null>(null);
  // Abandoned-cart snapshot attached to this order (if any). Drives the
  // "أُنشئت من سلة متروكة" badge in the header. Recovery state is
  // independent of this order's own status — both 'abandoned' (the
  // customer never paid THIS one) and 'recovered' (they paid a later
  // order instead) are surfaces admins want to see.
  const [abandonedSnapshot, setAbandonedSnapshot] = useState<{
    id: string;
    status: string;
    items_count: number;
    subtotal: number;
    recovered_order_id: string | null;
  } | null>(null);
  // Audit 2026-09-30 (Finding 8.3): render the slot_window's Arabic
  // label ("صباحاً" not "morning"). Loaded lazily so the detail page
  // doesn't refetch when the list page already has the same data.
  const [slotLabels, setSlotLabels] = useState<Record<string, string>>({});
  const { showToast } = useToast();

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/v1/delivery/slots", { credentials: "include", signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (ac.signal.aborted) return;
        const slots = Array.isArray(j?.slots) ? j.slots : [];
        const map: Record<string, string> = {};
        for (const s of slots) {
          const id = String(s?.id ?? "");
          const label = String(s?.label_ar ?? s?.label ?? "");
          if (id && label) map[id] = label;
        }
        setSlotLabels(map);
      })
      .catch(() => {
        /* leave map empty — fall back to raw id */
      });
    return () => ac.abort();
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!id) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/orders?id=${encodeURIComponent(id)}`, {
          credentials: "include",
          signal,
        });
        const json = await res.json();
        if (signal?.aborted) return;
        if (!res.ok || !json.success || !json.order) {
          router.replace("/admin/orders");
          return;
        }
        setOrder(json.order as Record<string, unknown>);
        setItems(Array.isArray(json.items) ? json.items : []);
        setInternalNotes(String(json.order.internal_notes ?? ""));
        setStatus(String(json.order.status ?? ""));
        setLastStatusChange(json.last_status_change ?? null);

        // Best-effort: look up any abandoned-cart snapshot tied to this
        // order's intent_order_id. The list endpoint returns rows for the
        // whole set — we filter client-side. A failure here should never
        // blank out the order itself.
        try {
          const acRes = await fetch(
            `/api/admin/abandoned-carts?limit=100`,
            { credentials: "include", signal },
          );
          const acJson = await acRes.json().catch(() => ({ success: false, data: [] }));
          if (!signal?.aborted && acJson?.success && Array.isArray(acJson.data)) {
            const match = acJson.data.find(
              (r: { intent_order_id: string | null }) =>
                r.intent_order_id && String(r.intent_order_id) === id,
            );
            setAbandonedSnapshot(
              match
                ? {
                    id: String(match.id),
                    status: String(match.status),
                    items_count: Number(match.items_count ?? 0),
                    subtotal: Number(match.subtotal ?? 0),
                    recovered_order_id:
                      match.recovered_order_id != null
                        ? String(match.recovered_order_id)
                        : null,
                  }
                : null,
            );
          }
        } catch {
          /* abandoned-carts lookup is optional */
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          router.replace("/admin/orders");
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [id, router]
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const handleSaveNotes = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const res = await csrfFetch(`/api/admin/orders?id=${encodeURIComponent(id)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internal_notes: internalNotes }),
      });
      const json = await res.json().catch(() => ({ success: false }));
      if (!res.ok || !json.success) {
        showToast(json.error || "فشل حفظ الملاحظات", "error");
        return;
      }
      showToast("تم حفظ الملاحظات", "success");
      await load();
    } catch {
      showToast("تعذر الاتصال بالخادم", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveStatus = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const res = await csrfFetch(`/api/admin/orders?id=${encodeURIComponent(id)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json().catch(() => ({ success: false }));
      if (!res.ok || !json.success) {
        showToast(json.error || "فشل حفظ الحالة", "error");
        return;
      }
      showToast("تم حفظ الحالة", "success");
      await load();
    } catch {
      showToast("تعذر الاتصال بالخادم", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !order) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-sm text-gray-500">جاري تحميل تفاصيل الطلب...</p>
      </div>
    );
  }

  const coords = parseCoords(order.address_lat, order.address_lng);
  const addressLine = buildAddressLine(order);
  const phone = String(order.user_phone ?? order.guest_phone ?? "");
  const customer = String(order.user_name ?? order.guest_name ?? "—");
  const paymentMethod = String(order.payment_method ?? "");
  const paymentStatus = String(order.payment_status ?? "");
  const statusLabel =
    STATUS_OPTIONS.find((s) => s.value === String(order.status))?.label ||
    String(order.status);

  const statusConfig = getOrderStatusConfig(String(order.status));
  const StatusIcon = statusConfig.icon;
  const paymentConfig = getPaymentStatusConfig(paymentStatus);
  const currentStatus = String(order.status ?? "");
  const currentStepIndex = CUSTOMER_PROGRESS_STEPS.findIndex(
    (s) => s.status === currentStatus
  );

  const whatsappMessage = buildOrderPreparingWhatsAppMessage({
    customerName: customer !== "—" ? customer : undefined,
    orderId: order.id as string | number,
  });
  const whatsappUrl = phone ? buildWhatsAppUrl(phone, whatsappMessage) : null;

  const subtotal = Number(order.subtotal ?? 0);
  const deliveryFee = Number(order.delivery_fee ?? 0);
  const serviceFee = Number(order.service_fee ?? 0);
  const discount = Number(order.discount ?? 0);
  const total = Number(order.total ?? 0);

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin/orders"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1 mb-2"
          >
            <ArrowRight className="w-4 h-4 rotate-180" />
            العودة للطلبات
          </Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-secondary">
              طلب #{formatOrderId(order.id as string | number)}
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${statusConfig.color}`}
            >
              <StatusIcon className="w-3.5 h-3.5" />
              {statusLabel}
            </span>
            {/* Inline status editor — top of page, the primary place
                admins flip status from. Options are filtered through the
                centralized state machine (admin role). */}
            <div className="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-2 py-1">
              <RefreshCw className="w-3.5 h-3.5 text-primary" />
              <select
                aria-label="تغيير حالة الطلب"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="bg-transparent text-sm font-medium text-secondary focus:outline-none cursor-pointer"
              >
                {STATUS_OPTIONS.map((s) => {
                  const reachable = canTransition(
                    "admin",
                    "orders",
                    String(order.status ?? ""),
                    s.value,
                  );
                  const isCurrent = s.value === String(order.status);
                  return (
                    <option
                      key={s.value}
                      value={s.value}
                      disabled={!reachable && !isCurrent}
                    >
                      {s.label}
                      {!reachable && !isCurrent ? " (غير مسموح)" : ""}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={() => void handleSaveStatus()}
                disabled={saving || status === String(order.status)}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                حفظ
              </button>
            </div>
            {abandonedSnapshot ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                <ShoppingCart className="w-3.5 h-3.5" />
                {abandonedSnapshot.status === "recovered"
                  ? "سلة متروكة سابقاً ← مُستردة"
                  : "أُنشئت من سلة متروكة"}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            <Clock className="w-3.5 h-3.5 inline-block ml-1 -mt-0.5" />
            {order.created_at
              ? new Date(String(order.created_at)).toLocaleString("ar-SA", {
                  dateStyle: "full",
                  timeStyle: "short",
                })
              : "—"}
          </p>
          <LastStatusChangeBadge change={lastStatusChange} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <InvoiceActions
            orderId={String(order.id)}
            orderNumber={String(order.id)}
            createdAt={String(order.created_at ?? "")}
            status={statusLabel}
            paymentMethod={paymentMethod}
            paymentStatus={paymentStatus}
            customerName={customer}
            customerPhone={phone || null}
            address={{
              label: (order.address_label as string | null) ?? null,
              text: addressLine || null,
              city: (order.address_city as string | null) ?? null,
              district: (order.address_district as string | null) ?? null,
            }}
            items={items.map((it) => ({
              name: String(it.name_ar ?? "منتج"),
              quantity: Number(it.quantity ?? 1),
              unit_price: Number(it.price ?? 0),
            }))}
            subtotal={subtotal}
            deliveryFee={deliveryFee}
            serviceFee={serviceFee}
            tax={Number(order.tax ?? 0)}
            discount={discount}
            total={total}
            variant="admin"
          />
          {whatsappUrl ? (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="إرسال رسالة واتساب للعميل"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors shadow-sm"
            >
              <WhatsAppIcon className="w-4 h-4 shrink-0" />
              مراسلة العميل
            </a>
          ) : null}
          {phone ? (
            <a
              href={`tel:${phone}`}
              dir="ltr"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Phone className="w-4 h-4" />
              {phone}
            </a>
          ) : null}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Left column: status + customer + location + items + notes */}
        <div className="lg:col-span-2 space-y-5">
          {/* Status Timeline — Phase 2 / P2 shared component. compact variant
              so we can keep our own card chrome (matches surrounding panels).
              LastStatusChangeBadge in the header still shows the at-a-glance
              "who flipped it last" pill; this is the full history. */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-secondary flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-primary" />
                مسار الطلب
              </h2>
              {currentStepIndex >= 0 && (
                <span className="text-xs text-gray-500">
                  الخطوة {currentStepIndex + 1} من {CUSTOMER_PROGRESS_STEPS.length}
                </span>
              )}
            </div>
            <OrderTimeline currentStatus={currentStatus} orderId={id} variant="compact" />
          </div>

          {/* Items */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-secondary flex items-center gap-2">
                <Package className="w-4 h-4 text-primary" />
                بنود الطلب
              </h2>
              <span className="text-xs text-gray-500">
                {items.length} منتج
              </span>
            </div>
            <div className="divide-y divide-gray-100">
              {items.map((line) => {
                const qty = Number(line.quantity ?? 1);
                const price = Number(line.price ?? 0);
                return (
                  <div
                    key={String(line.id)}
                    className="py-3 flex items-center gap-3 text-sm"
                  >
                    <OrderItemThumb
                      src={(line.image_url as string | null) ?? null}
                      alt={String(line.name_ar ?? "منتج")}
                      className="w-14 h-14 rounded-xl bg-gray-50 border border-gray-100 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-secondary truncate">
                        {String(line.name_ar ?? "منتج")}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatPrice(price)} × {qty}
                      </p>
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-primary">
                        {formatPrice(price * qty)}
                      </p>
                    </div>
                  </div>
                );
              })}
              {items.length === 0 ? (
                <div className="py-6 text-center text-sm text-gray-400">
                  لا توجد بنود مسجّلة لهذا الطلب
                </div>
              ) : null}
            </div>
          </div>

          {/* Location */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <h2 className="font-bold text-secondary flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-primary" />
              موقع التوصيل
            </h2>

            {addressLine ? (
              <div className="bg-gray-50 rounded-xl p-3 mb-3">
                <p className="text-sm font-medium leading-relaxed text-secondary">
                  {addressLine}
                </p>
                {order.address_label ? (
                  <p className="text-xs text-gray-500 mt-1">
                    تسمية: {String(order.address_label)}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-gray-500 mb-3">لا يوجد عنوان محفوظ</p>
            )}

            {order.address_description ? (
              <p className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
                <MessageSquare className="w-3.5 h-3.5 inline-block ml-1" />
                {String(order.address_description)}
              </p>
            ) : null}

            {Array.isArray(order.address_place_images) &&
            (order.address_place_images as string[]).length > 0 ? (
              <div className="mb-3">
                <p className="text-sm text-gray-500 mb-2 flex items-center gap-1">
                  <Camera className="w-3.5 h-3.5" />
                  صور المكان (
                  {(order.address_place_images as string[]).length})
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {(order.address_place_images as string[]).map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 hover:border-primary group"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt="صورة المكان"
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            {coords ? (
              <>
                <p className="text-xs text-gray-500 mb-2" dir="ltr">
                  الإحداثيات: {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  <a
                    href={googleMapsDirectionsUrl(coords.lat, coords.lng)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
                  >
                    <Navigation className="w-4 h-4" />
                    الاتجاهات إلى العميل
                  </a>
                  <a
                    href={googleMapsPlaceUrl(coords.lat, coords.lng)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-secondary rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    فتح في خرائط جوجل
                  </a>
                </div>
                <div className="rounded-xl overflow-hidden border border-gray-200 aspect-[16/10] w-full">
                  <iframe
                    title="موقع العميل"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
                      `${coords.lng - 0.008},${coords.lat - 0.008},${coords.lng + 0.008},${coords.lat + 0.008}`
                    )}&layer=mapnik&marker=${coords.lat}%2C${coords.lng}`}
                    className="w-full h-full min-h-[240px] border-0"
                    loading="lazy"
                  />
                </div>
              </>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  لم يُسجَّل موقع GPS لهذا الطلب. راجع نص العنوان أو اطلب من العميل تحديث العنوان من الخريطة.
                </span>
              </div>
            )}
          </div>

          {/* Customer Notes */}
          {order.notes ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-sm">
              <p className="font-semibold text-amber-900 mb-1 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                ملاحظات العميل
              </p>
              <p className="text-sm text-amber-800">{String(order.notes)}</p>
            </div>
          ) : null}
        </div>

        {/* Right column: read-only status badge + payment + customer + notes */}
        <div className="space-y-5">
          {/* Status (read-only — the inline editor at the top is the
              primary control). Last change info + the OrderTimeline
              below give the full status history. */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <h2 className="font-bold text-secondary flex items-center gap-2 mb-3">
              <RefreshCw className="w-4 h-4 text-primary" />
              حالة الطلب
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${statusConfig.color}`}
            >
              <StatusIcon className="w-3.5 h-3.5" />
              {statusLabel}
            </span>
            <p className="text-xs text-gray-500 mt-3">
              غيّر الحالة من شريط الأدوات أعلى الصفحة. التغييرات تُسجَّل
              في سجل الطلب.
            </p>
            <LastStatusChangeBadge change={lastStatusChange} />
          </div>

          {/* Scheduled delivery window (Phase D, 2026-09-30) — only
              renders when the order was created with
              `scheduled=true`. The date/time + slot window come straight
              from `orders` so the admin can confirm the customer will
              be expecting the order at the right time. */}
          {order.scheduled && order.scheduled_for ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 shadow-sm">
              <h2 className="font-bold text-amber-900 flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4 text-amber-700" />
                موعد التوصيل المجدول
              </h2>
              <div className="space-y-2 text-sm">
                <SummaryRow
                  label="التاريخ والوقت"
                  value={new Date(String(order.scheduled_for)).toLocaleString("ar-SA", {
                    dateStyle: "full",
                    timeStyle: "short",
                  })}
                />
                {order.slot_window ? (
                  <SummaryRow
                    label="فترة التوصيل"
                    value={
                      slotLabels[String(order.slot_window)] ??
                      String(order.slot_window)
                    }
                  />
                ) : null}
              </div>
              <p className="text-xs text-amber-700 mt-3 pt-3 border-t border-amber-200">
                تأكَّد من تجهيز الطلب قبل بداية الفترة المجدولة حتى لا
                يتأخر عن العميل.
              </p>
            </div>
          ) : null}

          {/* Payment Summary */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <h2 className="font-bold text-secondary flex items-center gap-2 mb-4">
              <Receipt className="w-4 h-4 text-primary" />
              ملخص الطلب
            </h2>
            <div className="space-y-2.5 text-sm">
              <SummaryRow label="طريقة الدفع" value={PAYMENT_METHOD_AR[paymentMethod] || paymentMethod || "—"} />
              <SummaryRow
                label="حالة الدفع"
                value={
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${paymentConfig.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${paymentConfig.dotColor}`} />
                    {paymentConfig.label}
                  </span>
                }
              />
              <div className="border-t border-gray-100 my-2" />
              <SummaryRow label="المجموع الفرعي" value={formatPrice(subtotal)} />
              {discount > 0 ? (
                <SummaryRow label="الخصم" value={`-${formatPrice(discount)}`} valueClass="text-emerald-600" />
              ) : null}
              <SummaryRow label="رسوم التوصيل" value={formatPrice(deliveryFee)} />
              <SummaryRow label="رسوم الخدمة" value={formatPrice(serviceFee)} />
              <div className="border-t border-gray-100 my-2" />
              <div className="flex items-center justify-between">
                <span className="font-bold text-secondary">الإجمالي</span>
                <span className="font-bold text-lg text-primary">{formatPrice(total)}</span>
              </div>
            </div>
            {order.payment_reference ? (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-500 mb-1">مرجع الدفع</p>
                <p className="text-xs font-mono text-secondary bg-gray-50 rounded-lg px-2 py-1.5 break-all" dir="ltr">
                  {String(order.payment_reference)}
                </p>
              </div>
            ) : null}
          </div>

          {/* Customer Card */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <h2 className="font-bold text-secondary flex items-center gap-2 mb-4">
              <User className="w-4 h-4 text-primary" />
              بيانات العميل
            </h2>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">الاسم</p>
                <p className="font-medium text-secondary">{customer}</p>
              </div>
              {phone ? (
                <div>
                  <p className="text-xs text-gray-500 mb-1">رقم الجوال</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`tel:${phone}`}
                      dir="ltr"
                      className="font-medium text-primary inline-flex items-center gap-1"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      {phone}
                    </a>
                    {whatsappUrl ? (
                      <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-dark transition-colors"
                      >
                        <WhatsAppIcon className="w-3 h-3" />
                        واتساب
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400">لا يوجد رقم جوال</p>
              )}
              {order.user_email ? (
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">البريد الإلكتروني</p>
                  <p className="text-sm font-medium text-secondary" dir="ltr">
                    {String(order.user_email)}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {/* Internal Notes */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <h2 className="font-bold text-secondary flex items-center gap-2 mb-3">
              <StickyNote className="w-4 h-4 text-primary" />
              ملاحظات داخلية
              <span className="text-tiny text-gray-400 font-normal mr-1">(للفريق فقط)</span>
            </h2>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={5}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary focus:bg-white resize-none"
              placeholder="ملاحظات لا تظهر للعميل..."
            />
            <button
              type="button"
              onClick={() => void handleSaveNotes()}
              disabled={saving}
              className="w-full mt-3 h-10 bg-secondary text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-secondary/90 transition-colors flex items-center justify-center gap-2"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              حفظ الملاحظات
            </button>
          </div>

          {/* Order metadata */}
          <div className="bg-gray-50 rounded-2xl p-4 text-xs space-y-1.5">
            <p className="font-semibold text-secondary flex items-center gap-1.5 mb-2">
              <CreditCard className="w-3.5 h-3.5" />
              معلومات النظام
            </p>
            <p className="flex justify-between">
              <span className="text-gray-500">رقم الطلب:</span>
              <span className="font-mono font-medium text-secondary" dir="ltr">
                #{formatOrderId(order.id as string | number)}
              </span>
            </p>
            {order.tracking_code ? (
              <p className="flex justify-between">
                <span className="text-gray-500">رمز التتبع:</span>
                <span className="font-mono font-medium text-secondary" dir="ltr">
                  {String(order.tracking_code)}
                </span>
              </p>
            ) : null}
            {order.idempotency_key ? (
              <p className="flex justify-between">
                <span className="text-gray-500">معرّف الجلسة:</span>
                <span className="font-mono text-secondary truncate ml-2" dir="ltr">
                  {String(order.idempotency_key).slice(0, 12)}…
                </span>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  valueClass = "text-secondary",
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className={`font-medium text-sm ${valueClass}`}>{value}</span>
    </div>
  );
}