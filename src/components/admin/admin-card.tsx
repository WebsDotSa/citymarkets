"use client";

import { ReactNode } from "react";

export interface AdminCardProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  padding?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Admin card — consistent content wrapper for admin sections.
 * Used for filters, data tables, form sections, stats, etc.
 *
 * Features:
 * - Consistent white background with gray borders
 * - Optional title and subtitle
 * - Flexible padding options
 * - Shadow for depth
 *
 * Usage:
 *   <AdminCard title="الفلاتر" padding="md">
 *     <FilterControls />
 *   </AdminCard>
 */
export function AdminCard({
  children,
  title,
  subtitle,
  padding = "md",
  className = "",
}: AdminCardProps) {
  const paddingClass = {
    sm: "p-3",
    md: "p-4",
    lg: "p-6",
  }[padding];

  return (
    <div className={`bg-white rounded-lg border border-gray-200 shadow-sm ${paddingClass} ${className}`}>
      {(title || subtitle) && (
        <div className="mb-4">
          {title && (
            <h3 className="font-semibold text-gray-900">
              {title}
            </h3>
          )}
          {subtitle && (
            <p className="text-sm text-gray-600 mt-1">
              {subtitle}
            </p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
