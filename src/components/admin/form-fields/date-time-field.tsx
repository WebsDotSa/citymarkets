"use client";

import { FormField } from "../admin-form";

interface DateTimeFieldProps {
  field: FormField;
  value: unknown;
  errorClass: string;
  onChange: (key: string, value: unknown) => void;
  onBlur: (key: string) => void;
}

export function DateTimeField({
  field,
  value,
  errorClass,
  onChange,
  onBlur,
}: DateTimeFieldProps) {
  return (
    <input
      type={field.type}
      id={`field-${field.key}`}
      data-field={field.key}
      name={field.key}
      value={String(value ?? "")}
      onChange={(e) => onChange(field.key, e.target.value)}
      onBlur={() => onBlur(field.key)}
      disabled={field.disabled}
      min={field.min}
      max={field.max}
      className={`admin-input ${errorClass}`}
    />
  );
}
