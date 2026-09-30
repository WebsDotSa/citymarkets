"use client";

import { getApiErrorMessage } from "@/lib/api-error";
import { useState } from "react";
import Link from "next/link";
import { Search, Phone, Hash, Package, MapPin, ChevronLeft, Loader2, X } from "lucide-react";
import { CUSTOMER_PROGRESS_STEPS, getOrderStatusConfig } from '@/lib/orders';

interface TrackedItem {
  id: string;
  product_id: string;
  product_name: string;
  product_image: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
}

interface TrackedOrder {
  id: string;
  status: string;
  status_ar: string;
  type: string;
  total: number;
  payment_method: string;
  tracking_code: string;
  guest: { name: string | null; phone: string | null; city: string | null; district: string | null };
  created_at: string;
  updated_at: string;
}

const STATUS_STEPS = CUSTOMER_PROGRESS_STEPS;

function statusIndex(s: string): number {
  if (s === "cancelled") return -1;
  const idx = STATUS_STEPS.findIndex((step) => step.status === s);
  if (idx >= 0) return idx;
  if (s === "paid") return STATUS_STEPS.length - 1;
  return 0;
}

export default function TrackOrderPage() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [items, setItems] = useState<TrackedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setOrder(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/orders/track?phone=${encodeURIComponent(phone)}&code=${encodeURIComponent(code)}`
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(getApiErrorMessage(data, "ما قدرنا نلاقي الطلب"));
        return;
      }
      setOrder(data.order);
      setItems(data.items || []);
    } catch {
      setError("خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/" aria-label="رجوع" className="text-gray-700">
            <ChevronLeft className="w-6 h-6" aria-hidden="true" />
          </Link>
          <h1 className="font-bold text-gray-900">تتبع الطلب</h1>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6 space-y-4">
        <p className="text-sm text-gray-600 leading-relaxed">
          أدخل رقم جوالك و رمز التتبع الموجود في رسالة تأكيد الطلب.
        </p>

        <form onSubmit={submit} className="bg-white rounded-2xl p-4 space-y-3 shadow-sm">
          <label className="block">
            <span className="text-xs text-gray-600 mb-1 block">رقم الجوال</span>
            <div className="relative">
              <Phone className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="05XXXXXXXX"
                required
                className="w-full h-11 pr-9 pl-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label="رقم الجوال"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs text-gray-600 mb-1 block">رمز التتبع (6 أرقام)</span>
            <div className="relative">
              <Hash className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="123456"
                required
                className="w-full h-11 pr-9 pl-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label="رمز التتبع"
              />
            </div>
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !phone || code.length !== 6}
            className="w-full h-11 rounded-xl bg-primary text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? "جاري البحث..." : "تتبع الطلب"}
          </button>
        </form>

        {order && (
          <article className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">رقم الطلب</p>
                <p className="text-base font-bold text-gray-900 font-mono">{order.tracking_code}</p>
              </div>
              <span
                className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                  order.status === "delivered" || order.status === "completed"
                    ? "bg-green-50 text-green-700"
                    : order.status === "cancelled"
                    ? "bg-red-50 text-red-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {order.status_ar}
              </span>
            </div>

            {/* Status timeline */}
            {order.status !== "cancelled" && (
              <div className="p-4 border-b border-gray-100">
                <ol className="space-y-3" aria-label="مراحل الطلب">
                  {STATUS_STEPS.map((step, i) => {
                    const done = i <= statusIndex(order.status);
                    const Icon = step.icon;
                    return (
                      <li key={step.status} className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            done ? "bg-primary text-white" : "bg-gray-100 text-gray-400"
                          }`}
                          aria-hidden="true"
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <span className={`text-sm ${done ? "text-gray-900 font-medium" : "text-gray-400"}`}>
                          {step.label}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            {order.status === "cancelled" && (
              <div className="p-4 border-b border-gray-100 flex items-center gap-3 text-red-600">
                <X className="w-5 h-5" aria-hidden="true" />
                <span className="text-sm font-medium">هذا الطلب ملغي</span>
              </div>
            )}

            {/* Address */}
            {(order.guest.city || order.guest.district) && (
              <div className="p-4 border-b border-gray-100 flex items-start gap-3">
                <MapPin className="w-4 h-4 mt-0.5 text-gray-400" aria-hidden="true" />
                <div className="text-sm text-gray-700">
                  {order.guest.city}
                  {order.guest.district && ` — ${order.guest.district}`}
                </div>
              </div>
            )}

            {/* Items */}
            <div className="p-4 border-b border-gray-100">
              <p className="text-xs text-gray-500 mb-2">المنتجات ({items.length})</p>
              <ul className="space-y-2">
                {items.map((it) => (
                  <li key={it.id} className="flex items-center gap-3">
                    {it.product_image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.product_image}
                        alt={it.product_name || ""}
                        className="w-12 h-12 rounded-lg object-cover bg-gray-100"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-xl">
                        📦
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 line-clamp-1">{it.product_name}</p>
                      <p className="text-xs text-gray-500">
                        {it.quantity} × {it.unit_price.toFixed(2)} ر.س
                      </p>
                    </div>
                    <p className="text-sm font-bold text-gray-900">{it.line_total.toFixed(2)} ر.س</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-4 flex items-center justify-between">
              <span className="text-sm text-gray-600">الإجمالي</span>
              <span className="text-lg font-bold text-primary">{order.total.toFixed(2)} ر.س</span>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
