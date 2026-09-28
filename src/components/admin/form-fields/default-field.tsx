"use client";

import { FormField } from "../admin-form";

interface DefaultFieldProps {
  field: FormField;
  value: unknown;
  errorClass: string;
  onChange: (key: string, value: unknown) => void;
  onBlur: (key: string) => void;
}

export function DefaultField({
  field,
  value,
  errorClass,
  onChange,
  onBlur,
}: DefaultFieldProps) {
  return (
    <input
      type={field.type}
      id={`field-${field.key}`}
      data-field={field.key}
      name={field.key}
      value={String(value ?? "")}
      onChange={(e) =>
        onChange(
          field.key,
          field.type === "number"
            ? parseFloat(e.target.value) || 0
            : e.target.value
        )
      }
      onBlur={() => onBlur(field.key)}
      placeholder={field.placeholder}
      disabled={field.disabled}
      readOnly={field.readOnly}
      min={field.min}
      max={field.max}
      step={field.step}
      maxLength={field.maxLength}
      dir={field.type === "email" || field.type === "tel" ? "ltr" : "rtl"}
      className={`admin-input ${errorClass}`}
    />
  );
}
