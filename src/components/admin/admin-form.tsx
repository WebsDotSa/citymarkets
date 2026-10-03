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

interface AdminFormProps extends FormHTMLAttributes<HTMLFormElement> {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  fields?: AdminFormField[];
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
 * - Support for automatic field rendering (fields prop)
 * - Or manual children rendering
 * - RTL-safe design
 *
 * Usage (manual):
 *   <AdminForm
 *     title="إنشاء منتج جديد"
 *     onSubmit={handleSubmit}
 *     isLoading={loading}
 *   >
 *     <FormField name="name" />
 *     <button type="submit">حفظ</button>
 *   </AdminForm>
 *
 * Usage (automatic):
 *   <AdminForm
 *     title="إنشاء كوبون"
 *     fields={[
 *       { key: "code", label: "الكود", type: "text", required: true }
 *     ]}
 *   />
 */
export function AdminForm({
  title,
  subtitle,
  children,
  fields,
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
                className="w-full h-11 px-4 border-2 border-gray-200 rounded-lg text-sm mt-1 focus:outline-none focus:border-primary-500"
              />
            )}
            {field.help && (
              <p className="text-xs text-gray-500 mt-1">{field.help}</p>
            )}
          </div>
        )))}
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
