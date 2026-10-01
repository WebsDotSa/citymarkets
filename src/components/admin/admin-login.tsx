"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Lock, User, ShieldCheck, Phone, ArrowRight, MessageSquare } from "lucide-react";
import { CityMarketsLogo } from "@/components/brand/city-markets-logo";
import { BRAND } from "@/lib/brand-theme";

type LoginMode = "password" | "phone";

export function AdminLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("password");

  // password-mode fields
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // phone-mode fields
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const switchMode = (next: LoginMode) => {
    setMode(next);
    setError("");
    setCodeSent(false);
    setCode("");
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "password",
          email: identifier.includes("@") ? identifier.toLowerCase() : undefined,
          username: identifier.includes("@") ? undefined : identifier,
          password,
        }),
        credentials: "include",
      });

      const result = await res.json();

      if (result.success) {
        localStorage.setItem("admin_user", JSON.stringify(result.data.user));
        router.push("/admin");
      } else {
        setError(result.error || "فشل تسجيل الدخول");
      }
    } catch (err) {
      setError("حدث خطأ في الاتصال");
    }

    setLoading(false);
  };

  const handleSendCode = async () => {
    if (!phone || phone.replace(/\D/g, "").length < 9) {
      setError("أدخل رقم جوال سعودي صحيح");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "otp", phone }),
        credentials: "include",
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        setError(result.error || "تعذر إرسال رمز التحقق");
      } else {
        setCodeSent(true);
      }
    } catch {
      setError("حدث خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "otp", phone, code }),
        credentials: "include",
      });
      const result = await res.json();
      if (result.success) {
        localStorage.setItem("admin_user", JSON.stringify(result.data.user));
        router.push("/admin");
      } else {
        setError(result.error || "رمز التحقق غير صحيح أو منتهي الصلاحية");
      }
    } catch {
      setError("حدث خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-white to-primary/5 flex items-center justify-center p-4" dir="rtl">
      {/* Background pattern */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <CityMarketsLogo height={48} link={false} />
          </div>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primaryDark flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-secondary">لوحة التحكم</span>
          </div>
        </div>

        {/* Form */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-primary/5 p-8">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-secondary mb-1">مرحباً بك</h1>
            <p className="text-sm text-gray-500">
              {mode === "password"
                ? "سجل دخولك للوصول إلى لوحة التحكم"
                : "أدخل رقم جوالك لتصلك رسالة التحقق"}
            </p>
          </div>

          {/* Mode toggle */}
          <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-gray-50 p-1 border border-gray-200">
            <button
              type="button"
              onClick={() => switchMode("password")}
              className={`h-10 rounded-xl text-sm font-medium transition ${
                mode === "password"
                  ? "bg-white text-secondary shadow-sm"
                  : "text-gray-500 hover:text-secondary"
              }`}
            >
              <span className="inline-flex items-center gap-2 justify-center">
                <Lock className="w-4 h-4" />
                بريد + كلمة مرور
              </span>
            </button>
            <button
              type="button"
              onClick={() => switchMode("phone")}
              className={`h-10 rounded-xl text-sm font-medium transition ${
                mode === "phone"
                  ? "bg-white text-secondary shadow-sm"
                  : "text-gray-500 hover:text-secondary"
              }`}
            >
              <span className="inline-flex items-center gap-2 justify-center">
                <Phone className="w-4 h-4" />
                رقم جوال + رمز
              </span>
            </button>
          </div>

          {error && (
            <div className="mb-5 p-4 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100 flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}

          {mode === "password" ? (
            <form onSubmit={handlePasswordLogin} className="space-y-5">
              <div className="admin-form-group">
                <label className="admin-label">البريد الإلكتروني أو اسم المستخدم</label>
                <div className="relative">
                  <User className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="admin@citymarkets.sa"
                    dir="ltr"
                    autoComplete="username"
                    className="w-full h-12 pr-12 pl-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary focus:bg-white transition-all"
                    required
                  />
                </div>
              </div>

              <div className="admin-form-group">
                <label className="admin-label">كلمة المرور</label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    dir="ltr"
                    autoComplete="current-password"
                    className="w-full h-12 pr-12 pl-12 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary focus:bg-white transition-all"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-gradient-to-r from-primary to-primaryDark text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>جاري تسجيل الدخول...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-5 h-5" />
                    <span>تسجيل الدخول</span>
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={codeSent ? handleOtpLogin : (e) => { e.preventDefault(); void handleSendCode(); }} className="space-y-5">
              <div className="admin-form-group">
                <label className="admin-label">رقم الجوال</label>
                <div className="relative">
                  <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400" dir="ltr">
                    +966
                  </span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="5XXXXXXXX"
                    dir="ltr"
                    disabled={codeSent}
                    className="w-full h-12 pr-12 pl-16 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary focus:bg-white transition-all disabled:opacity-60"
                    required
                  />
                </div>
              </div>

              {codeSent && (
                <div className="admin-form-group">
                  <label className="admin-label">رمز التحقق</label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                    placeholder="••••••"
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    dir="ltr"
                    className="w-full h-14 px-4 bg-gray-50 border border-gray-200 rounded-xl text-center text-2xl tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary focus:bg-white transition-all"
                    required
                  />
                  <p className="text-xs text-gray-400 text-center mt-2">
                    {code.length}/6 — يتم التحقق تلقائياً عند اكتمال الرمز
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-gradient-to-r from-primary to-primaryDark text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>{codeSent ? "جاري التحقق..." : "جاري الإرسال..."}</span>
                  </>
                ) : codeSent ? (
                  <>
                    <ShieldCheck className="w-5 h-5" />
                    <span>تحقق</span>
                  </>
                ) : (
                  <>
                    <MessageSquare className="w-5 h-5" />
                    <span>إرسال رمز التحقق</span>
                    <ArrowRight className="w-4 h-4 rotate-180" />
                  </>
                )}
              </button>

              {codeSent && (
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => { setCodeSent(false); setCode(""); setError(""); }}
                    className="text-primary text-sm hover:underline"
                  >
                    تغيير رقم الجوال
                  </button>
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={loading}
                    className="text-gray-500 text-sm hover:underline disabled:opacity-50"
                  >
                    إعادة إرسال الرمز
                  </button>
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-400">
            © 2026 أسواق سيتي المركزية — جميع الحقوق محفوظة
          </p>
          <Link href="/" className="inline-flex items-center gap-1 mt-2 text-xs text-primary hover:underline">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            العودة للموقع
          </Link>
        </div>
      </div>
    </div>
  );
}
