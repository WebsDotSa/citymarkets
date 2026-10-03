import Link from "next/link";
import Image from "next/image";
import { MapPin, Clock } from "lucide-react";
import type { ReactNode } from "react";

interface VendorCardProps {
  /** Vendor name */
  name: string;
  /** Vendor logo URL */
  logo?: string;
  /** Vendor background banner URL (used in hero variant) */
  banner?: string;
  /** Vendor slug for routing */
  slug: string;
  /** Business category */
  category?: string;
  /** Optional rating (1-5) */
  rating?: number;
  /** Optional review count */
  reviewCount?: number;
  /** Optional delivery time (minutes) */
  deliveryTime?: number;
  /** Optional distance (km) */
  distance?: number;
  /** Is vendor open/closed */
  isOpen?: boolean;
  /** Card variant */
  variant?: "grid" | "list" | "hero" | "featured";
  /** Optional badge/label */
  badge?: ReactNode;
  /** Custom className */
  className?: string;
}

/**
 * Unified vendor card component for storefront pages.
 *
 * Variants:
 * - grid: Square card with logo, name, category (catalog view)
 * - list: Horizontal compact card with badge (search/browse results)
 * - hero: Large banner card with overlay text (storefront hero)
 * - featured: Medium card with stats (featured vendors section)
 *
 * Features:
 * - Consistent vendor information display
 * - Open/closed state indication
 * - Rating and delivery info
 * - RTL-safe layout
 *
 * Usage:
 *   <VendorCard
 *     name="مطعم النور"
 *     slug="mataem-alnoor"
 *     variant="grid"
 *     category="مطاعم"
 *     isOpen={true}
 *   />
 */
export function VendorCard({
  name,
  logo,
  banner,
  slug,
  category,
  rating,
  reviewCount,
  deliveryTime,
  distance,
  isOpen = true,
  variant = "grid",
  badge,
  className = "",
}: VendorCardProps) {
  const href = `/vendors/${slug}`;

  // Grid variant: 150px square
  if (variant === "grid") {
    return (
      <Link href={href} className="block">
        <div className={`bg-white rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-shadow ${className}`}>
          <div className="aspect-square bg-gray-100 relative">
            {logo ? (
              <Image
                src={logo}
                alt={name}
                fill
                className="object-contain p-2"
                sizes="150px"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl">🏪</div>
            )}
            {!isOpen && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <span className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                  مغلق
                </span>
              </div>
            )}
            {badge && (
              <div className="absolute top-2 right-2 flex-shrink-0">
                {badge}
              </div>
            )}
          </div>
          <div className="p-2.5">
            <p className="text-sm font-bold text-secondary line-clamp-2 leading-snug">
              {name}
            </p>
            {category && (
              <p className="text-xs text-gray-500 mt-1 line-clamp-1">
                {category}
              </p>
            )}
          </div>
        </div>
      </Link>
    );
  }

  // List variant: Horizontal compact
  if (variant === "list") {
    return (
      <Link href={href} className="block">
        <div className={`bg-white rounded-2xl shadow-sm p-3 flex gap-3 hover:shadow-md transition-shadow ${className}`}>
          <div className="w-20 h-20 bg-gray-100 rounded-xl flex-shrink-0 overflow-hidden">
            {logo ? (
              <Image
                src={logo}
                alt={name}
                width={80}
                height={80}
                className="w-full h-full object-contain p-1"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-2xl">🏪</div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-secondary line-clamp-1">
                  {name}
                </p>
                {category && (
                  <p className="text-xs text-gray-500 mt-0.5">{category}</p>
                )}
              </div>
              {!isOpen && (
                <span className="text-xs font-bold text-red-600 flex-shrink-0 whitespace-nowrap">
                  مغلق
                </span>
              )}
            </div>
            {deliveryTime && (
              <div className="flex items-center gap-1 text-xs text-gray-600 mt-2">
                <Clock className="w-3 h-3" />
                <span>{deliveryTime} دقيقة</span>
              </div>
            )}
          </div>
        </div>
      </Link>
    );
  }

  // Hero variant: Large banner
  if (variant === "hero") {
    return (
      <Link href={href} className="block">
        <div className={`relative rounded-2xl overflow-hidden shadow-md h-48 hover:shadow-lg transition-shadow ${className}`}>
          {banner ? (
            <Image
              src={banner}
              alt={name}
              fill
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-r from-primary/20 to-primary/5" />
          )}
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute inset-0 flex flex-col justify-end p-4">
            <p className="text-xl font-bold text-white line-clamp-2">
              {name}
            </p>
            {category && (
              <p className="text-sm text-gray-100 mt-1">{category}</p>
            )}
          </div>
        </div>
      </Link>
    );
  }

  // Featured variant: Medium with stats
  if (variant === "featured") {
    return (
      <Link href={href} className="block">
        <div className={`bg-white rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-shadow ${className}`}>
          <div className="h-32 bg-gray-100 relative">
            {banner ? (
              <Image
                src={banner}
                alt={name}
                fill
                className="object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-r from-primary/10 to-primary/5" />
            )}
            {!isOpen && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <span className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                  مغلق
                </span>
              </div>
            )}
          </div>
          <div className="p-3">
            <p className="text-sm font-bold text-secondary line-clamp-1">
              {name}
            </p>
            {category && (
              <p className="text-xs text-gray-500 mt-1">{category}</p>
            )}
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-600">
              {rating && (
                <span>⭐ {rating.toFixed(1)}</span>
              )}
              {deliveryTime && (
                <span className="flex items-center gap-0.5">
                  <Clock className="w-3 h-3" />
                  {deliveryTime}د
                </span>
              )}
              {distance && (
                <span className="flex items-center gap-0.5">
                  <MapPin className="w-3 h-3" />
                  {distance}كم
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    );
  }

  return null;
}
