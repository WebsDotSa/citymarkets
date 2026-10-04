"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle, Loader2, AlertCircle, CreditCard } from "lucide-react";
import { PAYMENT_METHOD_AR } from '@/lib/orders';
import { trackPurchase } from "@/lib/ga-events";

function SuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order_id") || searchParams.get("orderId");
  const moyasarPaymentId = searchParams.get("id");
  const [status, setStatus] = useState<"loading" | "ok" | "pending" | "error">(
    "loading"
  );
  // نخزّن طريقة الدفع من استجابة /api/v1/payments/status لنعرضها للمستخدم
  // (ميسر / مدى / فيزا / Apple Pay / STC Pay / نقداً...). هذا يثبت للعميل
  // ما إذا تم الدفع فعلاً، وبأي قناة.
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      setStatus("ok");
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    // BUGFIX (audit 2026-09-29): the previous version fired the verify
    // call exactly twice (immediately + at 2.5s) and then gave up —
    // leaving the user staring at "جاري تأكيد الدفع" indefinitely
    // when the gateway webhook was just slow. Replace the single-shot
    // timeout with a backoff polling loop: start at 1s, double each
    // attempt, cap at 8s, give up after 90s of total wall time. The
    // status endpoint is now rate-limited (PAYMENT_STATUS_CONFIG) so
    // the polling is safe to run for the full window.
    const POLL_INTERVALS_MS = [1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000, 8000, 8000];
    const POLL_TIMEOUT_MS = 90_000;
    const startedAt = Date.now();

    const verify = async () => {
      if (cancelled) return;
      try {
        if (moyasarPaymentId) {
          await fetch("/api/v1/payments/moyasar/confirm", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              order_id: orderId,
              payment_id: moyasarPaymentId,
            }),
          });
        }

        const res = await fetch(
          `/api/v1/payments/status?order_id=${encodeURIComponent(orderId)}`,
          { credentials: "include" }
        );
        const data = await res.json();
        if (cancelled) return;
        if (typeof data.payment_method === "string") {
          setPaymentMethod(data.payment_method);
        }
        if (data.payment_status === "paid") {
          setStatus("ok");
          // Google Analytics 4 + Meta Pixel — purchase. Fire only once
          // per paid order (status flips from "loading" → "ok", so this
          // useEffect runs exactly once for the success path).
          //
          // `event_id` is derived deterministically from the order id by
          // trackPurchase so a future Conversions API server call can
          // compute the same id with the same formula and Meta will
          // dedupe the browser + server events instead of double-
          // counting the conversion.
          const items = Array.isArray(data.items)
            ? data.items.map((it: { product_id?: unknown; name?: unknown; quantity?: unknown; price?: unknown }) => ({
                item_id: typeof it.product_id === "string" ? it.product_id : String(it.product_id ?? ""),
                item_name: typeof it.name === "string" ? it.name : undefined,
                price: Number(it.price ?? 0),
                quantity: Number(it.quantity ?? 1),
              }))
            : [];
          trackPurchase({
            transaction_id: orderId,
            currency: "SAR",
            value: Number(data.total ?? 0),
            payment_method: data.payment_method ?? undefined,
            items,
          });
          return; // stop polling — terminal
        }
        if (data.payment_status === "failed") {
          setStatus("error");
          return; // stop polling — terminal
        }
        setStatus("pending");
      } catch {
        if (!cancelled) setStatus("pending");
      }
      if (cancelled) return;
      // Schedule next attempt. Index grows with each call so the
      // interval grows; once we exhaust the table, fall back to the
      // last entry. Hard-stop after POLL_TIMEOUT_MS to avoid leaving
      // the request open forever on a stuck gateway.
      const elapsed = Date.now() - startedAt;
      if (elapsed >= POLL_TIMEOUT_MS) return;
      const attemptsSoFar = Math.floor(elapsed / 1000); // approximate; we're only using it for index lookup
      const idx = Math.min(POLL_INTERVALS_MS.length - 1, attemptsSoFar);
      pollTimer = setTimeout(verify, POLL_INTERVALS_MS[idx]);
    };

    void verify();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [orderId, moyasarPaymentId]);

  const shortId = orderId
    ? `#${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`
    : null;

  // تسمية طريقة الدفع بالعربية للمستخدم. لا نعرضها قبل الـ"loading" لأن
  // الـ status API لم يُستدعى بعد.
  const methodLabel = paymentMethod
    ? PAYMENT_METHOD_AR[paymentMethod] ?? paymentMethod
    : null;

  return (
    <div className="max-w-lg mx-auto px-4 py-16 text-center">
      {status === "loading" && (
        <>
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-gray-600">جاري التحقق من الدفع...</p>
        </>
      )}

      {status === "ok" && (
        <>
          <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-12 h-12 text-primary-600" />
          </div>
          <h1 className="text-2xl font-bold text-secondary mb-2">
            تم الدفع بنجاح
          </h1>
          <p className="text-gray-500 mb-6">
            شكراً لك! تم استلام طلبك وسنتواصل معك قريباً.
          </p>
          {methodLabel ? (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-50 border border-primary-200 rounded-full text-primary-700 text-sm font-medium mb-2">
              <CreditCard className="w-4 h-4" />
              <span>تم الدفع عبر {methodLabel}</span>
            </div>
          ) : null}
        </>
      )}

      {status === "pending" && (
        <>
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Loader2 className="w-10 h-10 text-amber-600 animate-spin" />
          </div>
          <h1 className="text-2xl font-bold text-secondary mb-2">
            جاري تأكيد الدفع
          </h1>
          <p className="text-gray-500 mb-6">
            قد يستغرق التأكيد دقيقة. يمكنك متابعة حالة الطلب من صفحة الطلبات.
          </p>
          {methodLabel ? (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-full text-amber-700 text-sm font-medium mb-2">
              <CreditCard className="w-4 h-4" />
              <span>طريقة الدفع: {methodLabel}</span>
            </div>
          ) : null}
        </>
      )}

      {status === "error" && (
        <>
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-12 h-12 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-secondary mb-2">
            لم يتم الدفع
          </h1>
          <p className="text-gray-500 mb-6">
            {methodLabel
              ? `لم تكتمل العملية عبر ${methodLabel}. يمكنك إعادة المحاولة أو اختيار الدفع عند الاستلام.`
              : "يمكنك إعادة المحاولة من صفحة الدفع أو التواصل مع الدعم."}
          </p>
          <Link
            href="/checkout"
            className="inline-block px-6 py-3 bg-primary text-white rounded-xl font-semibold mb-4"
          >
            إعادة المحاولة
          </Link>
        </>
      )}

      {shortId && status !== "loading" && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
          <p className="text-sm text-gray-500 mb-1">رقم الطلب</p>
          <p className="text-xl font-bold text-primary font-mono" dir="ltr">
            {shortId}
          </p>
        </div>
      )}

      {status !== "loading" && status !== "error" && (
        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            href="/orders"
            className="px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors"
          >
            طلباتي
          </Link>
          <Link
            href="/catalog"
            className="px-6 py-3 border border-gray-200 text-secondary font-semibold rounded-xl hover:bg-gray-50 transition-colors"
          >
            متابعة التسوق
          </Link>
        </div>
      )}
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-lg mx-auto px-4 py-16 text-center">
          <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto" />
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
