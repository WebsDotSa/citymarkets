'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BRAND } from '@/lib/brand-theme';
import { Loader2, ChevronLeft, MessageCircle, Package, User } from 'lucide-react';
import type { AdminDirectOrder } from '@/lib/admin-types';
import { ORDER_STATUSES, getOrderStatusConfig } from '@/lib/orders';

// Status labels are sourced from `ORDER_STATUSES` + `getOrderStatusConfig()`
// (canonical state machine at `@/lib/orders/state-machine`). The previous
// inline map held stale keys (`accepted`, `in_progress`) that are NOT
// valid `orders.status` enum values and drifted from the central enum.
type DirectOrderRow = AdminDirectOrder;

export default function AdminDirectOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<DirectOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);

  async function fetchOrders() {
    try {
      const url = new URL('/api/admin/orders/direct', window.location.origin);
      if (filter) url.searchParams.set('status', filter);
      if (search) url.searchParams.set('search', search);
      const res = await fetch(url.toString(), { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders || []);
        setTotal(data.total || 0);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOrders();
    const t = setInterval(fetchOrders, 10000);
    return () => clearInterval(t);
  }, [filter, search]);

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8" dir="rtl">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="p-1" aria-label="رجوع">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">الطلبات المباشرة</h1>
            <p className="text-sm text-gray-500">إجمالي {total} طلب</p>
          </div>
          <button
            onClick={() => router.push('/orders/direct/chat')}
            className="me-auto text-white font-bold px-4 py-2 rounded-xl flex items-center gap-2"
            style={{ backgroundColor: BRAND.brandGreen }}
          >
            <MessageCircle className="w-4 h-4" />
            محادثات العملاء
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-center border border-gray-200">
          <input
            type="text"
            placeholder="بحث برقم الطلب أو الاسم..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">جميع الحالات</option>
            {Object.entries(ORDER_STATUSES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        {/* Orders list */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: BRAND.brandGreen }} />
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center text-gray-500 border border-gray-200">
            لا توجد طلبات مباشرة بعد
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => (
              <button
                key={o.id}
                onClick={() => router.push(`/orders/direct/${o.id}`)}
                className="w-full bg-white rounded-xl p-4 border border-gray-200 hover:border-green-500 transition text-right"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-lg">#{o.order_number}</span>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-bold"
                        style={{
                          backgroundColor: o.status === 'pending' ? '#FEF3C7' : '#DBEAFE',
                          color: o.status === 'pending' ? '#92400E' : '#1E40AF',
                        }}
                      >
                        {getOrderStatusConfig(o.status).label}
                      </span>
                      {o.unread_count > 0 && (
                        <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5 flex items-center gap-1">
                          <MessageCircle className="w-3 h-3" />
                          {o.unread_count}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-700">
                      <User className="inline w-3 h-3 ms-1" />
                      {o.user_name || o.guest_name || 'عميل'}{' '}
                      {o.user_phone || o.guest_phone ? `· ${o.user_phone || o.guest_phone}` : ''}
                    </div>
                    {o.address_text && (
                      <div className="text-xs text-gray-500 mt-1 truncate">{o.address_text}</div>
                    )}
                    <div className="flex gap-3 mt-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Package className="w-3 h-3" />
                        {o.items_count} عناصر
                      </span>
                      <span>{new Date(o.created_at).toLocaleString('ar-SA')}</span>
                    </div>
                  </div>
                  <div className="text-left">
                    <div className="font-bold text-lg" style={{ color: BRAND.brandGreen }}>
                      {o.total.toFixed(2)}
                    </div>
                    <div className="text-xs text-gray-500">ر.س</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}