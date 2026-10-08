"use client";

import { InputHTMLAttributes, ReactNode } from "react";

interface AdminInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  icon?: ReactNode;
}

/**
 * Admin input — consistent input styling across forms.
 * Handles label, error, hint, and icon display.
 *
 * Features:
 * - Consistent gray borders and focus states
 * - Optional label with required indicator
 * - Error message display
 * - Helper hint text
 * - Optional icon support
 *
 * Usage:
 *   <AdminInput
 *     label="اسم المنتج"
 *     name="name"
 *     required
 *     error={errors.name}
 *     hint="الاسم المعروض للعملاء"
 *   />
 */
export function AdminInput({
  label,
  error,
  hint,
  required,
  icon,
  className,
  ...inputProps
}: AdminInputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-900">
          {label}
          {required && <span className="text-red-600 ml-1">*</span>}
        </label>
      )}

      <div className="relative">
        <input
          {...inputProps}
          className={`
            w-full h-11 px-4 border-2 border-gray-200 rounded-lg
            text-sm transition-all
            focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20
            disabled:bg-gray-50 disabled:text-gray-500
            ${error ? "border-red-500 focus:border-red-500 focus:ring-red-500/20" : ""}
            ${icon ? "pr-10" : ""}
            ${className || ""}
          `}
        />
        {icon && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
            {icon}
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 mt-1">{error}</p>
      )}
      {hint && !error && (
        <p className="text-xs text-gray-500 mt-1">{hint}</p>
      )}
    </div>
  );
}
