"use client";

import { X, Save } from "lucide-react";
import type { ReactNode } from "react";

interface FormLayoutProps {
  title: string;
  subtitle?: string;
  showHeader?: boolean;
  showFooter?: boolean;
  loading?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  variant?: "default" | "card" | "inline";
  formRef: React.RefObject<HTMLFormElement>;
  onSubmit: (e: React.FormEvent) => void;
  /**
   * Optional secondary action rendered between Cancel and Submit — e.g. the
   * generic PreviewButton. Kept here as a render slot so FormLayout doesn't
   * have to know about every button type each form might want.
   */
  secondaryAction?: ReactNode;
  children: React.ReactNode;
}

export function FormLayout({
  title,
  subtitle,
  showHeader = true,
  showFooter = true,
  loading = false,
  submitLabel = "حفظ",
  cancelLabel = "إلغاء",
  onCancel,
  variant = "card",
  formRef,
  onSubmit,
  secondaryAction,
  children,
}: FormLayoutProps) {
  const formActions = (
    <div className="flex items-center justify-end gap-3 mt-6">
      <button
        type="button"
        onClick={onCancel}
        className="admin-btn-outline"
        disabled={loading}
      >
        {cancelLabel}
      </button>
      {secondaryAction}
      <button type="submit" className="admin-btn-primary" disabled={loading}>
        {loading ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span>جاري الحفظ...</span>
          </>
        ) : (
          <>
            <Save className="w-4 h-4" />
            <span>{submitLabel}</span>
          </>
        )}
      </button>
    </div>
  );

  if (variant === "inline") {
    return (
      <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
        {showHeader && (
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
              {subtitle && (
                <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
              )}
            </div>
          </div>
        )}
        <div className="admin-card p-6">{children}</div>
        {showFooter && (
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="admin-btn-outline"
              disabled={loading}
            >
              {cancelLabel}
            </button>
            {secondaryAction}
            <button type="submit" className="admin-btn-primary" disabled={loading}>
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>جاري الحفظ...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>{submitLabel}</span>
                </>
              )}
            </button>
          </div>
        )}
      </form>
    );
  }

  return (
    <div className="max-w-4xl">
      <form ref={formRef} onSubmit={onSubmit}>
        {showHeader && (
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
              {subtitle && (
                <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <div className="admin-card p-6">{children}</div>

        {showFooter && formActions}
      </form>
    </div>
  );
}
