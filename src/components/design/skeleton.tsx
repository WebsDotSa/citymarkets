"use client";

// Skeleton Components for Loading States

interface SkeletonProps {
  className?: string;
  variant?: "text" | "circular" | "rectangular" | "rounded";
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  className = "",
  variant = "text",
  width,
  height,
}: SkeletonProps) {
  const baseStyles =
    "bg-gradient-to-r from-[#F3F4F6] via-[#E5E7EB] to-[#F3F4F6] bg-[length:200%_100%] animate-shimmer";

  const variants = {
    text: "h-4 rounded-lg",
    circular: "rounded-full",
    rectangular: "rounded-none",
    rounded: "rounded-xl",
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === "number" ? `${width}px` : width;
  if (height) style.height = typeof height === "number" ? `${height}px` : height;

  return (
    <div className={`${baseStyles} ${variants[variant]} ${className}`} style={style} />
  );
}

// Product Card Skeleton
export function ProductCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`bg-white rounded-3xl overflow-hidden shadow-sm ${className}`}
    >
      {/* Image */}
      <div className="aspect-square bg-gradient-to-r from-[#F3F4F6] via-[#E5E7EB] to-[#F3F4F6] bg-[length:200%_100%] animate-shimmer" />

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Title */}
        <Skeleton variant="text" className="w-3/4" />
        <Skeleton variant="text" className="w-1/2" />

        {/* Rating */}
        <div className="flex gap-1">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="w-4 h-4 rounded-full bg-gradient-to-r from-[#F3F4F6] via-[#E5E7EB] to-[#F3F4F6] bg-[length:200%_100%] animate-shimmer"
            />
          ))}
        </div>

        {/* Price */}
        <Skeleton variant="text" className="w-1/3 h-6" />

        {/* Button */}
        <Skeleton variant="rounded" className="h-11 w-full" />
      </div>
    </div>
  );
}

// Category Card Skeleton
export function CategoryCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`flex flex-col items-center p-4 rounded-3xl bg-white shadow-sm ${className}`}
    >
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-r from-[#F3F4F6] via-[#E5E7EB] to-[#F3F4F6] bg-[length:200%_100%] animate-shimmer mb-3" />
      <Skeleton variant="text" className="w-16" />
    </div>
  );
}

// Cart Item Skeleton
export function CartItemSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`bg-white rounded-2xl p-4 shadow-sm ${className}`}
    >
      <div className="flex gap-4">
        {/* Image */}
        <Skeleton variant="rounded" width={96} height={96} />

        {/* Content */}
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" className="w-3/4" />
          <Skeleton variant="text" className="w-1/2" />
          <div className="flex justify-between items-center mt-4">
            <Skeleton variant="text" className="w-20 h-6" />
            <Skeleton variant="rounded" width={100} height={36} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Order Card Skeleton
export function OrderCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`bg-white rounded-2xl overflow-hidden shadow-sm ${className}`}
    >
      {/* Header */}
      <div className="p-4 border-b border-[#F3F4F6]">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <Skeleton variant="text" className="w-24" />
            <Skeleton variant="text" className="w-32" />
          </div>
          <Skeleton variant="rounded" width={80} height={28} />
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2 space-x-reverse">
            {[...Array(3)].map((_, i) => (
              <Skeleton
                key={i}
                variant="circular"
                width={48}
                height={48}
                className="border-2 border-white"
              />
            ))}
          </div>
          <div className="flex-1">
            <Skeleton variant="text" className="w-16" />
          </div>
          <Skeleton variant="text" className="w-20" />
        </div>
      </div>
    </div>
  );
}

// Profile Card Skeleton
export function ProfileCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`bg-white rounded-3xl p-6 shadow-sm ${className}`}
    >
      <div className="flex items-center gap-4">
        <Skeleton variant="circular" width={80} height={80} />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" className="w-32 h-6" />
          <Skeleton variant="text" className="w-24" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-6">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} variant="rounded" height={60} />
        ))}
      </div>
    </div>
  );
}

// Banner Skeleton
export function BannerSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`rounded-3xl overflow-hidden ${className}`}
      style={{ height: "200px" }}
    >
      <Skeleton variant="rectangular" className="w-full h-full" />
    </div>
  );
}

// List Item Skeleton
export function ListItemSkeleton({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-4 p-4 ${className}`}>
      <Skeleton variant="circular" width={48} height={48} />
      <div className="flex-1 space-y-2">
        <Skeleton variant="text" className="w-3/4" />
        <Skeleton variant="text" className="w-1/2" />
      </div>
      <Skeleton variant="rounded" width={80} height={32} />
    </div>
  );
}

// Section Skeleton
export function SectionSkeleton({ className }: { className?: string }) {
  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <Skeleton variant="text" className="w-32 h-6" />
          <Skeleton variant="text" className="w-24" />
        </div>
        <Skeleton variant="text" className="w-16" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

// Page Skeleton (Full Page Loading)
export function PageSkeleton() {
  return (
    <div className="min-h-screen bg-[#FAFBFC] pb-24">
      {/* Header */}
      <div className="bg-white px-4 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          <Skeleton variant="circular" width={40} height={40} />
          <Skeleton variant="text" className="flex-1" />
          <Skeleton variant="circular" width={40} height={40} />
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-6 space-y-8">
        <BannerSkeleton />
        <SectionSkeleton />
        <SectionSkeleton />
      </div>
    </div>
  );
}

// Dashboard Stats Skeleton
export function StatsSkeleton({ className }: { className?: string }) {
  return (
    <div className={`grid grid-cols-3 gap-3 ${className}`}>
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="bg-white/20 backdrop-blur rounded-2xl p-4 text-center"
        >
          <Skeleton variant="circular" width={40} height={40} className="mx-auto mb-2" />
          <Skeleton variant="text" className="w-12 h-8 mx-auto" />
          <Skeleton variant="text" className="w-16 h-4 mx-auto mt-1" />
        </div>
      ))}
    </div>
  );
}

// Table Row Skeleton
export function TableRowSkeleton({
  columns = 5,
  className,
}: {
  columns?: number;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-4 p-4 border-b border-[#F3F4F6] ${className}`}>
      {[...Array(columns)].map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          className={`flex-1 ${i === 0 ? "w-24" : ""}`}
        />
      ))}
    </div>
  );
}

// Search Filter Skeleton
export function SearchFilterSkeleton({ className }: { className?: string }) {
  return (
    <div className={`bg-white rounded-2xl p-4 shadow-sm ${className}`}>
      <div className="flex items-center gap-4 mb-4">
        <Skeleton variant="rounded" className="flex-1 h-12" />
        <Skeleton variant="rounded" width={100} height={40} />
        <Skeleton variant="rounded" width={100} height={40} />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} variant="rounded" width={80} height={36} />
        ))}
      </div>
    </div>
  );
}

// Product Detail Skeleton
export function ProductDetailSkeleton() {
  return (
    <div className="bg-white min-h-screen pb-28">
      <div className="h-14 border-b border-gray-100 flex items-center px-4">
        <Skeleton variant="circular" className="w-10 h-10" />
        <div className="flex-1" />
        <Skeleton variant="circular" className="w-10 h-10" />
      </div>
      <div className="px-6 pt-4 pb-6">
        <Skeleton className="w-full aspect-square max-h-[340px]" />
      </div>
      <div className="px-4 space-y-4">
        <div className="space-y-2">
          <Skeleton height={24} className="w-3/4" />
          <Skeleton height={16} className="w-1/4" />
        </div>
        <Skeleton height={16} className="w-full" />
        <Skeleton height={16} className="w-5/6" />
        <Skeleton height={16} className="w-4/6" />
      </div>
      <div className="fixed bottom-20 left-0 right-0 p-4 bg-white border-t">
        <Skeleton height={48} className="w-full rounded-2xl" />
      </div>
    </div>
  );
}

// Address Card Skeleton
export function AddressCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={`p-4 rounded-xl border-2 border-gray-100 space-y-2 ${className}`}>
      <div className="flex justify-between">
        <Skeleton height={16} className="w-1/3" />
        <Skeleton variant="circular" className="w-8 h-8" />
      </div>
      <Skeleton height={12} className="w-full" />
      <Skeleton height={12} className="w-2/3" />
    </div>
  );
}

// Home Page Skeleton
export function HomePageSkeleton() {
  return (
    <div className="bg-white min-h-screen pb-28">
      {/* Header Skeleton */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <Skeleton className="w-32 h-10" />
          <div className="flex items-center gap-2">
            <Skeleton variant="circular" className="w-10 h-10" />
            <Skeleton variant="circular" className="w-10 h-10" />
          </div>
        </div>
        <Skeleton height={44} className="w-full mt-3 rounded-xl" />
      </div>

      {/* Quick Pills */}
      <div className="px-4 py-3 flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="w-24 h-9 rounded-full" />
        ))}
      </div>

      {/* Banner */}
      <div className="px-4">
        <BannerSkeleton />
      </div>

      {/* Promo Strip */}
      <div className="mx-4 mt-4 p-4 rounded-2xl bg-gray-100">
        <Skeleton height={20} className="w-2/3 mb-4" />
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>

      {/* Section */}
      <div className="px-4 mt-6">
        <div className="flex justify-between mb-3">
          <Skeleton height={20} className="w-32" />
          <Skeleton height={14} className="w-16" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Catalog Page Skeleton
export function CatalogPageSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton variant="circular" className="w-10 h-10" />
            <Skeleton height={24} className="w-32" />
          </div>
          <Skeleton variant="circular" className="w-10 h-10" />
        </div>
      </div>

      {/* Category Pills */}
      <div className="bg-white border-b px-4 py-3">
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="w-20 h-9 rounded-full" />
          ))}
        </div>
      </div>

      {/* Products Grid */}
      <div className="px-4 mt-4">
        <div className="flex justify-between items-center mb-3">
          <Skeleton height={14} className="w-20" />
          <Skeleton height={14} className="w-20" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
