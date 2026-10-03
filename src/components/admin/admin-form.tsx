"use client";

import { ReactNode, FormHTMLAttributes } from "react";

interface AdminFormProps extends FormHTMLAttributes<HTMLFormElement> {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  isLoading?: boolean;
}

/**
 * Admin form wrapper — consistent form styling across all admin forms.
 * Handles layout, spacing, and submission state.
 *
 * Features:
 * - Consistent card-based form layout
 * - Optional title and subtitle
 * - Loading state handling
 * - RTL-safe design
 *
 * Usage:
 *   <AdminForm
 *     title="إنشاء منتج جديد"
 *     onSubmit={handleSubmit}
 *     isLoading={loading}
 *   >
 *     <FormField name="name" />
 *     <button type="submit">حفظ</button>
 *   </AdminForm>
 */
export function AdminForm({
  title,
  subtitle,
  children,
  onSubmit,
  isLoading,
  ...formProps
}: AdminFormProps) {
  return (
    <form
      {...formProps}
      onSubmit={onSubmit}
      className={`space-y-4 ${formProps.className || ""}`}
    >
      {(title || subtitle) && (
        <div className="mb-6">
          {title && (
            <h2 className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
          )}
          {subtitle && (
            <p className="text-sm text-gray-600 mt-1">
              {subtitle}
            </p>
          )}
        </div>
      )}

      <div className="space-y-4">
        {children}
      </div>

      <style jsx>{`
        form {
          opacity: ${isLoading ? 0.6 : 1};
          pointer-events: ${isLoading ? "none" : "auto"};
          transition: opacity 0.2s;
        }
      `}</style>
    </form>
  );
}
