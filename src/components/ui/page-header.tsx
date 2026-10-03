import Link from "next/link";
import type { ReactNode } from "react";

interface PageHeaderProps {
  /** Page title */
  title: string;
  /** Optional subtitle or description */
  subtitle?: string;
  /** Optional icon/badge before title */
  icon?: ReactNode;
  /** Optional action button or element (e.g., call-to-action) */
  action?: ReactNode;
  /** Align action to right (default) or left */
  actionAlign?: "right" | "left";
  /** Additional wrapper classes */
  className?: string;
}

/**
 * Unified page header for storefront pages (wishlist, offers, cart, vendors, etc.).
 *
 * Features:
 * - Consistent top-level page title styling
 * - Optional icon, subtitle, action button
 * - RTL-safe layout with flex gap
 * - Responsive sizing
 *
 * Usage:
 *   <PageHeader title="قائمة أمنياتي" subtitle="10 منتجات" />
 *   <PageHeader
 *     title="متجري"
 *     action={<Link href="/contact">اتصل بنا</Link>}
 *   />
 */
export function PageHeader({
  title,
  subtitle,
  icon,
  action,
  actionAlign = "right",
  className = "",
}: PageHeaderProps) {
  return (
    <div
      className={`flex items-start justify-between gap-4 mb-6 ${className}`}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {icon && <div className="flex-shrink-0 mt-1">{icon}</div>}
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-gray-500 mt-1">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {action && actionAlign === "right" && (
        <div className="flex-shrink-0">{action}</div>
      )}
      {action && actionAlign === "left" && (
        <div className="flex-shrink-0 order-first">{action}</div>
      )}
    </div>
  );
}
