"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Coins, Gift, History, Sparkles, ArrowLeft } from "lucide-react";

interface Transaction {
  id: string;
  points: number;
  type: "earn" | "redeem" | "adjust";
  ref_order_id: string | null;
  created_at: string;
}

interface LoyaltyData {
  balance: number;
  lifetime_earned: number;
  lifetime_redeemed: number;
  redeem_value: number;
  min_redeem: number;
  max_redeem_percent: number;
  transactions: Transaction[];
}

const REASON_LABELS: Record<string, string> = {
  earn: "كسبت من طلب",
  redeem: "استبدلت نقاط",
  adjust: "تعديل",
  bonus: "مكافأة",
  expire: "انتهت صلاحية",
};

export default function LoyaltyPage() {
  const [data, setData] = useState<LoyaltyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/loyalty", { credentials: "include" });
        if (!res.ok) {
          if (res.status === 401) {
            throw new Error("سجّل دخولك عشان تشوف نقاطك");
          }
          throw new Error("ما قدرنا نجيب البيانات");
        }
        const json = await res.json();
        // API returns an enveloped { success, data: {...} } — the legacy
        // page did `setData(json)` which produced `data.balance === undefined`
        // and crashed on the first `toLocaleString` call.
        if (!cancelled) setData(json?.data ?? null);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "حصل خطأ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <main className="min-h-[80vh] flex items-center justify-center">
        <p className="text-gray-500">جاري التحميل...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-[80vh] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <Gift className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-700 mb-4">{error}</p>
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white"
          >
            تسجيل الدخول
          </Link>
        </div>
      </main>
    );
  }

  if (!data) return null;

  const sarValue = (data.balance * data.redeem_value).toFixed(2);
  const canRedeem = data.balance >= data.min_redeem;

  return (
    <main className="min-h-[80vh] bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <Link href="/profile" className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" />
          حسابي
        </Link>

        <section className="bg-gradient-to-br from-primary to-primary-dark rounded-2xl p-6 text-white mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-5 h-5" />
            <span className="text-sm opacity-90">نقاط الولاء</span>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <Coins className="w-8 h-8" />
            <span className="text-4xl font-bold">{data.balance.toLocaleString("ar-SA")}</span>
            <span className="text-sm opacity-90">نقطة</span>
          </div>
          <p className="text-sm opacity-90">
            {/* Read min_redeem from the live admin-tuned settings so the
                copy reflects the current threshold without a redeploy. */}
            تعادل {sarValue} ر.س — كل {data.min_redeem} نقطة = {(data.min_redeem * data.redeem_value).toFixed(2)} ر.س خصم
          </p>
        </section>

        {canRedeem ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-6">
            <h2 className="font-semibold text-gray-900 mb-2">كيف تستفيد من نقاطك؟</h2>
            <p className="text-sm text-gray-600 mb-3">
              تقدر تستخدم نقاطك عند الدفع في الطلب الجاي. الحد الأقصى
              {Math.round(data.max_redeem_percent * 100)}% من قيمة الطلب.
            </p>
            <Link
              href="/catalog"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium"
            >
              ابدا تسوق
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-6 text-sm text-gray-600">
            تحتاج {data.min_redeem - data.balance} نقطة إضافية لتقدر تستبدل. كل
            طلب يكسبك نقاط!
          </div>
        )}

        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <History className="w-4 h-4" />
            سجل النقاط
          </h2>
          {data.transactions.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">
              ما عندك عمليات بعد
            </p>
          ) : (
            <ul className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
              {data.transactions.map((tx) => (
                <li key={tx.id} className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {REASON_LABELS[tx.type] || tx.type}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(tx.created_at).toLocaleDateString("ar-SA", {
                        day: "numeric",
                        month: "long",
                      })}
                    </p>
                  </div>
                  <div className="text-left">
                    <p
                      className={
                        "font-bold " + (tx.points >= 0 ? "text-primary" : "text-red-600")
                      }
                    >
                      {tx.points >= 0 ? "+" : ""}
                      {tx.points.toLocaleString("ar-SA")}
                    </p>
                    <p className="text-xs text-gray-500">
                      {tx.ref_order_id ? `طلب: ${String(tx.ref_order_id).slice(0, 8)}` : "تعديل"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
