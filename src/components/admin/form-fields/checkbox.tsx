"use client";

import { FormField } from "../admin-form";

interface CheckboxFieldProps {
  field: FormField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}

export function CheckboxField({ field, value, onChange }: CheckboxFieldProps) {
  return (
    <label className="flex items-center gap-3 cursor-pointer min-h-[2.75rem]">
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(field.key, e.target.checked)}
        disabled={field.disabled}
        className="admin-checkbox"
      />
      <span className="text-sm text-gray-600">{field.placeholder}</span>
    </label>
  );
}
