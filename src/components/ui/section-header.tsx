import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

interface SectionHeaderProps {
  /** Section title */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Link to "View All" page */
  viewAllHref?: string;
  /** Optional icon/element before title */
  icon?: ReactNode;
  /** Additional wrapper classes */
  className?: string;
}

/**
 * Unified section header for home layout + storefront pages.
 *
 * Replaces 14 inline copies across:
 * - featured-products-section.tsx:10
 * - featured-offers-section.tsx:11
 * - quick-categories-section.tsx:17
 * - 11 hand-rolled divs with text-lg/xl + font-bold
 *
 * Features:
 * - Consistent typography (font-bold, text-lg/sm:text-xl)
 * - Optional "عرض الكل" link with chevron
 * - Optional icon
 * - Handles dark mode, RTL, responsive sizing
 *
 * Usage:
 *   <SectionHeader title="المنتجات المميزة" viewAllHref="/products" />
 *   <SectionHeader
 *     title="الأقسام"
 *     icon={<CategoryIcon />}
 *     viewAllHref="/categories"
 *   />
 */
export function SectionHeader({
  title,
  subtitle,
  viewAllHref,
  icon,
  className = "",
}: SectionHeaderProps) {
  return (
    <div
      className={`flex items-center justify-between gap-3 mb-4 ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon && <div className="flex-shrink-0">{icon}</div>}
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-secondary">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {viewAllHref && (
        <Link
          href={viewAllHref}
          className="flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-dark transition-colors flex-shrink-0 whitespace-nowrap"
        >
          <span>عرض الكل</span>
          <ArrowLeft className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}
