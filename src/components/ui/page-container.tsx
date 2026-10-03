import type { ReactNode } from "react";

interface PageContainerProps {
  /** Page content */
  children: ReactNode;
  /** Width variant — determines max-width */
  width?: "narrow" | "normal" | "wide" | "full";
  /** Background color */
  background?: "default" | "white" | "gray-50";
  /** Horizontal padding */
  padding?: "normal" | "tight" | "loose";
  /** Additional wrapper classes */
  className?: string;
}

/**
 * Unified page container for storefront.
 *
 * Standardizes inconsistent max-width, padding, and background values
 * scattered across pages:
 *   - max-w-lg (wishlist), max-w-2xl (checkout), max-w-4xl (orders),
 *     max-w-6xl (vendors, categories), max-w-7xl (home, catalog)
 *
 * Features:
 * - Predefined width variants (narrow, normal, wide, full)
 * - Centering via mx-auto
 * - RTL-safe padding (px not ps/pe for now, as pages use it)
 * - Optional background colors
 * - Responsive adjustments
 *
 * Usage:
 *   <PageContainer width="normal">
 *     <h1>Page Title</h1>
 *   </PageContainer>
 *
 *   <PageContainer width="narrow" background="white">
 *     <form>...</form>
 *   </PageContainer>
 */
export function PageContainer({
  children,
  width = "normal",
  background = "default",
  padding = "normal",
  className = "",
}: PageContainerProps) {
  const widthClasses = {
    narrow: "max-w-2xl",      // Forms, single-column content
    normal: "max-w-4xl",      // Most pages
    wide: "max-w-6xl",        // Category/vendor pages
    full: "w-full",           // Full width, no max
  };

  const backgroundClasses = {
    default: "bg-gray-50",
    white: "bg-white",
    "gray-50": "bg-gray-50",
  };

  const paddingClasses = {
    tight: "px-3 sm:px-4",
    normal: "px-4 sm:px-6",
    loose: "px-4 sm:px-6 lg:px-8",
  };

  return (
    <div
      className={`mx-auto ${widthClasses[width]} ${backgroundClasses[background]} ${paddingClasses[padding]} ${className}`}
    >
      {children}
    </div>
  );
}
