"use client";

import { FormField } from "../admin-form";

interface TextareaFieldProps {
  field: FormField;
  value: unknown;
  errorClass: string;
  onChange: (key: string, value: unknown) => void;
  onBlur: (key: string) => void;
}

export function TextareaField({
  field,
  value,
  errorClass,
  onChange,
  onBlur,
}: TextareaFieldProps) {
  return (
    <textarea
      id={`field-${field.key}`}
      data-field={field.key}
      name={field.key}
      value={String(value ?? "")}
      onChange={(e) => onChange(field.key, e.target.value)}
      onBlur={() => onBlur(field.key)}
      placeholder={field.placeholder}
      rows={field.rows || 4}
      disabled={field.disabled}
      readOnly={field.readOnly}
      maxLength={field.maxLength}
      className={`admin-textarea ${errorClass}`}
      dir="auto"
    />
  );
}
