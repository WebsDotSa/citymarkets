"use client";

import { useState, useEffect, useRef, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Lock,
  Mail,
  Phone,
  Store,
  Shield,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { csrfFetch } from "@/lib/csrf-client";

interface LoginPageProps {
  params: Promise<{ slug: string }>;
}

type Tab = "password" | "otp";
type OtpStep = "phone" | "code";

export default function VendorLoginPage({ params }: LoginPageProps) {
  const { slug } = use(params);
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("password");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Password form state (existing flow, untouched).
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  // OTP form state (Phase 3).
  const [otpStep, setOtpStep] = useState<OtpStep>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  // Single-flight + idempotent: refs (not state) — state updates are
  // async and double-submits can otherwise leak past the `loading`
  // check. Mirrors the customer login pattern.
  const inFlightRef = useRef(false);
  const succeededRef = useRef(false);

  useEffect(() => {
    // Check if already logged in
    checkExistingSession();
  }, [slug]);

  async function checkExistingSession() {
    try {
      const res = await fetch("/api/v1/vendor/auth/me", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user?.vendor?.slug === slug) {
          router.replace(`/vendor/${slug}/admin`);
        }
      }
    } catch {
      // Continue to login
    }
  }

  // ───────────────────────── Password tab ─────────────────────────

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const trimmed = identifier.trim();
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
      const isPhone = /^(\+?966|0)?5\d{8}$/.test(trimmed.replace(/[\s-]/g, ""));
      if (!isEmail && !isPhone) {
        setError("أدخل بريد إلكتروني أو رقم جوال سعودي صحيح");
        setLoading(false);
        return;
      }
      const res = await csrfFetch("/api/v1/vendor/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          identifier: trimmed,
          password,
          vendorSlug: slug,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "فشل تسجيل الدخول");
        return;
      }

      router.push(`/vendor/${slug}/admin`);
    } catch {
      setError("حدث خطأ، حاول مرة أخرى");
    } finally {
      setLoading(false);
    }
  }

  // ─────────────────────────── OTP tab ────────────────────────────

  async function handleSendOtp() {
    if (inFlightRef.current || succeededRef.current) return;
    if (!phone || phone.length < 9) {
      setError("أدخل رقم جوال سعودي صحيح");
      return;
    }
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/vendor/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, vendorSlug: slug }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 503 → force the user back to the password tab (Twilio down).
        if (res.status === 503) {
          setError(
            (data.error || "خدمة التحقق غير مهيأة") +
              " — استخدم كلمة المرور بدلاً من ذلك",
          );
          setTab("password");
          return;
        }
        setError(data.error || "تعذر إرسال رمز التحقق");
        return;
      }
      setOtpStep("code");
    } catch {
      setError("حدث خطأ، حاول مرة أخرى");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }

  async function submitOtp(code: string) {
    if (succeededRef.current || inFlightRef.current) return;
    if (!code || code.length < 4) {
      setError("أدخل رمز التحقق");
      return;
    }
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await csrfFetch("/api/v1/vendor/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone, code, vendorSlug: slug }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "رمز التحقق غير صحيح");
        setOtp("");
        return;
      }
      succeededRef.current = true;
      router.push(`/vendor/${slug}/admin`);
    } catch {
      setError("حدث خطأ، حاول مرة أخرى");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Store className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">لوحة تحكم المتجر</h1>
          <p className="text-gray-500 mt-1">سجل دخولك للوصول لإدارة متجرك</p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-xl p-2 mb-3 flex">
          <button
            type="button"
            onClick={() => {
              setTab("password");
              setError(null);
            }}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === "password"
                ? "bg-primary text-white"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            كلمة المرور
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("otp");
              setError(null);
              setOtpStep("phone");
            }}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === "otp"
                ? "bg-primary text-white"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            رمز التحقق
          </button>
        </div>

        {/* Error banner (shared across both tabs) */}
        {error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* Tab body */}
        {tab === "password" ? (
          <form
            onSubmit={handlePasswordSubmit}
            className="bg-white rounded-2xl shadow-xl p-6 space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                البريد الإلكتروني أو رقم الجوال
              </label>
              <div className="relative">
                <Mail className="absolute end-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  inputMode="email"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full pe-11 ps-4 py-3 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
                  placeholder="owner@store.com أو 5XXXXXXXX"
                  dir="ltr"
                  autoComplete="username"
                  required
                />
              </div>
              <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1.5">
                <Phone className="w-3 h-3" />
                رقم جوال المالك (المسجّل في بيانات المتجر) أو البريد الإلكتروني.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                كلمة المرور
              </label>
              <div className="relative">
                <Lock className="absolute end-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pe-11 ps-4 py-3 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
                  placeholder="••••••••"
                  dir="ltr"
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  تسجيل الدخول
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        ) : otpStep === "phone" ? (
          <div className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <Phone className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-base font-bold text-gray-900">
                أدخل رقم جوالك
              </h2>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                رقم الجوال
              </label>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm shrink-0">+966</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="5XXXXXXXX"
                  className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
                  dir="ltr"
                  inputMode="tel"
                  autoComplete="tel"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1.5">
                <Phone className="w-3 h-3" />
                يجب أن يكون الرقم مسجّلاً في ملف مالك/موظف المتجر.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleSendOtp()}
              disabled={loading}
              className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  إرسال رمز التحقق
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-base font-bold text-gray-900">رمز التحقق</h2>
            </div>

            <p className="text-sm text-gray-500">
              أدخل الرمز المرسل إلى{" "}
              <span className="font-medium text-gray-900" dir="ltr">
                +966{phone}
              </span>
            </p>

            <div>
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
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-center text-2xl tracking-[0.5em] font-mono"
                dir="ltr"
              />
              <p className="text-xs text-gray-400 text-center mt-2">
                {otp.length}/6 — يتحقق تلقائياً عند اكتمال الرمز
              </p>
            </div>

            <button
              type="button"
              onClick={() => void submitOtp(otp)}
              disabled={loading}
              className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  تحقق
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setOtpStep("phone");
                setOtp("");
                setError(null);
              }}
              className="w-full py-2 text-primary text-sm font-medium hover:underline"
            >
              تغيير رقم الجوال
            </button>
          </div>
        )}

        <p className="text-center text-sm text-gray-500 mt-4">
          <Link href="/" className="text-primary hover:underline">
            العودة للرئيسية
          </Link>
        </p>
      </div>
    </div>
  );
}
