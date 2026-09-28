"use client";

import { AlertCircle } from "lucide-react";
import { FormField } from "../admin-form";

interface MultiselectFieldProps {
  field: FormField;
  value: unknown;
  errorClass: string;
  hasError: boolean;
  error: string | undefined;
}

export function MultiselectField({
  field,
  value,
  errorClass,
  hasError,
  error,
}: MultiselectFieldProps) {
  return (
    <div className="space-y-1">
      <select
        id={`select2-${field.key}`}
        data-field={field.key}
        name={field.key}
        multiple
        value={(value as string[]) || []}
        disabled={field.disabled}
        className={`w-full ${errorClass}`}
      >
        {field.options?.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {hasError && (
        <p className="admin-error">
          <AlertCircle className="w-3 h-3 inline" />
          {error}
        </p>
      )}
    </div>
  );
}
