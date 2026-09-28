"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Check, TicketPercent, Clock } from "lucide-react";
import { useToast } from "@/components/ui/toast";

interface Coupon {
  id: string;
  code: string;
  type: "percentage" | "fixed" | "free_delivery";
  value: number;
  min_order: number | null;
  max_discount: number | null;
  expires_at: string | null;
}

function formatDiscount(c: Coupon): string {
  if (c.type === "percentage") return `${c.value}%`;
  if (c.type === "fixed") return `${c.value} ر.س`;
  return "توصيل مجاني";
}

function isExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return ms > 0 && ms < 3 * 24 * 60 * 60 * 1000;
}

export function CouponsStripSection() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/v1/coupons", { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => {
        if (ac.signal.aborted) return;
        if (d.success) setCoupons(d.data?.coupons || d.data || []);
        setLoading(false);
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  const sorted = useMemo(() => {
    return [...coupons].sort((a, b) => {
      const aExp = a.expires_at ? new Date(a.expires_at).getTime() : Infinity;
      const bExp = b.expires_at ? new Date(b.expires_at).getTime() : Infinity;
      return aExp - bExp;
    });
  }, [coupons]);

  if (!loading && coupons.length === 0) return null;

  const onCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      showToast(`تم نسخ الكود: ${code}`, "success");
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      showToast("تعذر نسخ الكود", "error");
    }
  };

  return (
    <section className="py-8 sm:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-5">
          <div className="flex items-center gap-2">
            <TicketPercent className="w-6 h-6 text-amber-500" />
            <div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
                كوبونات خصم
              </h2>
              <p className="text-sm text-slate-500 mt-1 font-normal">
                انسخ الكود واستخدمه عند الدفع
              </p>
            </div>
          </div>
        </div>

        <div className="-mx-4 sm:mx-0">
          <div className="flex gap-3 overflow-x-auto px-4 sm:px-0 pb-2 scrollbar-hide">
            {loading
              ? [...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="flex-shrink-0 w-72 h-32 rounded-3xl bg-slate-100 animate-pulse"
                  />
                ))
              : sorted.map((c) => {
                  const expiring = isExpiringSoon(c.expires_at);
                  return (
                    <div
                      key={c.id}
                      className="group flex-shrink-0 w-72 rounded-3xl bg-gradient-to-l from-amber-50 to-orange-50 border border-amber-200/60 p-5 hover:shadow-md transition-all duration-300"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="text-2xl font-black text-amber-700">
                          {formatDiscount(c)}
                        </div>
                        {expiring && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                            <Clock className="w-3 h-3" />
                            ينتهي قريباً
                          </span>
                        )}
                      </div>

                      <div className="mb-3">
                        <p className="text-xs text-slate-600 mb-1">خصم</p>
                        <p className="font-bold text-slate-900 text-sm">
                          {c.type === "free_delivery"
                            ? "على رسوم التوصيل"
                            : c.min_order
                            ? `لطلبات فوق ${c.min_order} ر.س`
                            : "على جميع الطلبات"}
                        </p>
                      </div>

                      <button
                        onClick={() => onCopy(c.code)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-white border-2 border-dashed border-amber-300 text-amber-900 font-mono font-bold text-sm hover:bg-amber-50 transition-colors"
                      >
                        {copiedCode === c.code ? (
                          <>
                            <Check className="w-4 h-4" />
                            تم النسخ
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            {c.code}
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
          </div>
        </div>
      </div>
    </section>
  );
}