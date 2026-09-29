"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CreditCard, AlertCircle } from "lucide-react";
import { csrfFetch } from "@/lib/csrf-client";
import {
  getOrderPaymentAction,
  ONLINE_RETRYABLE_METHODS,
  type OrderPaymentAction,
} from '@/lib/orders';
import { PAYMENT_METHOD_AR } from '@/lib/orders';

/**
 * Customer-facing payment / retry CTA for the order detail view.
 *
 * Visible only when the centralized helper resolves the order to
 * "pay" (unpaid cash/wallet/online attempt not yet started) or
 * "retry" (a previous electronic attempt failed and may be re-run).
 *
 * Never accepts client-authoritative totals or contacts: the retry
 * API loads them from the database, and the response URL is the
 * gateway's hosted checkout or a redirect to /checkout/pay for the
 * inline (MPF) flow.
 */
interface OrderPaymentActionProps {
  orderId: string;
  status: string;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  /** Called after a successful hosted navigation, so the parent can
   *  refresh the order list to reflect the new payment_status. */
  onRetryStarted?: () => void;
}

interface RetrySuccess {
  success: true;
  mode: "hosted" | "inline";
  paymentUrl: string | null;
  paymentReference: string | null;
  total: number;
  paymentMethod: string;
  totalSar: number;
}

interface RetryFailure {
  success: false;
  error: string;
}

const METHOD_OPTIONS: Array<{
  value: (typeof ONLINE_RETRYABLE_METHODS)[number];
  label: string;
}> = [
  { value: "mada", label: PAYMENT_METHOD_AR.mada ?? "مدى" },
  { value: "visa", label: PAYMENT_METHOD_AR.visa ?? "فيزا" },
  { value: "mastercard", label: PAYMENT_METHOD_AR.mastercard ?? "ماستركارد" },
  { value: "apple_pay", label: PAYMENT_METHOD_AR.apple_pay ?? "Apple Pay" },
];

function defaultMethod(orderMethod?: string | null): (typeof ONLINE_RETRYABLE_METHODS)[number] {
  if (
    orderMethod &&
    (ONLINE_RETRYABLE_METHODS as readonly string[]).includes(orderMethod)
  ) {
    return orderMethod as (typeof ONLINE_RETRYABLE_METHODS)[number];
  }
  return "mada";
}

function actionCopy(action: OrderPaymentAction): string {
  return action === "retry" ? "إعادة الدفع" : "ادفع إلكترونياً";
}

export function OrderPaymentAction({
  orderId,
  status,
  paymentStatus,
  paymentMethod,
  onRetryStarted,
}: OrderPaymentActionProps) {
  const router = useRouter();
  const action = getOrderPaymentAction({ status, paymentStatus, paymentMethod });
  const [method, setMethod] = useState<(typeof ONLINE_RETRYABLE_METHODS)[number]>(
    defaultMethod(paymentMethod),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (action === "none") return null;

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Stable per-(order, method) idempotency key so the gateway side
      // dedupes any accidental double-clicks within its 24h window.
      const idempotencyKey = `${orderId}:${method}`;
      const res = await csrfFetch("/api/v1/payments/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, paymentMethod: method, idempotencyKey }),
      });
      const body = (await res.json()) as RetrySuccess | RetryFailure;
      if (!res.ok || !body.success) {
        const msg = (body as RetryFailure).error || "تعذّر بدء الدفع. حاول مرة أخرى";
        setError(msg);
        return;
      }
      onRetryStarted?.();
      if (body.mode === "inline" && !body.paymentUrl) {
        // The inline (MPF) screen already loads the server-authoritative
        // total via /api/v1/payments/status, so we only pass the order id.
        router.push(
          `/checkout/pay?order_id=${encodeURIComponent(orderId)}&method=${encodeURIComponent(method)}`,
        );
        return;
      }
      if (body.paymentUrl) {
        window.location.href = body.paymentUrl;
        return;
      }
      setError("استجابة غير متوقعة من بوابة الدفع");
    } catch {
      setError("تعذّر الاتصال بخدمة الدفع. حاول مرة أخرى");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="order-payment-action"
      data-action={action}
      className="bg-white rounded-2xl p-4 shadow-sm space-y-3"
    >
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <CreditCard className="w-4 h-4" />
        <span>
          {action === "retry"
            ? "تعذّر إكمال محاولة الدفع السابقة. أعد المحاولة بإحدى الطرق أدناه."
            : "اختر طريقة الدفع الإلكتروني لإكمال هذا الطلب."}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {METHOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setMethod(opt.value)}
            disabled={submitting}
            data-testid={`order-payment-method-${opt.value}`}
            data-method={opt.value}
            data-active={method === opt.value}
            className={`px-2 py-2 rounded-xl text-xs font-semibold border transition-colors ${
              method === opt.value
                ? "bg-primary-600 text-white border-primary-600"
                : "bg-white text-gray-700 border-gray-200 hover:border-primary-300"
            } ${submitting ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        data-testid="order-payment-submit"
        className="w-full py-4 bg-primary-600 text-white rounded-2xl font-semibold hover:bg-primary-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            جاري التحويل...
          </>
        ) : (
          actionCopy(action)
        )}
      </button>
    </div>
  );
}
