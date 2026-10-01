'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BRAND } from '@/lib/brand-theme';
import { ChatPanel } from '@/components/ui/chat-panel/chat-panel';
import type {
  AdminDirectOrder,
  AdminDirectOrderItem,
} from '@/lib/admin-types';
import {
  ChevronLeft,
  Search,
  MessageCircle,
  Phone,
  Package,
  ChevronRight,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Save,
  Clock,
  Plus,
} from 'lucide-react';

type DirectOrderRow = AdminDirectOrder;
type OrderItem = AdminDirectOrderItem;
type OrderDetail = AdminDirectOrder;

const STATUS_OPTIONS = [
  { value: 'pending', label: 'بانتظار التأكيد' },
  { value: 'shopping', label: 'جارٍ التحضير' },
  { value: 'accepted', label: 'تم القبول' },
  { value: 'in_progress', label: 'قيد التنفيذ' },
  { value: 'on_the_way', label: 'في الطريق' },
  { value: 'delivered', label: 'تم التوصيل' },
  { value: 'cancelled', label: 'ملغي' },
];

export default function AdminChatHubPage() {
  const router = useRouter();
  const search = useSearchParams();
  const initialOrderId = search.get('order');

  const [orders, setOrders] = useState<DirectOrderRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialOrderId);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeOrder, setActiveOrder] = useState<OrderDetail | null>(null);
  const [activeItems, setActiveItems] = useState<OrderItem[]>([]);
  const [internalNotes, setInternalNotes] = useState('');
  const [status, setStatus] = useState('');
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [newProductSearch, setNewProductSearch] = useState('');
  const [productResults, setProductResults] = useState<Array<{ id: string; name_ar: string; price: number; image_url?: string | null }>>([]);
  const [searchingProducts, setSearchingProducts] = useState(false);

  async function fetchOrders() {
    try {
      const url = new URL('/api/admin/orders/direct', window.location.origin);
      if (searchTerm) url.searchParams.set('search', searchTerm);
      const res = await fetch(url.toString(), { credentials: 'include' });
      const data = await res.json();
      if (data.success) setOrders(data.orders || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function fetchActiveOrder(orderId: string) {
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setActiveOrder(data.order);
        setActiveItems(data.items || []);
        setInternalNotes(data.order.internal_notes || '');
        setStatus(data.order.status);
      }
    } catch {
      // silent
    }
  }

  useEffect(() => {
    fetchOrders();
    const t = setInterval(fetchOrders, 8000);
    return () => clearInterval(t);
  }, [searchTerm]);

  useEffect(() => {
    if (!activeId) return;
    fetchActiveOrder(activeId);
    const t = setInterval(() => fetchActiveOrder(activeId), 12000);
    return () => clearInterval(t);
  }, [activeId]);

  async function searchProducts(term: string) {
    if (term.length < 2) {
      setProductResults([]);
      return;
    }
    setSearchingProducts(true);
    try {
      const res = await fetch(`/api/v1/products?q=${encodeURIComponent(term)}&limit=8`, { credentials: 'include' });
      const data = await res.json();
      if (data.success) setProductResults(data.products || []);
    } catch {
      // silent
    } finally {
      setSearchingProducts(false);
    }
  }

  async function attachProductToOrder(productId: string, productName: string) {
    if (!activeId) return;
    try {
      // Use admin product attach: write a direct_order_item on this order.
      const res = await fetch(`/api/v1/orders/${activeId}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, free_text: productName, quantity: 1 }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'فشل');
      setAddingProduct(false);
      setNewProductSearch('');
      setProductResults([]);
      await fetchActiveOrder(activeId);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function saveChanges() {
    if (!activeId) return;
    setSaving(true);
    try {
      const itemUpdates = Object.entries(priceEdits)
        .filter(([, v]) => v !== '')
        .map(([itemId, v]) => ({ itemId, resolved_price: parseFloat(v) || 0 }));
      const res = await fetch(`/api/admin/orders/${activeId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          internal_notes: internalNotes,
          items: itemUpdates,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'فشل');
      setPriceEdits({});
      await fetchActiveOrder(activeId);
      await fetchOrders();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmPriceForItem(itemId: string) {
    if (!activeId) return;
    const item = activeItems.find((i) => i.id === itemId);
    if (!item) return;
    const priceStr = priceEdits[itemId] ?? (item.resolved_price ? String(item.resolved_price) : '');
    const price = parseFloat(priceStr) || 0;
    try {
      const res = await fetch(`/api/admin/orders/${activeId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ itemId, resolved_price: price }],
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'فشل');
      await fetchActiveOrder(activeId);
      await fetchOrders();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Header */}
      <div
        className="text-white px-4 py-3 flex items-center gap-3 shadow-md"
        style={{ backgroundColor: BRAND.brandGreen }}
      >
        <button onClick={() => router.back()} className="p-1" aria-label="رجوع">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold">محادثات الطلبات المباشرة</h1>
          <p className="text-xs opacity-90">تواصل مع العملاء وأكّد الأسعار</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-0 h-[calc(100vh-60px)]">
        {/* Left: Order list */}
        <div className={`lg:col-span-4 bg-white border-s border-gray-200 ${activeId ? 'hidden lg:block' : 'block'}`}>
          <div className="p-3 border-b border-gray-200 sticky top-0 bg-white z-10">
            <div className="relative">
              <input
                type="text"
                placeholder="بحث برقم الطلب أو الاسم..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pe-10 ps-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-green-500"
              />
              <Search className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            </div>
          </div>

          <div className="overflow-y-auto" style={{ height: 'calc(100vh - 130px)' }}>
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: BRAND.brandGreen }} />
              </div>
            ) : orders.length === 0 ? (
              <div className="text-center text-gray-500 text-sm py-12">
                لا توجد طلبات مباشرة
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {orders.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setActiveId(o.id)}
                    className={`w-full text-right p-3 hover:bg-gray-50 transition ${
                      activeId === o.id ? 'bg-green-50 border-e-4 border-green-500' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-sm">#{o.order_number}</span>
                          {o.unread_count > 0 && (
                            <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
                              {o.unread_count}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-700 truncate">
                          {o.user_name || o.guest_name || 'عميل'}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                          <Clock className="w-3 h-3" />
                          {new Date(o.created_at).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                          <span>·</span>
                          <span>{o.items_count} عناصر</span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Chat + order actions */}
        <div className={`lg:col-span-8 ${activeId ? 'block' : 'hidden lg:block'}`}>
          {!activeId ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              اختر طلباً من القائمة لبدء المحادثة
            </div>
          ) : !activeOrder ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: BRAND.brandGreen }} />
            </div>
          ) : (
            <div className="grid md:grid-cols-2 h-full">
              {/* Order management column */}
              <div className="bg-gray-50 border-s border-gray-200 overflow-y-auto p-4 space-y-3">
                <div className="lg:hidden mb-2">
                  <button onClick={() => setActiveId(null)} className="text-sm flex items-center gap-1" style={{ color: BRAND.brandGreen }}>
                    <ChevronLeft className="w-4 h-4" /> العودة للقائمة
                  </button>
                </div>

                {/* Customer card */}
                <div className="bg-white rounded-xl p-3 border border-gray-200">
                  <div className="text-xs text-gray-500 mb-1">العميل</div>
                  <div className="font-bold">{activeOrder.user_name || activeOrder.guest_name || 'عميل'}</div>
                  {(activeOrder.user_phone || activeOrder.guest_phone) && (
                    <a
                      href={`tel:${activeOrder.user_phone || activeOrder.guest_phone}`}
                      className="text-xs flex items-center gap-1 mt-1"
                      style={{ color: BRAND.brandGreen }}
                    >
                      <Phone className="w-3 h-3" />
                      {activeOrder.user_phone || activeOrder.guest_phone}
                    </a>
                  )}
                  {activeOrder.address_text && (
                    <div className="text-xs text-gray-600 mt-2 pt-2 border-t border-gray-100">
                      <div className="font-bold">{activeOrder.address_label}</div>
                      <div>{activeOrder.address_text}</div>
                    </div>
                  )}
                  <div className="text-[10px] text-gray-400 mt-2">
                    #{activeOrder.order_number} · {new Date(activeOrder.created_at).toLocaleString('ar-SA')}
                  </div>
                </div>

                {/* Status + actions */}
                <div className="bg-white rounded-xl p-3 border border-gray-200">
                  <div className="text-xs font-bold mb-2">الحالة</div>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2"
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <textarea
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    placeholder="ملاحظات داخلية..."
                    rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs"
                  />
                  <button
                    onClick={saveChanges}
                    disabled={saving}
                    className="w-full mt-2 text-white font-bold py-2 rounded-lg flex items-center justify-center gap-1 disabled:opacity-50"
                    style={{ backgroundColor: BRAND.brandGreen }}
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    حفظ الحالة والملاحظات
                  </button>
                </div>

                {/* Items + price confirm + add product */}
                <div className="bg-white rounded-xl p-3 border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-bold flex items-center gap-1">
                      <Package className="w-4 h-4" /> المنتجات والأسعار
                    </div>
                    <button
                      onClick={() => setAddingProduct(!addingProduct)}
                      className="text-[10px] flex items-center gap-1 px-2 py-1 rounded"
                      style={{ backgroundColor: BRAND.primaryLight, color: BRAND.primaryDark }}
                    >
                      <Plus className="w-3 h-3" /> أضف منتجاً
                    </button>
                  </div>

                  {addingProduct && (
                    <div className="mb-2 p-2 bg-gray-50 rounded-lg">
                      <input
                        type="text"
                        placeholder="ابحث عن منتج..."
                        value={newProductSearch}
                        onChange={(e) => {
                          setNewProductSearch(e.target.value);
                          searchProducts(e.target.value);
                        }}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs mb-1"
                      />
                      {searchingProducts && (
                        <div className="text-[10px] text-gray-500">جاري البحث...</div>
                      )}
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {productResults.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => attachProductToOrder(p.id, p.name_ar)}
                            className="w-full flex items-center gap-2 p-1.5 hover:bg-white rounded text-right"
                          >
                            {p.image_url && (
                              <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] font-semibold truncate">{p.name_ar}</div>
                              <div className="text-[10px] text-gray-500">{p.price.toFixed(2)} ر.س</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    {activeItems.length === 0 && (
                      <div className="text-xs text-gray-500 text-center py-2">
                        لا توجد عناصر
                      </div>
                    )}
                    {activeItems.map((it) => (
                      <div key={it.id} className="bg-gray-50 rounded-lg p-2">
                        <div className="flex items-start gap-2">
                          {it.image_url && (
                            <img src={it.image_url} alt="" className="w-10 h-10 rounded object-cover" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold truncate">
                              {it.name_ar || it.free_text}
                            </div>
                            <div className="text-[10px] text-gray-500">×{it.quantity}</div>
                          </div>
                        </div>
                        <div className="flex gap-1 mt-1.5">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="السعر"
                            value={priceEdits[it.id] ?? (it.resolved_price ? String(it.resolved_price) : '')}
                            onChange={(e) => setPriceEdits((p) => ({ ...p, [it.id]: e.target.value }))}
                            className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs"
                          />
                          <button
                            onClick={() => confirmPriceForItem(it.id)}
                            className="text-[10px] px-2 py-1 rounded text-white flex items-center gap-1"
                            style={{ backgroundColor: BRAND.brandGreen }}
                          >
                            <CheckCircle2 className="w-3 h-3" /> تأكيد
                          </button>
                        </div>
                        {it.resolved_at && (
                          <div className="text-[9px] text-green-700 mt-1">✓ تم التأكيد</div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 pt-2 border-t border-gray-100 text-[11px]">
                    <div className="flex justify-between"><span>المجموع الفرعي:</span><span>{activeOrder.subtotal.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>رسوم الخدمة:</span><span>{activeOrder.service_fee.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>الضريبة:</span><span>{activeOrder.tax.toFixed(2)}</span></div>
                    <div className="flex justify-between font-bold mt-1"><span>الإجمالي:</span><span>{activeOrder.total.toFixed(2)} ر.س</span></div>
                  </div>
                </div>
              </div>

              {/* Chat column */}
              <div className="p-3 h-full overflow-hidden">
                <ChatPanel
                  orderId={activeId}
                  perspective="admin"
                  pollMs={4000}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}