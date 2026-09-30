"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { Loader2, AlertCircle } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { error as logError } from "@/lib/logger";
import type { ONLINE_RETRY_METHODS } from "@/lib/payments/payment-methods";

const MOYASAR_JS = "https://cdn.jsdelivr.net/npm/moyasar-payment-form@2.2.9/dist/moyasar.umd.min.js";
const MOYASAR_CSS = "https://cdn.jsdelivr.net/npm/moyasar-payment-form@2.2.9/dist/moyasar.css";

/**
 * Methods the inline Moyasar form can capture: the canonical
 * `ONLINE_RETRY_METHODS` tuple (card brands + Apple Pay) plus the LEGACY
 * `stc_pay` token, which `/checkout/pay?method=stc_pay` deep links from
 * before the 2026-09-20 picker change can still carry.
 */
export type CheckoutMoyasarMethod = (typeof ONLINE_RETRY_METHODS)[number] | "stc_pay";

interface MoyasarConfig {
  publishable_api_key: string;
  site_url: string;
  apple_pay_label: string;
  apple_pay_validate_url: string;
  currency: string;
  language: string;
}

interface MoyasarPayment {
  id: string;
  status: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
}

declare global {
  interface Window {
    Moyasar?: {
      init: (config: Record<string, unknown>) => void;
    };
  }
}

function toHalalas(sar: number): number {
  return Math.max(100, Math.round(sar * 100));
}

function mapMethods(method: CheckoutMoyasarMethod): {
  methods: string[];
  supported_networks?: string[];
  apple_pay?: Record<string, string>;
} {
  switch (method) {
    case "apple_pay":
      return { methods: ["applepay"] };
    case "stc_pay":
      return { methods: ["stcpay"] };
    case "mada":
      return {
        methods: ["creditcard"],
        supported_networks: ["mada"],
      };
    case "mastercard":
      return {
        methods: ["creditcard"],
        supported_networks: ["mastercard"],
      };
    case "amex":
      return {
        methods: ["creditcard"],
        supported_networks: ["amex"],
      };
    case "visa":
    default:
      return {
        methods: ["creditcard"],
        supported_networks: ["visa", "mastercard", "mada"],
      };
  }
}

interface MoyasarCheckoutFormProps {
  orderId: string;
  totalSar: number;
  paymentMethod: CheckoutMoyasarMethod;
  onPaid: () => void;
  onError?: (message: string) => void;
}

export function MoyasarCheckoutForm({
  orderId,
  totalSar,
  paymentMethod,
  onPaid,
  onError,
}: MoyasarCheckoutFormProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const paymentKeyRef = useRef<string | null>(null);
  const [scriptsReady, setScriptsReady] = useState(false);
  const [config, setConfig] = useState<MoyasarConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/payments/moyasar/config");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success) {
          setLoadError(data.error || "تعذّر تحميل إعدادات الدفع");
          return;
        }
        setConfig(data as MoyasarConfig);
      } catch {
        if (!cancelled) {
          setLoadError("تعذّر الاتصال بخادم الدفع");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const savePayment = useCallback(
    async (payment: MoyasarPayment) => {
      setConfirming(true);
      setPayError(null);
      try {
        // لا نوقف تدفق الدفع داخل MPF: قد تكون الحالة initiated وتحتاج تحويل/3DS.
        const res = await fetch("/api/v1/payments/moyasar/confirm", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: orderId,
            payment_id: payment.id,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          const msg = data.error || "تعذّر تأكيد الدفع";
          setPayError(msg);
          onError?.(msg);
          return false;
        }
        if (data.payment_status === "paid") {
          onPaid();
          return true;
        }
        // pending/initiated: سيتم الإكمال عبر التحويل ثم التحقق في صفحة success.
        return true;
      } catch {
        const msg = "تعذّر الاتصال أثناء تأكيد الدفع";
        setPayError(msg);
        onError?.(msg);
        return false;
      } finally {
        setConfirming(false);
      }
    },
    [orderId, onPaid, onError]
  );

  const paymentKey = `${orderId}:${paymentMethod}:${totalSar}`;

  useEffect(() => {
    if (!scriptsReady || !config || !containerRef.current) return;

    if (paymentKeyRef.current !== paymentKey) {
      paymentKeyRef.current = paymentKey;
      initializedRef.current = false;
      containerRef.current.innerHTML = "";
    }

    if (initializedRef.current) return;
    if (!window.Moyasar?.init) return;

    const el = containerRef.current;
    const amount = toHalalas(totalSar);
    const callbackUrl = `${config.site_url}/checkout/success?order_id=${encodeURIComponent(orderId)}`;
    const methodConfig = mapMethods(paymentMethod);
    const description = `طلب سيتي ماركت #${orderId.replace(/-/g, "").slice(-8).toUpperCase()}`;

    const initConfig: Record<string, unknown> = {
      element: el,
      amount,
      currency: config.currency || "SAR",
      description,
      publishable_api_key: config.publishable_api_key,
      callback_url: callbackUrl,
      language: config.language || "ar",
      fixed_width: false,
      metadata: { order_id: orderId },
      methods: methodConfig.methods,
      on_completed: async function (payment: MoyasarPayment) {
        // احفظ payment_id بدون تعطيل إعادة التوجيه التي يقوم بها MPF
        void savePayment(payment);
      },
      on_redirect: async function (url: string) {
        window.location.href = url;
      },
      on_failure: async function (error: string) {
        const msg =
          typeof error === "string" && error
            ? error
            : "فشل الدفع، حاول مرة أخرى";
        setPayError(msg);
        onError?.(msg);
      },
    };

    if (methodConfig.supported_networks) {
      initConfig.supported_networks = methodConfig.supported_networks;
    }

    if (paymentMethod === "apple_pay") {
      initConfig.apple_pay = {
        country: "SA",
        label: config.apple_pay_label,
        validate_merchant_url: config.apple_pay_validate_url,
      };
    }

    try {
      initializedRef.current = true;
      window.Moyasar.init(initConfig);
    } catch (err) {
      initializedRef.current = false;
      // Audit I39: canonical logger.
      logError("Moyasar.init failed", err);
      setLoadError("تعذّر تهيئة نموذج الدفع");
    }
  }, [
    scriptsReady,
    config,
    paymentKey,
    orderId,
    totalSar,
    paymentMethod,
    savePayment,
    onError,
  ]);

  const methodLabel =
    paymentMethod === "apple_pay"
      ? "Apple Pay"
      : paymentMethod === "stc_pay"
        ? "STC Pay"
        : paymentMethod === "mada"
          ? "مدى"
          : "بطاقة ائتمان";

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex gap-2">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span>{loadError}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <link rel="stylesheet" href={MOYASAR_CSS} />
      <Script
        src={MOYASAR_JS}
        strategy="afterInteractive"
        onLoad={() => setScriptsReady(true)}
        onError={() => setLoadError("تعذّر تحميل مكتبة الدفع")}
      />

      <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 text-sm">
        <p className="font-semibold text-secondary mb-1">إتمام الدفع — {methodLabel}</p>
        <p className="text-gray-600">
          المبلغ المستحق:{" "}
          <span className="font-bold text-primary">{formatPrice(totalSar)}</span>
        </p>
        <p className="text-xs text-gray-500 mt-2">
          الدفع يتم هنا مباشرة دون مغادرة الموقع.
        </p>
      </div>

      {(confirming || !config || !scriptsReady) && (
        <div className="flex items-center justify-center gap-2 py-6 text-gray-500 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span>{confirming ? "جاري تأكيد الدفع..." : "جاري تحميل نموذج الدفع..."}</span>
        </div>
      )}

      <div
        ref={containerRef}
        className="moyasar-checkout-root min-h-[120px] [&_.mysr-form]:!max-w-none"
        dir="ltr"
      />

      {payError && (
        <p className="text-sm text-red-600 text-center">{payError}</p>
      )}
    </div>
  );
}
