"use client";

import { FormField } from "../admin-form";

interface ColorFieldProps {
  field: FormField;
  value: unknown;
  errorClass: string;
  onChange: (key: string, value: unknown) => void;
}

export function ColorField({
  field,
  value,
  errorClass,
  onChange,
}: ColorFieldProps) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="color"
        value={(value as string) || "#009345"}
        onChange={(e) => onChange(field.key, e.target.value)}
        className="w-12 h-12 rounded-xl cursor-pointer border-0 bg-transparent"
      />
      <input
        type="text"
        id={`field-${field.key}`}
        data-field={field.key}
        name={field.key}
        value={String(value ?? "")}
        onChange={(e) => onChange(field.key, e.target.value)}
        placeholder="#009345"
        className={`admin-input flex-1 ${errorClass}`}
      />
    </div>
  );
}
