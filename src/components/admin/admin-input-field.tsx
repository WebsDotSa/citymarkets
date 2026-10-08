"use client";

import { forwardRef, InputHTMLAttributes } from "react";
import { AlertCircle } from "lucide-react";

export interface AdminInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helper?: string;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

const AdminInput = forwardRef<HTMLInputElement, AdminInputProps>(
  (
    {
      label,
      error,
      helper,
      icon,
      fullWidth = true,
      className = "",
      disabled,
      ...props
    },
    ref
  ) => {
    return (
      <div className={fullWidth ? "w-full" : ""}>
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {label}
            {props.required && <span className="text-red-600 ml-1">*</span>}
          </label>
        )}

        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              {icon}
            </div>
          )}

          <input
            ref={ref}
            className={`
              w-full px-4 py-2 text-sm
              border rounded-lg
              transition-all duration-150
              focus:outline-none focus:ring-2
              disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50
              ${icon ? "pl-10" : ""}
              ${
                error
                  ? "border-red-300 focus:ring-red-500/50 focus:border-red-500"
                  : "border-gray-200 focus:ring-primary/30 focus:border-primary"
              }
              ${className}
            `}
            disabled={disabled}
            {...props}
          />
        </div>

        {error && (
          <div className="flex items-center gap-1 mt-1 text-sm text-red-600">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {helper && !error && (
          <p className="mt-1 text-sm text-gray-500">{helper}</p>
        )}
      </div>
    );
  }
);

AdminInput.displayName = "AdminInput";

export { AdminInput };
