"use client";

import { FormField } from "../admin-form";

interface SwitchFieldProps {
  field: FormField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}

export function SwitchField({ field, value, onChange }: SwitchFieldProps) {
  return (
    <label className="flex items-center gap-3 cursor-pointer min-h-[2.75rem]">
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(field.key, e.target.checked)}
        disabled={field.disabled}
        className="admin-toggle-input"
      />
      <span className="admin-toggle-slider" />
      <span className="text-sm text-slate-600">{field.placeholder}</span>
    </label>
  );
}
