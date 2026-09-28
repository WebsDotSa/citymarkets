"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gift, Dice5, RotateCcw, Sparkles, ArrowLeft, TrendingUp } from "lucide-react";
import { useAuthState } from "@/contexts/auth-context";

interface LoyaltyData {
  balance: number;
  enabled: boolean;
  redeem_value?: number;
}

interface SpinData {
  can_spin: boolean;
  remaining_spins: number;
}

interface LastOrderItem {
  id: string;
  product_id: string;
  qty: number;
  product?: {
    id: string;
    name_ar: string;
    image_url: string | null;
  };
}

interface LastOrder {
  id: string;
  status: string;
  items?: LastOrderItem[];
}

export function WelcomeBackSection() {
  const { user } = useAuthState();
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null);
  const [spin, setSpin] = useState<SpinData | null>(null);
  const [lastOrder, setLastOrder] = useState<LastOrder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    const opts = { signal: ac.signal, credentials: "include" as const };

    Promise.all([
      fetch("/api/v1/loyalty", opts)
        .then((r) => r.json())
        .catch(() => null),
      fetch("/api/v1/spin", opts)
        .then((r) => r.json())
        .catch(() => null),
      fetch("/api/v1/orders?limit=1", opts)
        .then((r) => r.json())
        .catch(() => null),
    ]).then(([loyaltyRes, spinRes, ordersRes]) => {
      if (ac.signal.aborted) return;
      if (loyaltyRes?.success) setLoyalty(loyaltyRes.data);
      if (spinRes?.success) setSpin(spinRes.data);
      if (ordersRes?.success) {
        const list = Array.isArray(ordersRes.data)
          ? ordersRes.data
          : ordersRes.data?.orders || [];
        setLastOrder(list[0] || null);
      }
      setLoading(false);
    });

    return () => ac.abort();
  }, [user]);

  if (!user) return null;

  // Hide entire section if nothing useful to show
  const hasContent =
    (loyalty && loyalty.balance > 0) ||
    (spin && spin.can_spin) ||
    lastOrder;
  if (!loading && !hasContent) return null;

  const pointsValue =
    loyalty?.balance && loyalty?.redeem_value
      ? (loyalty.balance * loyalty.redeem_value).toFixed(2)
      : null;

  const reorderItems = lastOrder?.items?.slice(0, 3) || [];

  return (
    <section className="py-8 sm:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-5">
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
            أهلاً {user.name?.split(" ")[0] || "بك"} 👋
          </h2>
          <p className="text-sm text-slate-500 mt-1 font-normal">
            كمّل من وين وقفت
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Loyalty widget */}
          {loyalty && loyalty.balance > 0 && (
            <Link
              href="/loyalty"
              className="group bg-gradient-to-br from-primary to-primary-dark text-white rounded-3xl p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center">
                  <Gift className="w-5 h-5" />
                </div>
                <ArrowLeft className="w-4 h-4 opacity-50 group-hover:opacity-100 group-hover:-translate-x-1 transition-all" />
              </div>
              <div className="space-y-1">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black">{loyalty.balance}</span>
                  <span className="text-sm opacity-80">نقطة</span>
                </div>
                {pointsValue && (
                  <p className="text-sm opacity-90 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    تساوي {pointsValue} ر.س خصم
                  </p>
                )}
              </div>
            </Link>
          )}

          {/* Spin widget */}
          {spin && spin.can_spin && (
            <Link
              href="/spin"
              className="group bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-3xl p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center">
                  <Dice5 className="w-5 h-5 animate-pulse" />
                </div>
                <ArrowLeft className="w-4 h-4 opacity-50 group-hover:opacity-100 group-hover:-translate-x-1 transition-all" />
              </div>
              <div className="space-y-1">
                <p className="text-base font-bold">عجلة الحظ</p>
                <p className="text-sm opacity-90">
                  باقي لك {spin.remaining_spins} {spin.remaining_spins === 1 ? "دورة" : "دورات"} اليوم
                </p>
              </div>
            </Link>
          )}

          {/* Reorder widget */}
          {lastOrder && reorderItems.length > 0 && (
            <Link
              href={`/orders/${lastOrder.id}`}
              className="group bg-white border border-slate-100 rounded-3xl p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <RotateCcw className="w-5 h-5 text-slate-700" />
                </div>
                <ArrowLeft className="w-4 h-4 text-slate-400 group-hover:text-slate-700 group-hover:-translate-x-1 transition-all" />
              </div>
              <div className="space-y-2">
                <p className="text-base font-bold text-slate-900">أعد طلبك</p>
                <div className="flex items-center -space-x-2 space-x-reverse">
                  {reorderItems.map((it, idx) => (
                    <div
                      key={idx}
                      className="w-9 h-9 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center overflow-hidden"
                      style={{ zIndex: reorderItems.length - idx }}
                    >
                      {it.product?.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={it.product.image_url}
                          alt={it.product.name_ar}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Sparkles className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500">آخر طلب لك</p>
              </div>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}