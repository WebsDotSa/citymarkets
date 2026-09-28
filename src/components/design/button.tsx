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
        bg-gradient-to-l from-[#009345] to-[#00B359]
        text-white shadow-lg shadow-[#009345]/25
        hover:shadow-xl hover:shadow-[#009345]/30 hover:from-[#007A38] hover:to-[#009345]
        focus-visible:ring-[#009345]
        active:scale-[0.98]
      `,
      secondary: `
        bg-[#F3F4F6] text-[#111827]
        border border-[#E5E7EB]
        hover:bg-white hover:border-primary hover:text-primary
        focus-visible:ring-[#009345]
      `,
      outline: `
        bg-transparent text-primary
        border-2 border-primary
        hover:bg-primary hover:text-white
        focus-visible:ring-[#009345]
        active:scale-[0.98]
      `,
      ghost: `
        bg-transparent text-[#6B7280]
        hover:bg-[#F3F4F6] hover:text-[#111827]
        focus-visible:ring-[#009345]
      `,
      danger: `
        bg-[#FEE2E2] text-[#DC2626]
        hover:bg-[#DC2626] hover:text-white
        focus-visible:ring-[#DC2626]
        active:scale-[0.98]
      `,
      success: `
        bg-[#D1FAE5] text-[#059669]
        hover:bg-[#059669] hover:text-white
        focus-visible:ring-[#059669]
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
