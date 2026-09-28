"use client";

import { Eye, EyeOff } from "lucide-react";
import { FormField } from "../admin-form";

interface PasswordFieldProps {
  field: FormField;
  value: unknown;
  errorClass: string;
  showPassword: boolean;
  onChange: (key: string, value: unknown) => void;
  onBlur: (key: string) => void;
  onToggleVisibility: (key: string) => void;
}

export function PasswordField({
  field,
  value,
  errorClass,
  showPassword,
  onChange,
  onBlur,
  onToggleVisibility,
}: PasswordFieldProps) {
  return (
    <div className="relative">
      <input
        type={showPassword ? "text" : "password"}
        id={`field-${field.key}`}
        data-field={field.key}
        name={field.key}
        value={String(value ?? "")}
        onChange={(e) => onChange(field.key, e.target.value)}
        onBlur={() => onBlur(field.key)}
        placeholder={field.placeholder}
        disabled={field.disabled}
        className={`admin-input pl-10 ${errorClass}`}
      />
      <button
        type="button"
        onClick={() => onToggleVisibility(field.key)}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
      >
        {showPassword ? (
          <EyeOff className="w-4 h-4" />
        ) : (
          <Eye className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}
