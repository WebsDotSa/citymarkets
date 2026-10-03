"use client";

import { forwardRef, ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      className = "",
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles = `
      inline-flex items-center justify-center gap-2
      font-semibold rounded-2xl
      transition-all duration-200 ease-out
      focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
      disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
    `;

    const variants = {
      primary: `
        bg-gradient-to-l from-primary to-primary-500
        text-white shadow-lg shadow-primary/25
        hover:shadow-xl hover:shadow-primary/30 hover:from-primary-dark hover:to-primary
        focus-visible:ring-primary
        active:scale-[0.98]
      `,
      secondary: `
        bg-gray-100 text-gray-900
        border border-gray-200
        hover:bg-white hover:border-primary hover:text-primary
        focus-visible:ring-primary
      `,
      outline: `
        bg-transparent text-primary
        border-2 border-primary
        hover:bg-primary hover:text-white
        focus-visible:ring-primary
        active:scale-[0.98]
      `,
      ghost: `
        bg-transparent text-gray-500
        hover:bg-gray-100 hover:text-gray-900
        focus-visible:ring-primary
      `,
      danger: `
        bg-red-100 text-red-600
        hover:bg-red-600 hover:text-white
        focus-visible:ring-red-600
        active:scale-[0.98]
      `,
      success: `
        bg-emerald-100 text-emerald-600
        hover:bg-emerald-600 hover:text-white
        focus-visible:ring-emerald-600
      `,
    };

    const sizes = {
      sm: "px-4 py-2 text-sm rounded-xl",
      md: "px-6 py-3 text-base rounded-2xl",
      lg: "px-8 py-4 text-lg rounded-2xl",
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
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          leftIcon
        )}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  }
);

Button.displayName = "Button";

export { Button };
