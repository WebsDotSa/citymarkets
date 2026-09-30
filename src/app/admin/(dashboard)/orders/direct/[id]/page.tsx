'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BRAND } from '@/lib/brand-theme';
import { ChatPanel } from '@/components/ui/chat-panel/chat-panel';
import {
  ChevronLeft,
  MapPin,
  Loader2,
  AlertTriangle,
  Save,
  Phone,
  User,
  Clock,
  Plus,
  X,
} from 'lucide-react';
import { InvoiceActions } from '@/components/orders/invoice-actions';
import { getOrderStatusConfig, ORDER_STATUS_DISPLAY } from '@/lib/orders';
import type {
  AdminDirectOrder,
  AdminDirectOrderItem,
} from '@/lib/admin-types';

type OrderDetail = AdminDirectOrder;
type Item = AdminDirectOrderItem;

// Canonical `order_status_enum` options. The previous local list offered
// `accepted` / `in_progress`, which `orderEditSchema` rejects (400).
const STATUS_OPTIONS = ORDER_STATUS_DISPLAY;

export default async function AdminDirectOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: orderId } = await params;
  return <AdminDirectOrderDetail orderId={orderId} />;
}

function AdminDirectOrderDetail({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [internalNotes, setInternalNotes] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [finalSubtotal, setFinalSubtotal] = useState('');
  const [finalDelivery, setFinalDelivery] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const [newItemQty, setNewItemQty] = useState(1);
  const [newItemUnitPrice, setNewItemUnitPrice] = useState('');
  const [adding, setAdding] = useState(false);

  async function fetchOrder() {
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setOrder(data.order);
        setItems(data.items || []);
        setInternalNotes(data.order.internal_notes || '');
        setStatus(data.order.status);
        setFinalSubtotal(String(data.order.subtotal ?? 0));
        setFinalDelivery(String(data.order.delivery_fee ?? 0));
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    fetchOrder();
    const t = setInterval(fetchOrder, 15000);
    return () => clearInterval(t);
  }, [orderId]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const itemUpdates = Object.entries(priceEdits)
        .filter(([, v]) => v !== '')
        .map(([itemId, v]) => ({
          itemId,
          resolved_price: parseFloat(v) || 0,
        }));
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          internal_notes: internalNotes,
          final_subtotal: parseFloat(finalSubtotal) || 0,
          final_delivery_fee: parseFloat(finalDelivery) || 0,
          items: itemUpdates,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'فشل الحفظ');
      setPriceEdits({});
      await fetchOrder();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addItem() {
    if (!newItemText.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const unitPrice = parseFloat(newItemUnitPrice);
      const body: Record<string, unknown> = {
        free_text: newItemText.trim(),
        quantity: newItemQty,
      };
      if (!isNaN(unitPrice) && unitPrice >= 0) body.unit_price = unitPrice;
      const res = await fetch(`/api/admin/orders/${orderId}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'فشل الإضافة');
      setNewItemText('');
      setNewItemQty(1);
      setNewItemUnitPrice('');
      setAddingItem(false);
      await fetchOrder();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: BRAND.brandGreen }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8" dir="rtl">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6 flex-wrap justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="p-1" aria-label="رجوع">
              <ChevronLeft className="w-6 h-6" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">طلب مباشر #{order.order_number || order.id}</h1>
              <p className="text-sm text-gray-500">
                {new Date(order.created_at).toLocaleString('ar-SA')}
              </p>
            </div>
          </div>
          <InvoiceActions
            orderId={order.id}
            orderNumber={order.order_number || order.id}
            createdAt={order.created_at}
            status={getOrderStatusConfig(order.status).label}
            paymentMethod={order.payment_method}
            paymentStatus={order.payment_status}
            customerName={order.user_name || order.guest_name || 'عميل'}
            customerPhone={order.user_phone || order.guest_phone || null}
            address={{
              label: order.address_label ?? null,
              text: order.address_text ?? null,
              city: order.city ?? null,
              district: order.district ?? null,
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
            variant="admin"
          />
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Left: Order management */}
          <div className="lg:col-span-2 space-y-4">
            {/* Status + actions */}
            <div className="bg-white rounded-xl p-4 border border-gray-200">
              <h2 className="font-bold text-gray-900 mb-3">إجراءات سريعة</h2>
              <div className="flex gap-2 items-center mb-3">
                <label className="text-sm font-semibold w-24">الحالة:</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={save}
                disabled={saving}
                className="w-full text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: BRAND.brandGreen }}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                حفظ التغييرات
              </button>
              {error && (
                <div className="text-red-600 text-sm mt-2 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" /> {error}
                </div>
              )}
            </div>

            {/* Customer */}
            <div className="bg-white rounded-xl p-4 border border-gray-200">
              <h2 className="font-bold text-gray-900 mb-2">العميل</h2>
              <div className="text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-400" />
                  {order.user_name || order.guest_name || 'عميل'}
                </div>
                {(order.user_phone || order.guest_phone) && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-gray-400" />
                    <a
                      href={`tel:${order.user_phone || order.guest_phone}`}
                      className="text-green-700"
                    >
                      {order.user_phone || order.guest_phone}
                    </a>
                  </div>
                )}
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 mt-0.5 text-gray-400" />
                  <div>
                    {order.address_label && <div className="font-bold">{order.address_label}</div>}
                    {order.address_text && <div className="text-gray-600">{order.address_text}</div>}
                  </div>
                </div>
              </div>
            </div>

            {/* Items + price reconciliation */}
            <div className="bg-white rounded-xl p-4 border border-gray-200">
              <h2 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5" style={{ color: BRAND.brandGreen }} />
                تأكيد الأسعار
              </h2>
              <div className="space-y-3">
                {items.map((it) => (
                  <div key={it.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                    {it.image_url && (
                      <img src={it.image_url} alt="" className="w-14 h-14 rounded object-cover" />
                    )}
                    <div className="flex-1">
                      <div className="font-semibold text-sm">{it.name_ar || it.free_text}</div>
                      <div className="text-xs text-gray-500">الكمية: {it.quantity}</div>
                      {it.resolved_price !== null && it.resolved_price !== undefined && (
                        <div className="text-xs text-green-700 mt-1">
                          ✓ تم التأكيد: {it.resolved_price.toFixed(2)} ر.س
                        </div>
                      )}
                    </div>
                    <div className="w-28">
                      <label className="text-[10px] text-gray-500">السعر النهائي</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder={it.price ? String(it.price) : '0.00'}
                        value={priceEdits[it.id] ?? (it.resolved_price ? String(it.resolved_price) : '')}
                        onChange={(e) =>
                          setPriceEdits((p) => ({ ...p, [it.id]: e.target.value }))
                        }
                        className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm"
                      />
                    </div>
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="text-sm text-gray-500 text-center py-4">
                    العميل لم يضف منتجات بعد
                  </div>
                )}
              </div>

              {/* Admin: add a new item directly into this order.
                  Mirrors the customer-side inline form so the panel
                  stays visually consistent across both surfaces. */}
              {!['delivered', 'cancelled'].includes(order.status) && (
                <div className="mt-3">
                  {addingItem ? (
                    <div className="p-3 rounded-lg border border-green-300 bg-green-50">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="عنصر جديد (مثال: كيلو سكر)"
                          value={newItemText}
                          onChange={(e) => setNewItemText(e.target.value)}
                          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        />
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={newItemQty}
                          onChange={(e) => setNewItemQty(parseInt(e.target.value, 10) || 1)}
                          className="w-16 border border-gray-200 rounded-lg px-2 py-2 text-center text-sm"
                          aria-label="الكمية"
                        />
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          placeholder="السعر"
                          value={newItemUnitPrice}
                          onChange={(e) => setNewItemUnitPrice(e.target.value)}
                          className="w-24 border border-gray-200 rounded-lg px-2 py-2 text-center text-sm"
                          aria-label="السعر"
                        />
                      </div>
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={addItem}
                          disabled={adding}
                          className="flex-1 text-white font-bold py-2 rounded-lg flex items-center justify-center gap-1 disabled:opacity-50"
                          style={{ backgroundColor: BRAND.brandGreen }}
                        >
                          {adding ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Plus className="w-4 h-4" />
                          )}
                          إضافة
                        </button>
                        <button
                          onClick={() => {
                            setAddingItem(false);
                            setNewItemText('');
                            setNewItemQty(1);
                            setNewItemUnitPrice('');
                          }}
                          className="flex-1 bg-gray-100 font-bold py-2 rounded-lg"
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingItem(true)}
                      className="w-full text-sm font-bold py-2 rounded-lg border border-dashed flex items-center justify-center gap-1"
                      style={{ borderColor: BRAND.brandGreen, color: BRAND.brandGreen }}
                    >
                      <Plus className="w-4 h-4" /> أضف منتجاً للطلب
                    </button>
                  )}
                </div>
              )}

              {/* Final totals */}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">المجموع الفرعي</label>
                  <input
                    type="number"
                    step="0.01"
                    value={finalSubtotal}
                    onChange={(e) => setFinalSubtotal(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">رسوم التوصيل</label>
                  <input
                    type="number"
                    step="0.01"
                    value={finalDelivery}
                    onChange={(e) => setFinalDelivery(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="mt-3 p-3 rounded-lg bg-green-50 text-sm">
                <div className="flex justify-between"><span>المجموع الفرعي:</span><span>{(parseFloat(finalSubtotal) || 0).toFixed(2)} ر.س</span></div>
                <div className="flex justify-between"><span>رسوم التوصيل:</span><span>{(parseFloat(finalDelivery) || 0).toFixed(2)} ر.س</span></div>
                <div className="flex justify-between"><span>رسوم الخدمة:</span><span>{order.service_fee.toFixed(2)} ر.س</span></div>
                <div className="flex justify-between"><span>الضريبة:</span><span>{order.tax.toFixed(2)} ر.س</span></div>
                <hr className="my-2 border-green-200" />
                <div className="flex justify-between font-bold">
                  <span>الإجمالي:</span>
                  <span>
                    {(
                      (parseFloat(finalSubtotal) || 0) +
                      (parseFloat(finalDelivery) || 0) +
                      order.service_fee +
                      order.tax
                    ).toFixed(2)} ر.س
                  </span>
                </div>
              </div>
            </div>

            {/* Internal notes */}
            <div className="bg-white rounded-xl p-4 border border-gray-200">
              <h2 className="font-bold text-gray-900 mb-2">ملاحظات داخلية</h2>
              <textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="ملاحظات لا تظهر للعميل..."
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
              {order.notes && (
                <div className="mt-3">
                  <div className="text-xs text-gray-500 mb-1">ملاحظات العميل:</div>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm">{order.notes}</div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Chat */}
          <div className="lg:col-span-1">
            <div className="sticky top-4 h-[600px]">
              <ChatPanel
                orderId={orderId}
                perspective="admin"
                pollMs={5000}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}