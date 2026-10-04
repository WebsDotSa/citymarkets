'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BRAND } from '@/lib/brand-theme';
import { useStatusColorVars } from '@/hooks/use-color-vars';
import { ChatPanel } from '@/components/ui/chat-panel/chat-panel';
import { InvoiceActions } from '@/components/orders/invoice-actions';
import { getOrderStatusConfig } from '@/lib/orders';
import {
  ChevronLeft,
  MapPin,
  Package,
  Plus,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import {
  useOrderPolling,
  addOrderItem,
  removeOrderItem,
  type OrderDetail,
  type OrderItem,
} from './shared';

// Status label + hex are sourced from `getOrderStatusConfig()` (canonical
// state machine at `@/lib/orders/state-machine`). Inline fallback
// `#6B7280` (gray-500) is used when the API returns an unknown status.
//
// Polling + types + add/remove helpers live in `./shared.ts` so the
// companion `/orders/direct/[id]/chat` page can share them. The detail
// page used to be a near-duplicate of the chat page; both were unified
// in P3-3 (audit 2026-09-29).

export function OrderDetailClient({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [addingItem, setAddingItem] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const [newItemQty, setNewItemQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);

  // The shared hook drives the poll loop. We pipe `onFetched` to grab
  // the chat-unread counter that lives alongside the order payload.
  const onFetched = useCallback((data: { raw: unknown }) => {
    const raw = data.raw as { chat?: { unread?: number } } | undefined;
    if (raw && typeof raw.chat?.unread === 'number') {
      setChatUnread(raw.chat.unread);
    }
  }, []);
  const {
    order,
    items,
    loading,
    error,
    setError,
    refetch: fetchOrder,
  } = useOrderPolling(orderId, { intervalMs: 12000, onFetched });

  async function addItem() {
    if (!newItemText.trim()) return;
    setAdding(true);
    try {
      const result = await addOrderItem({
        orderId,
        freeText: newItemText.trim(),
        quantity: newItemQty,
      });
      if (!result.success) throw new Error(result.error || 'فشل الإضافة');
      setNewItemText('');
      setNewItemQty(1);
      setAddingItem(false);
      await fetchOrder();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function removeItem(itemId: string) {
    if (!confirm('حذف هذا العنصر؟')) return;
    const result = await removeOrderItem({ orderId, itemId });
    if (!result.success) {
      setError(result.error || 'فشل الحذف');
      return;
    }
    await fetchOrder();
  }

  const isDirect = order?.type === 'direct';
  const isLocked = Boolean(order && ['on_the_way', 'delivered', 'cancelled'].includes(order.status));
  const statusConfig = order ? getOrderStatusConfig(order.status) : null;
  const statusColor = statusConfig?.hex ?? '#6B7280';
  const statusColorVars = useStatusColorVars(statusColor);
  const statusLabel = statusConfig?.label ?? '';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: BRAND.brandGreen }} />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4" dir="rtl">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <p className="text-red-600">{error || 'الطلب غير موجود'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-32" dir="rtl" style={statusColorVars}>
      <div
        className="sticky top-0 z-10 text-white px-4 py-3 flex items-center gap-3"
        style={{ backgroundColor: BRAND.brandGreen }}
      >
        <button onClick={() => router.back()} className="p-1" aria-label="رجوع">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <div className="font-bold">تتبع الطلب</div>
          <div className="text-xs opacity-90">#{order.orderNumber}</div>
        </div>
        {isDirect && chatUnread > 0 && (
          <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
            {chatUnread}
          </span>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {/* Invoice actions — print + download PDF. Hidden in print output
            via `print:hidden` on the buttons themselves. */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl p-3 border border-gray-200">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-700">فاتورة الطلب</span>
            <span className="text-xs text-gray-500" dir="ltr">
              #{order.orderNumber}
            </span>
          </div>
          <InvoiceActions
            orderId={order.id}
            orderNumber={order.orderNumber}
            createdAt={order.created_at}
            status={getOrderStatusConfig(order.status).label}
            paymentMethod={order.payment_method}
            paymentStatus={order.payment_status}
            customerName={order.customer_name || 'عميل'}
            customerPhone={order.customer_phone}
            address={{
              label: order.address.label,
              text: order.address.text,
              city: order.address.city,
              district: order.address.district,
            }}
            items={items.map((it) => ({
              name: it.name_ar || it.free_text || 'عنصر',
              quantity: it.quantity,
              unit_price: it.unit_price,
              notes: it.notes,
            }))}
            subtotal={order.subtotal}
            deliveryFee={order.delivery_fee}
            serviceFee={order.service_fee}
            tax={order.tax}
            discount={order.discount}
            total={order.total}
            variant="customer"
          />
        </div>

        {/* Status */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5" style={{ color: 'var(--status-color)' }} />
              <span className="font-bold text-gray-900">{statusLabel}</span>
            </div>
            <span
              className="text-xs px-2.5 py-1 rounded-full font-bold"
              style={{ backgroundColor: 'var(--status-bg)', color: 'var(--status-color)' }}
            >
              {isDirect ? 'طلب مباشر' : 'كتالوج'}
            </span>
          </div>
          {order.scheduled && order.scheduled_for && (
            <div className="text-xs text-gray-500 mt-2">
              مجدول: {new Date(order.scheduled_for).toLocaleString('ar-SA')} — {order.slot_window}
            </div>
          )}
        </div>

        {/* Items */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-900 flex items-center gap-2">
              <Package className="w-5 h-5" style={{ color: BRAND.brandGreen }} />
              تفاصيل الطلب
            </h2>
            {isDirect && !isLocked && (
              <button
                onClick={() => setAddingItem(true)}
                className="text-sm font-semibold flex items-center gap-1"
                style={{ color: BRAND.brandGreen }}
              >
                <Plus className="w-4 h-4" /> أضف منتجاً
              </button>
            )}
          </div>

          <div className="space-y-2">
            {items.length === 0 && (
              <div className="text-sm text-gray-500 text-center py-4">
                {isDirect ? 'لم تضف منتجات بعد' : 'لا توجد منتجات'}
              </div>
            )}
            {items.map((it) => (
              <div key={it.id} className="flex items-start gap-3 p-2 rounded-xl bg-gray-50">
                {it.image_url && (
                  <img
                    src={it.image_url}
                    alt=""
                    className="w-14 h-14 rounded-lg object-cover"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">
                    {it.name_ar || it.free_text || 'عنصر'}
                  </div>
                  {it.free_text && it.name_ar && (
                    <div className="text-xs text-gray-500 mt-1">{it.free_text}</div>
                  )}
                  {it.notes && (
                    <div className="text-xs text-gray-500 mt-1">ملاحظة: {it.notes}</div>
                  )}
                  {it.resolved_price ? (
                    <div className="text-xs text-primary-700 mt-1">
                      ✓ تم التأكيد: {it.resolved_price.toFixed(2)} ر.س
                    </div>
                  ) : (
                    <div className="text-xs text-amber-700 mt-1">
                      ⏳ بانتظار تأكيد الإدارة
                    </div>
                  )}
                  <div className="text-xs text-gray-500 mt-1">الكمية: {it.quantity}</div>
                </div>
                {isDirect && !isLocked && (
                  <button
                    onClick={() => removeItem(it.id)}
                    className="p-1 text-red-500"
                    aria-label="حذف"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Add item inline */}
          {addingItem && (
            <div className="mt-3 p-3 rounded-xl border border-primary-300 bg-primary-50">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="أضف منتجاً (مثال: 3 كيلو بصل)"
                  value={newItemText}
                  onChange={(e) => setNewItemText(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={newItemQty}
                  onChange={(e) => setNewItemQty(parseInt(e.target.value, 10) || 1)}
                  className="w-16 border border-gray-200 rounded-xl px-2 py-2 text-center text-sm"
                />
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={addItem}
                  disabled={adding}
                  className="flex-1 text-white font-bold py-2 rounded-xl flex items-center justify-center gap-1 disabled:opacity-50"
                  style={{ backgroundColor: BRAND.brandGreen }}
                >
                  {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : 'تأكيد'}
                </button>
                <button
                  onClick={() => setAddingItem(false)}
                  className="flex-1 bg-gray-100 font-bold py-2 rounded-xl"
                >
                  إلغاء
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Pricing */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200">
          <h2 className="font-bold text-gray-900 mb-2">تفاصيل السعر</h2>
          <div className="space-y-1 text-sm">
            <Row label="المجموع الفرعي" value={order.subtotal} />
            <Row label="رسوم التوصيل" value={order.delivery_fee} />
            <Row label="رسوم الخدمة (مع الضريبة)" value={order.service_fee} highlight />
            <Row label="ضريبة القيمة المضافة 15%" value={order.tax} />
            {order.discount > 0 && (
              <Row label="الخصم" value={-order.discount} discount />
            )}
            <hr className="my-2 border-gray-100" />
            <Row label="المجموع" value={order.total} bold />
          </div>
        </div>

        {/* Voice note from customer (also reused as "voice from driver" on catalog) */}
        {order.voice_note_url && (
          <div className="bg-white rounded-2xl p-4 border border-gray-200">
            <h2 className="font-bold text-gray-900 mb-2">
              {isDirect ? 'رسالة صوتية منك' : 'رسالة صوتية'}
            </h2>
            <audio controls src={order.voice_note_url} className="w-full h-9" />
          </div>
        )}

        {/* Address */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-5 h-5" style={{ color: BRAND.brandGreen }} />
            <h2 className="font-bold text-gray-900">عنوان التوصيل</h2>
          </div>
          <div className="text-sm">
            <div className="font-bold">{order.address.label}</div>
            <div className="text-gray-600">{order.address.text}</div>
            {order.address.plus_code && (
              <div className="text-xs text-gray-400 mt-1">{order.address.plus_code}</div>
            )}
          </div>
          {order.address.place_images && order.address.place_images.length > 0 && (
            <div className="flex gap-2 mt-2 overflow-x-auto">
              {order.address.place_images.map((img, i) => (
                <img
                  key={i}
                  src={img}
                  alt=""
                  className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
                />
              ))}
            </div>
          )}
        </div>

        {/* Edit indicator */}
        {isDirect && order.direct_meta?.customer_edited && (
          <div className="flex items-center gap-2 text-xs text-gray-500 px-2">
            <CheckCircle2 className="w-3 h-3" />
            قمت بتعديل هذا الطلب
            {order.direct_meta.last_edited_at && (
              <span>
                — {new Date(order.direct_meta.last_edited_at).toLocaleString('ar-SA')}
              </span>
            )}
          </div>
        )}

        {/* Chat */}
        {isDirect && (
          <div className="h-[480px]">
            <ChatPanel
              orderId={orderId}
              perspective="customer"
              disabled={isLocked}
              disabledReason={
                order.status === 'delivered'
                  ? 'تم التوصيل — تم إغلاق المحادثة'
                  : order.status === 'cancelled'
                  ? 'الطلب ملغي'
                  : 'لا يمكن المراسلة'
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold, highlight, discount }: { label: string; value: number; bold?: boolean; highlight?: boolean; discount?: boolean }) {
  return (
    <div
      className={`flex justify-between ${bold ? 'font-bold text-base' : ''}`}
      style={{
        // Audit 2026-10-04 (Phase F): discount green unified on the
        // brand token (was Tailwind emerald-600 #16a34a — slightly
        // off the brand ramp). Now uses BRAND.primaryDark so every
        // "discount/savings" highlight in the customer UI matches the
        // single brand green.
        color: discount ? BRAND.primaryDark : highlight ? BRAND.primaryDark : '#111',
        fontWeight: highlight ? 600 : undefined,
      }}
    >
      <span>{label}</span>
      <span>{value.toFixed(2)} ر.س</span>
    </div>
  );
}