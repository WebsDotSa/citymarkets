"use client";

/**
 * GuestLoginPrompt
 *
 * Modal that fires when a non-authenticated visitor tries to interact
 * with the chat (type a message, focus the input, pick a suggestion,
 * or hold the mic). Asks for a Saudi phone number, sends the OTP via
 * the auth context's `signIn(...)`, then bounces to /auth/login for
 * the OTP step — keeping a single entrypoint for the OTP flow that
 * every other login surface already shares.
 *
 * Pure presentational: opens/closes / submits are owned by the parent.
 */

import { Loader2, Lock, X } from "lucide-react";

interface GuestLoginPromptProps {
  open: boolean;
  submitting: boolean;
  phone: string;
  onPhoneChange: (value: string) => void;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
}

export function GuestLoginPrompt({
  open,
  submitting,
  phone,
  onPhoneChange,
  error,
  onSubmit,
  onClose,
}: GuestLoginPromptProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-chat-login-title"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="ai-chat-login-title"
                className="text-base font-bold text-gray-900"
              >
                سجّل دخولك للمتابعة
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                أدخل رقم جوالك للمتابعة مع شيف سيتي
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="إغلاق"
            className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 disabled:opacity-40"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
          className="space-y-3"
        >
          <div>
            <label
              htmlFor="ai-chat-login-phone"
              className="block text-xs font-bold text-gray-700 mb-1.5"
            >
              رقم الجوال
            </label>
            <input
              id="ai-chat-login-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                onPhoneChange(e.target.value);
              }}
              placeholder="05xxxxxxxx"
              disabled={submitting}
              dir="ltr"
              className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base text-secondary placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-left"
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2"
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting || !phone.trim()}
            className="w-full h-12 bg-primary text-white rounded-xl font-bold hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2
                  className="w-4 h-4 animate-spin"
                  aria-hidden="true"
                />
                جاري إرسال الرمز…
              </>
            ) : (
              "متابعة"
            )}
          </button>

          <p className="text-[11px] text-gray-400 text-center leading-5">
            بمتابعتك، توافق على{" "}
            <a href="/terms" className="underline hover:text-gray-600">
              الشروط
            </a>{" "}
            و{" "}
            <a href="/privacy" className="underline hover:text-gray-600">
              سياسة الخصوصية
            </a>
            .
          </p>
        </form>
      </div>
    </div>
  );
}
