"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  User,
  Phone,
  Mail,
  ChevronRight,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useAuthState, useAuthActions } from "@/contexts/auth-context";
import { apiFetch } from '@/lib/catalog';
import { formatPhone } from "@/lib/format";

interface ProfileResponse {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  loyalty_points: number;
  loyalty_tier: string;
  created_at: string;
}

type FormState = "idle" | "saving" | "success" | "error";

export function ProfileEdit() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuthState();
  const { refreshUser } = useAuthActions();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [originalEmail, setOriginalEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push("/auth/login?redirect=/profile/edit");
      return;
    }

    const ac = new AbortController();
    (async () => {
      try {
        const res = await apiFetch<ProfileResponse>("/api/v1/profile", {
          signal: ac.signal,
        });
        if (res.success && res.data) {
          const nextName = res.data.name ?? "";
          const nextEmail = res.data.email ?? "";
          setName(nextName);
          setEmail(nextEmail);
          setOriginalName(nextName);
          setOriginalEmail(nextEmail);
          setPhone(res.data.phone ?? user.phone ?? "");
        }
      } catch {
        // fall back to cached user data so the form still renders
        setName(user.name ?? "");
        setEmail(user.email ?? "");
        setOriginalName(user.name ?? "");
        setOriginalEmail(user.email ?? "");
        setPhone(user.phone ?? "");
      } finally {
        setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [user, authLoading, router]);

  const dirty =
    name.trim() !== originalName.trim() ||
    email.trim() !== originalEmail.trim();

  const emailValid = email.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const canSubmit = dirty && emailValid && state !== "saving";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setState("saving");
    setErrorMessage(null);

    try {
      const res = await apiFetch("/api/v1/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || null,
        }),
      });

      if (res.success) {
        setOriginalName(name.trim());
        setOriginalEmail(email.trim());
        setState("success");
        await refreshUser();
        // brief confirmation, then reset to idle
        window.setTimeout(() => setState("idle"), 2500);
      } else {
        setState("error");
        setErrorMessage(res.error ?? "فشل تحديث البيانات");
      }
    } catch {
      setState("error");
      setErrorMessage("تعذر الاتصال بالخادم");
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary-600/30 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link
            href="/profile"
            className="p-2 -me-2 hover:bg-gray-100 rounded-xl transition-colors"
            aria-label="العودة إلى الحساب"
          >
            <ChevronRight className="w-6 h-6 text-gray-600" />
          </Link>
          <h1 className="text-lg font-bold text-gray-900">تعديل المعلومات</h1>
          <div className="w-10" />
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="px-4 py-6 max-w-4xl mx-auto space-y-4"
        noValidate
      >
        {/* Phone (read-only) */}
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
              <Phone className="w-5 h-5 text-primary-700" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">رقم الجوال</p>
              <p className="text-xs text-gray-500">
                رقم الجوال هو مفتاح حسابك ولا يمكن تغييره من هنا
              </p>
            </div>
          </div>
          <div
            dir="ltr"
            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-700 font-mono text-lg tracking-wide"
            aria-readonly="true"
          >
            {formatPhone(phone || "")}
          </div>
          <Link
            href="/profile/security"
            className="inline-flex items-center gap-1 text-sm text-primary-700 hover:text-primary-800"
          >
            <span>تغيير رقم الجوال</span>
            <ChevronRight className="w-4 h-4 rotate-180" />
          </Link>
        </div>

        {/* Editable fields */}
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-5">
          {/* Name */}
          <div className="space-y-2">
            <label
              htmlFor="profile-name"
              className="flex items-center gap-2 text-sm font-semibold text-gray-900"
            >
              <User className="w-4 h-4 text-gray-500" />
              <span>الاسم الكامل</span>
            </label>
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (state === "error" || state === "success") setState("idle");
              }}
              maxLength={80}
              autoComplete="name"
              placeholder="أدخل اسمك الكامل"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Email */}
          <div className="space-y-2">
            <label
              htmlFor="profile-email"
              className="flex items-center gap-2 text-sm font-semibold text-gray-900"
            >
              <Mail className="w-4 h-4 text-gray-500" />
              <span>البريد الإلكتروني</span>
              <span className="text-xs text-gray-400 font-normal">(اختياري)</span>
            </label>
            <input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (state === "error" || state === "success") setState("idle");
              }}
              dir="ltr"
              maxLength={120}
              autoComplete="email"
              placeholder="example@email.com"
              className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:border-transparent ${
                emailValid
                  ? "border-gray-200 focus:ring-primary-500"
                  : "border-red-300 focus:ring-red-400 bg-red-50"
              }`}
            />
            {!emailValid && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>صيغة البريد الإلكتروني غير صحيحة</span>
              </p>
            )}
          </div>
        </div>

        {/* Status messages */}
        {state === "success" && (
          <div
            role="status"
            className="flex items-center gap-2 p-3 bg-primary-50 border border-primary-200 rounded-xl text-primary-800 text-sm"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>تم حفظ التعديلات بنجاح</span>
          </div>
        )}

        {state === "error" && errorMessage && (
          <div
            role="alert"
            className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm"
          >
            <AlertCircle className="w-5 h-5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {state === "saving" ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>جاري الحفظ...</span>
            </>
          ) : (
            <>
              <Save className="w-5 h-5" />
              <span>حفظ التعديلات</span>
            </>
          )}
        </button>

        {!dirty && state === "idle" && (
          <p className="text-center text-xs text-gray-400">
            لم تقم بأي تغيير بعد
          </p>
        )}
      </form>
    </div>
  );
}