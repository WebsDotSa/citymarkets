"use client";

import { AlertCircle } from "lucide-react";
import { FormField } from "../admin-form";

interface FormFieldRowProps {
  field: FormField;
  hasError: boolean;
  error: string | undefined;
  children: React.ReactNode;
}

export function FormFieldRow({ field, hasError, error, children }: FormFieldRowProps) {
  return (
    <div className={`${field.colSpan === 2 ? "md:col-span-2" : ""}`}>
      {field.type !== "hidden" && (
        <label
          htmlFor={`field-${field.key}`}
          className="block text-sm font-semibold text-slate-700 mb-1.5"
        >
          {field.label}
          {field.required && (
            <span className="text-red-500 me-1">*</span>
          )}
        </label>
      )}
      {children}
      {hasError && (
        <p className="admin-error">
          <AlertCircle className="w-3 h-3 inline ms-1" />
          {error}
        </p>
      )}
      {field.help && !hasError && (
        <p className="admin-help">{field.help}</p>
      )}
    </div>
  );
}
