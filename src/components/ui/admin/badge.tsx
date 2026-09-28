"use client";

import { ReactNode } from "react";
import {
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Clock, Truck } from "@/components/ui/admin/icons";

type BadgeVariant = "default" | "primary" | "success" | "warning" | "danger" | "info";

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  dot?: boolean;
  className?: string;
}

export function Badge({
  children,
  variant = "default",
  size = "md",
  icon,
  dot = false,
  className = "",
}: BadgeProps) {
  const variants = {
    default: "bg-slate-100 text-slate-600",
    primary: "bg-primary/10 text-primary",
    success: "bg-primary-100 text-primary-700",
    warning: "bg-amber-100 text-amber-700",
    danger: "bg-red-100 text-red-700",
    info: "bg-blue-100 text-blue-700",
  };

  const sizes = {
    sm: "px-1.5 py-0.5 text-[10px]",
    md: "px-2.5 py-1 text-xs",
    lg: "px-3 py-1.5 text-sm",
  };

  return (
    <span
      className={`
        inline-flex items-center gap-1 font-semibold rounded-lg
        ${variants[variant]}
        ${sizes[size]}
        ${className}
      `}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            variant === "default"
              ? "bg-slate-400"
              : variant === "primary"
              ? "bg-primary"
              : variant === "success"
              ? "bg-primary-500"
              : variant === "warning"
              ? "bg-amber-500"
              : variant === "danger"
              ? "bg-red-500"
              : "bg-blue-500"
          }`}
        />
      )}
      {icon}
      {children}
    </span>
  );
}

// Status Badge with icon
interface StatusBadgeProps {
  status: "pending" | "confirmed" | "processing" | "completed" | "cancelled" | "refunded" | string;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className = "" }: StatusBadgeProps) {
  const statusConfig: Record<
    string,
    { variant: BadgeVariant; icon: ReactNode; defaultLabel: string }
  > = {
    pending: { variant: "warning", icon: <Clock className="w-3 h-3" />, defaultLabel: "قيد الانتظار" },
    confirmed: { variant: "info", icon: <CheckCircle className="w-3 h-3" />, defaultLabel: "تم التأكيد" },
    processing: { variant: "info", icon: <Loader2 className="w-3 h-3 animate-spin" />, defaultLabel: "جاري المعالجة" },
    preparing: { variant: "info", icon: <Loader2 className="w-3 h-3 animate-spin" />, defaultLabel: "جاري التجهيز" },
    on_the_way: { variant: "primary", icon: <Truck className="w-3 h-3" />, defaultLabel: "في الطريق" },
    delivered: { variant: "success", icon: <CheckCircle className="w-3 h-3" />, defaultLabel: "تم التوصيل" },
    completed: { variant: "success", icon: <CheckCircle className="w-3 h-3" />, defaultLabel: "مكتمل" },
    cancelled: { variant: "danger", icon: <XCircle className="w-3 h-3" />, defaultLabel: "ملغي" },
    refunded: { variant: "danger", icon: <RefreshCw className="w-3 h-3" />, defaultLabel: "تم الاسترداد" },
    paid: { variant: "success", icon: <CheckCircle className="w-3 h-3" />, defaultLabel: "مدفوع" },
    unpaid: { variant: "danger", icon: <XCircle className="w-3 h-3" />, defaultLabel: "غير مدفوع" },
    active: { variant: "success", icon: <CheckCircle className="w-3 h-3" />, defaultLabel: "نشط" },
    inactive: { variant: "default", icon: <XCircle className="w-3 h-3" />, defaultLabel: "غير نشط" },
  };

  const config = statusConfig[status] || {
    variant: "default" as BadgeVariant,
    icon: null,
    defaultLabel: status,
  };

  return (
    <Badge variant={config.variant} icon={config.icon} className={className}>
      {label || config.defaultLabel}
    </Badge>
  );
}

export type { BadgeVariant, BadgeProps };
