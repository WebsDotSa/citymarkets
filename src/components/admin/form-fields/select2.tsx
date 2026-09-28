"use client";

import { AlertCircle } from "lucide-react";
import { FormField } from "../admin-form";
import { SearchableSelect } from "../SearchableSelect";

interface Select2FieldProps {
  field: FormField;
  value: unknown;
  errorClass: string;
  hasError: boolean;
  error: string | undefined;
}

export function Select2Field({
  field,
  value,
  errorClass,
  hasError,
  error,
}: Select2FieldProps) {
  const stringValue = value == null ? "" : String(value);
  return (
    <div className="space-y-1">
      <SearchableSelect
        id={`select2-${field.key}`}
        value={stringValue}
        onChange={(v) => {
          if (field.onChange) field.onChange(v, field.key);
        }}
        options={field.options ?? []}
        placeholder={field.placeholder || "اختر..."}
        disabled={field.disabled}
        required={field.required}
        allowClear={field.allowClear ?? true}
        searchable={field.searchable ?? true}
        className={errorClass}
      />
      {hasError && (
        <p className="admin-error">
          <AlertCircle className="w-3 h-3 inline" />
          {error}
        </p>
      )}
    </div>
  );
}