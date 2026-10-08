"use client";

import { ReactNode, FormHTMLAttributes, useState } from "react";

export interface AdminFormField {
  key: string;
  label: string;
  type:
    | "text"
    | "number"
    | "textarea"
    | "select"
    | "select2"
    | "multiselect"
    | "image"
    | "images"
    | "checkbox"
    | "password"
    | "email"
    | "tel"
    | "color"
    | "date"
    | "time"
    | "datetime"
    | "editor"
    | "file"
    | "switch"
    | "hidden";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  help?: string;
  colSpan?: 1 | 2;
  defaultValue?: unknown;
  disabled?: boolean;
  readOnly?: boolean;
  min?: number;
  max?: number;
  step?: number;
  accept?: string;
  maxLength?: number;
  rows?: number;
  searchable?: boolean;
  allowClear?: boolean;
  onChange?: (value: unknown, key: string) => void;
  className?: string;
  validate?: (value: unknown) => string | null;
}

export type FormField = AdminFormField;

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
  previewTitle?: string;
  renderPreview?: (data: Record<string, any>) => ReactNode;
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
  previewTitle,
  renderPreview,
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
    <div className={`${renderPreview ? 'grid grid-cols-1 lg:grid-cols-2 gap-6' : ''}`}>
      <form
        {...formProps}
        onSubmit={handleSubmit}
        className={`space-y-4 ${formProps.className || ""} ${submitting ? 'opacity-60 pointer-events-none' : ''}`}
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

      {renderPreview && (
        <div className="sticky top-4 h-fit">
          {previewTitle && (
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{previewTitle}</h3>
          )}
          <div className="bg-gray-50 rounded-xl p-4 overflow-auto max-h-[calc(100vh-200px)]">
            {renderPreview(formData)}
          </div>
        </div>
      )}
    </div>
  );
}
