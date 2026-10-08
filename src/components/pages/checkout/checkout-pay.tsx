"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import { MoyasarCheckoutForm } from "@/components/checkout/moyasar-checkout-form";
import { useToast } from "@/components/ui/toast";

/**
 * Inline Moyasar payment screen.
 *
 * Lives at /checkout/pay — a route that `isStorefrontRoute` allows, so
 * the global HeaderV2 / BottomNavV2 (StoreChrome) stay mounted during
 * payment. The CheckoutNew wizard navigates here after creating the
 * order so the user sees a fully chromed payment surface.
 */
export function CheckoutPay() {
  const params = useSearchParams();
  const router = useRouter();
  const { showToast } = useToast();

  const orderId = params.get("order_id") ?? "";
  const total = useMemo(() => {
    const raw = params.get("total");
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  }, [params]);
  const methodRaw = params.get("method") ?? "mada";
  // Widen method types to include mastercard and amex (map to mada for Moyasar)
  const method: "mada" | "visa" | "apple_pay" | "stc_pay" =
    methodRaw === "visa" ||
    methodRaw === "apple_pay" ||
    methodRaw === "stc_pay" ||
    methodRaw === "mada"
      ? methodRaw
      : methodRaw === "mastercard" || methodRaw === "amex"
      ? "mada" // fallback to mada for non-Moyasar methods
      : "mada";

  // Optional redirect after successful payment (e.g., /orders/direct/chat/{id})
  const nextUrl = params.get("next");
  const isInternalNext = nextUrl && nextUrl.startsWith("/");

  if (!orderId) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          رقم الطلب غير موجود. ارجع للسلّة وأعد المحاولة.
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto">
      <h2 className="text-lg font-bold text-gray-900 mb-4">إتمام الدفع</h2>
      <MoyasarCheckoutForm
        orderId={orderId}
        totalSar={total}
        paymentMethod={method}
        onPaid={() => {
          const redirectUrl = isInternalNext
            ? nextUrl
            : `/checkout/success?order_id=${encodeURIComponent(orderId)}`;
          router.push(redirectUrl);
        }}
        onError={(msg) => showToast(msg, "error")}
      />
    </div>
  );
}