"use client";

import { ReactNode } from "react";

interface AdminPageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Admin page header — consistent styling across all admin pages.
 * Used for dashboard pages (orders, products, customers, etc.)
 *
 * Features:
 * - Consistent title styling
 * - Optional subtitle/description
 * - Optional action button/element
 * - Integrated with gray design system (phase 4)
 *
 * Usage:
 *   <AdminPageHeader
 *     title="الطلبات"
 *     subtitle="إدارة جميع طلبات المتجر"
 *     action={<button>+ طلب جديد</button>}
 *   />
 */
export function AdminPageHeader({
  title,
  subtitle,
  action,
  className = "",
}: AdminPageHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 mb-6 ${className}`}>
      <div className="flex-1 min-w-0">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-gray-600 mt-1">
            {subtitle}
          </p>
        )}
      </div>

      {action && (
        <div className="flex-shrink-0">
          {action}
        </div>
      )}
    </div>
  );
}
