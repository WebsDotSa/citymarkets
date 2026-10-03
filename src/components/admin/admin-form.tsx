"use client";

import { ReactNode, FormHTMLAttributes, useState } from "react";

export interface AdminFormField {
  key: string;
  label: string;
  type: "text" | "email" | "tel" | "number" | "select" | "textarea" | "checkbox";
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
  initialValues?: Record<string, any>;
  onSubmit?: (data: Record<string, any>) => void | Promise<void>;
  onCancel?: () => void;
  loading?: boolean;
  isLoading?: boolean;
}

export function AdminForm({
  title,
  subtitle,
  children,
  fields,
  initialValues = {},
  onSubmit,
  onCancel,
  loading,
  isLoading,
  ...formProps
}: AdminFormProps) {
  const [formData, setFormData] = useState(initialValues);
  const submitting = loading || isLoading;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await onSubmit?.(formData);
  };

  const handleInputChange = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  return (
    <form
      {...formProps}
      onSubmit={handleSubmit}
      style={{ opacity: submitting ? 0.6 : 1, pointerEvents: submitting ? "none" : "auto" }}
      className={`space-y-4 ${formProps.className || ""}`}
    >
      {(title || subtitle) && (
        <div className="mb-6">
          {title && <h2 className="text-lg font-semibold text-gray-900">{title}</h2>}
          {subtitle && <p className="text-sm text-gray-600 mt-1">{subtitle}</p>}
        </div>
      )}

      <div className="space-y-4">
        {children ||
          (fields?.map(field => (
            <div key={field.key}>
              {field.type === "checkbox" ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name={field.key}
                    checked={formData[field.key] || false}
                    onChange={e => handleInputChange(field.key, e.target.checked)}
                    className="w-4 h-4 border-2 border-gray-200 rounded text-primary"
                  />
                  <span className="text-sm font-medium text-gray-900">{field.label}</span>
                </label>
              ) : (
                <>
                  <label className="text-sm font-medium text-gray-900">
                    {field.label}
                    {field.required && <span className="text-red-600 ml-1">*</span>}
                  </label>
                  {field.type === "textarea" ? (
                    <textarea
                      name={field.key}
                      placeholder={field.placeholder}
                      required={field.required}
                      value={formData[field.key] || ""}
                      onChange={e => handleInputChange(field.key, e.target.value)}
                      className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg text-sm mt-1 focus:outline-none focus:border-primary-500"
                    />
                  ) : field.type === "select" ? (
                    <select
                      name={field.key}
                      required={field.required}
                      value={formData[field.key] || ""}
                      onChange={e => handleInputChange(field.key, e.target.value)}
                      className="w-full h-11 px-4 border-2 border-gray-200 rounded-lg text-sm mt-1 focus:outline-none focus:border-primary-500"
                    >
                      <option value="">اختر...</option>
                      {field.options?.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      name={field.key}
                      placeholder={field.placeholder}
                      required={field.required}
                      value={formData[field.key] || ""}
                      onChange={e => handleInputChange(field.key, e.target.value)}
                      className="w-full h-11 px-4 border-2 border-gray-200 rounded-lg text-sm mt-1 focus:outline-none focus:border-primary-500"
                    />
                  )}
                  {field.help && <p className="text-xs text-gray-500 mt-1">{field.help}</p>}
                </>
              )}
            </div>
          )))}
      </div>

      {(onSubmit || onCancel) && (
        <div className="flex gap-2 justify-end pt-4 border-t border-gray-200">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg hover:bg-gray-200"
            >
              إلغاء
            </button>
          )}
          {onSubmit && (
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50"
            >
              {submitting ? "جاري..." : "حفظ"}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
