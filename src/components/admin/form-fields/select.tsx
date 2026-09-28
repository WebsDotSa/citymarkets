"use client";

import { FormField } from "../admin-form";

interface SelectFieldProps {
  field: FormField;
  value: unknown;
  errorClass: string;
  onChange: (key: string, value: unknown) => void;
  onBlur: (key: string) => void;
}

export function SelectField({
  field,
  value,
  errorClass,
  onChange,
  onBlur,
}: SelectFieldProps) {
  return (
    <select
      id={`field-${field.key}`}
      data-field={field.key}
      name={field.key}
      value={String(value ?? "")}
      onChange={(e) => onChange(field.key, e.target.value)}
      onBlur={() => onBlur(field.key)}
      disabled={field.disabled}
      className={`admin-select ${errorClass}`}
    >
      <option value="">
        {field.placeholder || "اختر..."}
      </option>
      {field.options?.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
