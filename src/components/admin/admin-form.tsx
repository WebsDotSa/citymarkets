"use client";

import { ReactNode, FormHTMLAttributes } from "react";

interface AdminFormField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  help?: string;
}

interface AdminFormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  fields?: AdminFormField[];
  onSubmit?: (data?: Record<string, any>) => void | Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  loading?: boolean;
  initialValues?: Record<string, any>;
}

/**
 * Admin form wrapper — consistent form styling across all admin forms.
 * Handles layout, spacing, and submission state.
 */
export function AdminForm({
  title,
  subtitle,
  children,
  fields,
  onSubmit,
  onCancel,
  isLoading,
  loading,
  initialValues,
  ...formProps
}: AdminFormProps) {
  const isSubmitting = isLoading || loading;

  return (
    <form
      {...formProps}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
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
        {children || (fields && fields.map(field => (
          <div key={field.key}>
            <label className="text-sm font-medium text-gray-900">
              {field.label}
              {field.required && <span className="text-red-600 ml-1">*</span>}
            </label>
            {field.type === "select" ? (
              <select
                name={field.key}
                required={field.required}
                defaultValue={initialValues?.[field.key] || ""}
                className="w-full h-11 px-4 border-2 border-gray-200 rounded-lg text-sm mt-1 focus:outline-none focus:border-primary-500"
              >
                <option value="">اختر...</option>
                {field.options?.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type}
                name={field.key}
                placeholder={field.placeholder}
                required={field.required}
                defaultValue={initialValues?.[field.key] || ""}
                className="w-full h-11 px-4 border-2 border-gray-200 rounded-lg text-sm mt-1 focus:outline-none focus:border-primary-500"
              />
            )}
            {field.help && (
              <p className="text-xs text-gray-500 mt-1">{field.help}</p>
            )}
          </div>
        )))}
      </div>

      {(onSubmit || onCancel) && (
        <div className="flex gap-2 justify-end pt-4">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg hover:bg-gray-200 transition-colors"
            >
              إلغاء
            </button>
          )}
          {onSubmit && (
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {isSubmitting ? "جاري..." : "حفظ"}
            </button>
          )}
        </div>
      )}

      <style jsx>{`
        form {
          opacity: ${isSubmitting ? 0.6 : 1};
          pointer-events: ${isSubmitting ? "none" : "auto"};
          transition: opacity 0.2s;
        }
      `}</style>
    </form>
  );
}
