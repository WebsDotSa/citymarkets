import type { ReactNode } from "react";

interface BadgeProps {
  /** Badge content (text or icon) */
  children: ReactNode;
  /** Visual variant */
  variant?: "default" | "primary" | "success" | "warning" | "danger" | "info";
  /** Size */
  size?: "sm" | "md" | "lg";
  /** Additional CSS classes */
  className?: string;
}

/**
 * Unified badge component for storefront + admin.
 *
 * Replaces scattered badge patterns:
 * - Offer badges (%)
 * - Discount badges (خصم)
 * - Stock count badges
 * - Status pills (تقديم، مسلم، إلخ)
 *
 * Features:
 * - Consistent padding and radius (rounded-full for pill style)
 * - Semantic color variants tied to Tailwind tokens
 * - Flexible sizing
 *
 * Usage:
 *   <Badge>خصم 20%</Badge>
 *   <Badge variant="success">متوفر</Badge>
 *   <Badge variant="danger" size="sm">فقد الكمية</Badge>
 */
export function Badge({
  children,
  variant = "default",
  size = "md",
  className = "",
}: BadgeProps) {
  const sizeClasses = {
    sm: "px-2 py-1 text-tiny",
    md: "px-2.5 py-1.5 text-xs",
    lg: "px-3 py-2 text-sm",
  };

  const variantClasses = {
    default: "bg-gray-100 text-gray-700",
    primary: "bg-primary/10 text-primary",
    success: "bg-primary-100 text-primary-700",
    warning: "bg-amber-100 text-amber-700",
    danger: "bg-red-100 text-red-700",
    info: "bg-blue-100 text-blue-700",
  };

  return (
    <span
      className={`inline-flex items-center font-semibold rounded-full ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Colored order status badge.
 *
 * Maps order status to semantic colors.
 * Replaces hardcoded hex colors scattered in order-status-display.ts.
 */
export interface StatusBadgeProps {
  /** Order status key (e.g., "pending", "confirmed", "delivered") */
  status: string;
  /** Optional override for the badge text (default: status label) */
  label?: string;
  /** Additional classes */
  className?: string;
}

// Centralized order status colors (replaces the hardcoded hex in order-status-display.ts)
const STATUS_VARIANTS: Record<
  string,
  { variant: BadgeProps["variant"]; label: string }
> = {
  pending: { variant: "warning", label: "قيد الانتظار" },
  confirmed: { variant: "info", label: "مؤكد" },
  preparing: { variant: "info", label: "قيد التحضير" },
  ready: { variant: "warning", label: "جاهز" },
  out_for_delivery: { variant: "warning", label: "قيد التوصيل" },
  delivered: { variant: "success", label: "مسلم" },
  cancelled: { variant: "danger", label: "ملغي" },
  failed: { variant: "danger", label: "فشل" },
};

export function StatusBadge({
  status,
  label,
  className = "",
}: StatusBadgeProps) {
  const config = STATUS_VARIANTS[status] || {
    variant: "default" as const,
    label: status,
  };

  return (
    <Badge variant={config.variant} size="md" className={className}>
      {label ?? config.label}
    </Badge>
  );
}
