'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BRAND } from '@/lib/brand-theme';
import { getOrderStatusConfig } from '@/lib/orders';
import { ChatPanel } from '@/components/ui/chat-panel/chat-panel';
import {
  ChevronLeft,
  MapPin,
  Package,
  Plus,
  X,
  Loader2,
  AlertTriangle,
  Clock,
  Phone,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MessageCircle,
} from 'lucide-react';

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  type: 'catalog' | 'direct';
  subtotal: number;
  delivery_fee: number;
  service_fee: number;
  tax: number;
  total: number;
  payment_method: string;
  payment_status: string;
  notes?: string | null;
  created_at: string;
  voice_note_url?: string | null;
  voice_note_duration?: number | null;
  address: {
    label: string;
    text: string;
    plus_code?: string | null;
    city?: string | null;
    district?: string | null;
    place_images?: string[];
  };
}

interface OrderItem {
  id: string;
  product_id?: string | null;
  name_ar?: string | null;
  image_url?: string | null;
  free_text?: string | null;
  quantity: number;
  resolved_price?: number | null;
}

// Status label is sourced from `getOrderStatusConfig()` (canonical state
// machine at `@/lib/orders/state-machine`). The previous local map held
// stale keys (`accepted`, `in_progress`) that are NOT valid `orders.status`
// enum values — drifting out of sync with the central enum.

/**
 * Dedicated chat page for a direct order. Shows:
 *  - Live chat with admin/driver (ChatPanel)
 *  - Order summary card with status
 *  - Item list with add/remove + resolved-price indicators
 *  - Voice note from customer
 *  - Delivery address
 *
 * Designed to be the FIRST thing the customer sees after tapping
 * "تأكيد الطلب" on /orders/direct.
 */
export function DirectOrderChatPage({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [addingItem, setAddingItem] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const [newItemQty, setNewItemQty] = useState(1);
  const [adding, setAdding] = useState(false);

  async function fetchOrder() {
    try {
      const res = await fetch(`/api/v1/orders/${orderId}`, { credentials: 'include' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'فشل التحميل');
      setOrder(data.order);
      setItems(data.items || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOrder();
    const t = setInterval(fetchOrder, 15000);
    return () => clearInterval(t);
  }, [orderId]);

  async function addItem() {
    if (!newItemText.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/v1/orders/${orderId}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ free_text: newItemText.trim(), quantity: newItemQty }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'فشل الإضافة');
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
    try {
      await fetch(`/api/v1/orders/${orderId}/items?itemId=${itemId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      await fetchOrder();
    } catch (err) {
      setError((err as Error).message);
    }
  }

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
          <button
            onClick={() => router.push('/orders')}
            className="mt-4 px-6 py-2 rounded-xl text-white"
            style={{ backgroundColor: BRAND.brandGreen }}
          >
            طلباتي
          </button>
        </div>
      </div>
    );
  }

  const isLocked = ['delivered', 'cancelled'].includes(order.status);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" dir="rtl">
      {/* Header */}
      <div
        className="text-white px-4 py-3 flex items-center gap-3 flex-shrink-0 shadow-md"
        style={{ backgroundColor: BRAND.brandGreen }}
      >
        <button onClick={() => router.push('/orders')} className="p-1" aria-label="طلباتي">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-bold truncate">طلب مباشر #{order.orderNumber}</div>
          <div className="text-xs opacity-90 flex items-center gap-1">
            <MessageCircle className="w-3 h-3" />
            محادثة مباشرة مع الإدارة
          </div>
        </div>
        <span className="text-xs bg-white/20 px-2 py-1 rounded-full">
          {getOrderStatusConfig(order.status).label}
        </span>
      </div>

      {/* Order details collapsible */}
      <div className="bg-white border-b border-gray-200">
        <button
          onClick={() => setDetailsOpen(!detailsOpen)}
          className="w-full px-4 py-2.5 flex items-center justify-between text-sm font-bold"
        >
          <span className="flex items-center gap-2">
            <Package className="w-4 h-4" style={{ color: BRAND.brandGreen }} />
            تفاصيل الطلب
            <span className="text-xs font-normal text-gray-500">
              ({items.length} عناصر · {order.total.toFixed(2)} ر.س)
            </span>
          </span>
          {detailsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {detailsOpen && (
          <div className="px-4 pb-3 space-y-2 max-h-80 overflow-y-auto">
            {/* Address */}
            <div className="flex items-start gap-2 text-xs bg-gray-50 rounded-lg p-2">
              <MapPin className="w-3 h-3 mt-0.5 text-gray-400" />
              <div>
                <div className="font-bold">{order.address.label}</div>
                <div className="text-gray-600">{order.address.text}</div>
              </div>
            </div>

            {/* Items */}
            <div className="space-y-1.5">
              {items.length === 0 && (
                <div className="text-xs text-gray-500 text-center py-2">
                  لم تضف منتجات بعد
                </div>
              )}
              {items.map((it) => (
                <div key={it.id} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
                  {it.image_url && (
                    <img src={it.image_url} alt="" className="w-10 h-10 rounded object-cover" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold truncate">
                      {it.name_ar || it.free_text}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      ×{it.quantity}
                      {it.resolved_price ? (
                        <span className="text-green-700 mr-2">
                          · {it.resolved_price.toFixed(2)} ر.س ✓
                        </span>
                      ) : (
                        <span className="text-amber-700 mr-2">· بانتظار التأكيد</span>
                      )}
                    </div>
                  </div>
                  {!isLocked && (
                    <button
                      onClick={() => removeItem(it.id)}
                      className="text-red-500 p-1"
                      aria-label="حذف"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add item */}
            {!isLocked && (
              <>
                {addingItem ? (
                  <div className="p-2 border border-green-300 bg-green-50 rounded-lg">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="أضف منتجاً..."
                        value={newItemText}
                        onChange={(e) => setNewItemText(e.target.value)}
                        className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs"
                      />
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={newItemQty}
                        onChange={(e) => setNewItemQty(parseInt(e.target.value, 10) || 1)}
                        className="w-12 border border-gray-200 rounded px-1 py-1 text-center text-xs"
                      />
                    </div>
                    <div className="flex gap-2 mt-1.5">
                      <button
                        onClick={addItem}
                        disabled={adding}
                        className="flex-1 text-white text-xs py-1.5 rounded flex items-center justify-center gap-1 disabled:opacity-50"
                        style={{ backgroundColor: BRAND.brandGreen }}
                      >
                        {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : 'تأكيد'}
                      </button>
                      <button
                        onClick={() => setAddingItem(false)}
                        className="flex-1 bg-gray-100 text-xs py-1.5 rounded"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingItem(true)}
                    className="w-full text-xs py-2 rounded-lg border border-dashed flex items-center justify-center gap-1"
                    style={{ borderColor: BRAND.brandGreen, color: BRAND.brandGreen }}
                  >
                    <Plus className="w-3 h-3" /> أضف منتجاً
                  </button>
                )}
              </>
            )}

            {/* Voice note */}
            {order.voice_note_url && (
              <div className="bg-gray-50 rounded-lg p-2">
                <div className="text-[10px] text-gray-500 mb-1">رسالة صوتية منك</div>
                <audio
                  controls
                  src={order.voice_note_url}
                  className="w-full"
                  style={{ height: 28 }}
                />
              </div>
            )}

            {/* Totals */}
            <div className="text-[10px] text-gray-500 flex justify-between bg-gray-50 p-2 rounded-lg">
              <span>رسوم الخدمة:</span>
              <span>{order.service_fee.toFixed(2)} ر.س</span>
            </div>
          </div>
        )}
      </div>

      {/* Chat - takes remaining space */}
      <div className="flex-1 p-3 min-h-0">
        <ChatPanel
          orderId={orderId}
          perspective="customer"
          disabled={isLocked}
          disabledReason={
            isLocked
              ? order.status === 'delivered'
                ? 'تم التوصيل — تم إغلاق المحادثة'
                : 'الطلب ملغي — لا يمكن المراسلة'
              : undefined
          }
        />
      </div>
    </div>
  );
}