"use client";

import { useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CityMarketsLogo } from "@/components/brand/city-markets-logo";
import { useAuthState, useAuthActions } from "@/contexts/auth-context";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import { ArrowRight, Phone, Shield } from "lucide-react";

export function LoginPage() {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { signIn, verifyOtp } = useAuthActions();
  const { twilioOtpEnabled } = useAuthState();
  const searchParams = useSearchParams();
  // Accept both `redirect` (proxy) and legacy `next` so in-flight links
  // and bookmarks keep working.
  const fromParam =
    searchParams.get("redirect") ?? searchParams.get("next");
  const referrer =
    typeof document !== "undefined" && document.referrer
      ? new URL(document.referrer).pathname + new URL(document.referrer).search
      : null;
  const targetPath = sanitizeRedirectPath(
    fromParam ??
      (referrer && referrer !== "/auth/login" && !referrer.startsWith("/auth/")
        ? referrer
        : null)
  );

  // Single-flight + idempotent: refs (not state) — state updates are async
  // and double-submits can otherwise leak past the `loading` check.
  const inFlightRef = useRef(false);
  const succeededRef = useRef(false);

  const handleSendOtp = async () => {
    if (!phone || phone.length < 9) {
      setError("أدخل رقم جوال صحيح");
      return;
    }
    setLoading(true);
    setError("");
    const { error } = await signIn(phone);
    setLoading(false);
    if (error) {
      setError(error);
    } else {
      setStep("otp");
    }
  };

  const submitOtp = async (code: string) => {
    // Collapse the two previous handlers. Two gates:
    //   1. succeededRef: never re-issue after a success (otherwise a stale
    //      change event after the cookie was set would call Twilio, get 400,
    //      and surface "رمز التحقق غير صحيح أو منتهي الصلاحية" while the
    //      header shows the user as logged in).
    //   2. inFlightRef: only one verify request in flight at a time.
    if (succeededRef.current || inFlightRef.current) return;
    if (!code || code.length < 4) {
      setError("أدخل رمز التحقق");
      return;
    }
    inFlightRef.current = true;
    setLoading(true);
    setError("");
    try {
      const { error } = await verifyOtp(phone, code);
      if (error) {
        setError(error);
        setOtp("");
        return;
      }
      succeededRef.current = true;
      // Document-level navigation: ensures the proxy re-runs with the
      // freshly-set customer_session cookie, the auth context re-bootstraps
      // from /api/v1/auth/me, and Server Components see the session.
      window.location.assign(targetPath);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <CityMarketsLogo height={48} href={null} />
          </div>
          <p className="text-gray-500 mt-1">سجّل الدخول للتسوق</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-200/50 p-8">
          {step === "phone" ? (
            <>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                  <Phone className="w-5 h-5 text-primary" />
                </div>
                <h2 className="text-lg font-bold text-secondary">
                  أدخل رقم الجوال
                </h2>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  رقم الجوال
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm">+966</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="5XXXXXXXX"
                    className="flex-1 h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    dir="ltr"
                  />
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
                  {error}
                </div>
              )}

              <button
                onClick={handleSendOtp}
                disabled={loading}
                className="w-full h-12 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>إرسال رمز التحقق</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <p className="text-xs text-gray-400 text-center mt-4">
                بالمتابعة، أنت توافق على{" "}
                <Link href="/terms" className="text-primary hover:underline">
                  الشروط والأحكام
                </Link>
                {" "}و{" "}
                <Link href="/privacy" className="text-primary hover:underline">
                  سياسة الخصوصية
                </Link>
              </p>
              <p className="text-xs text-gray-500 text-center mt-3">
                عندك طلب قديم وتبي تتبعه؟{" "}
                <Link href="/orders/track" className="text-primary font-medium hover:underline">
                  تتبع طلبك هنا
                </Link>
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-accent-2/10 rounded-xl flex items-center justify-center">
                  <Shield className="w-5 h-5 text-accent-2" />
                </div>
                <h2 className="text-lg font-bold text-secondary">
                  رمز التحقق
                </h2>
              </div>

              <p className="text-sm text-gray-500 mb-4">
                أدخل الرمز المرسل إلى{" "}
                <span className="font-medium text-secondary" dir="ltr">
                  {phone}
                </span>
              </p>

              <div className="mb-6">
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setOtp(v);
                    if (v.length === 6) {
                      void submitOtp(v);
                    }
                  }}
                  placeholder="أدخل الرمز"
                  maxLength={6}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  className="w-full h-14 px-4 bg-gray-50 border border-gray-200 rounded-xl text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                  dir="ltr"
                />
                <p className="text-xs text-gray-400 text-center mt-2">
                  {otp.length}/6 — يتحقق تلقائياً عند اكتمال الرمز
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
                  {error}
                </div>
              )}

              <button
                onClick={() => void submitOtp(otp)}
                disabled={loading}
                className="w-full h-12 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>تحقق</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <button
                onClick={() => setStep("phone")}
                className="w-full mt-3 h-12 text-primary font-medium text-sm hover:underline"
              >
                تغيير رقم الجوال
              </button>

              {!twilioOtpEnabled && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-600">
                  💡 وضع التطوير: أدخل أي رمز للدخول
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
