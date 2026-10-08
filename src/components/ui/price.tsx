import { formatPrice as formatPriceUtil } from "@/lib/format";

interface PriceProps {
  /** Current price (or original if discounted) */
  price: number | string | null | undefined;
  /** Discounted price, if applicable */
  discount_price?: number | string | null;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Additional CSS classes for the wrapper */
  className?: string;
}

/**
 * Unified price display component for storefront.
 *
 * Features:
 * - Formats price with formatPrice() → "12.34 ร.س"
 * - Supports discount with strikethrough original
 * - RTL-safe: uses logical properties, no forced dir="ltr"
 * - Consistent color: regular price in secondary, discount in red-600
 *
 * Usage:
 *   <Price price={100} />
 *   <Price price={100} discount_price={75} />
 *   <Price price={100} discount_price={75} size="lg" />
 */
export function Price({
  price,
  discount_price,
  size = "md",
  className = "",
}: PriceProps) {
  const sizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  const hasDiscount = discount_price != null && Number(discount_price) < Number(price ?? 0);

  // Original price
  const originalFormatted = formatPriceUtil(price);

  // Discount price
  const discountFormatted = hasDiscount ? formatPriceUtil(discount_price) : null;

  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      {hasDiscount ? (
        <>
          {/* Discount price — primary display */}
          <span className={`font-bold text-red-600 ${sizeClasses[size]}`}>
            {discountFormatted}
          </span>
          {/* Original price — strikethrough */}
          <span className={`text-gray-400 line-through ${sizeClasses[size]}`}>
            {originalFormatted}
          </span>
        </>
      ) : (
        /* Regular price */
        <span className={`font-bold text-secondary ${sizeClasses[size]}`}>
          {originalFormatted}
        </span>
      )}
    </div>
  );
}
