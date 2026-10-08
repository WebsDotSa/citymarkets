"use client";

import { forwardRef, ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

export interface AdminButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "icon";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

const AdminButton = forwardRef<HTMLButtonElement, AdminButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      isLoading = false,
      icon,
      fullWidth = false,
      className = "",
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles = `
      inline-flex items-center justify-center gap-2
      font-medium rounded-lg
      transition-all duration-150 ease-out
      focus:outline-none focus:ring-2 focus:ring-offset-2
      disabled:opacity-50 disabled:cursor-not-allowed
    `;

    const variants = {
      primary: `
        bg-primary text-white
        hover:bg-primary-700 active:scale-95
        focus:ring-primary/50
      `,
      secondary: `
        bg-gray-100 text-gray-900
        hover:bg-gray-200 active:scale-95
        focus:ring-gray-400
      `,
      outline: `
        bg-white text-gray-700 border border-gray-200
        hover:bg-gray-50 hover:border-gray-300 active:scale-95
        focus:ring-gray-400
      `,
      ghost: `
        bg-transparent text-gray-600
        hover:bg-gray-100 active:bg-gray-200
        focus:ring-gray-400
      `,
      danger: `
        bg-red-600 text-white
        hover:bg-red-700 active:scale-95
        focus:ring-red-600/50
      `,
      icon: `
        bg-transparent text-gray-600
        hover:bg-gray-100 rounded-md
        focus:ring-gray-400
      `,
    };

    const sizes = {
      sm: "px-3 py-1.5 text-sm",
      md: "px-4 py-2 text-sm",
      lg: "px-6 py-3 text-base",
    };

    return (
      <button
        ref={ref}
        className={`
          ${baseStyles}
          ${variants[variant]}
          ${sizes[size]}
          ${fullWidth ? "w-full" : ""}
          ${className}
        `}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          icon
        )}
        {children}
      </button>
    );
  }
);

AdminButton.displayName = "AdminButton";

export { AdminButton };
