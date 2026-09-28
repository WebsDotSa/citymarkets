"use client";

import Link from "next/link";
import Image from "next/image";
import { LucideIcon } from "lucide-react";

interface CategoryCardProps {
  id: number | string;
  name_ar: string;
  slug: string;
  icon_url?: string | null;
  emoji?: string;
  count?: number;
  href?: string;
  variant?: "default" | "large" | "compact";
  className?: string;
}

export function CategoryCard({
  id,
  name_ar,
  slug,
  icon_url,
  emoji,
  count,
  href,
  variant = "default",
  className = "",
}: CategoryCardProps) {
  const linkHref = href || `/categories/${encodeURIComponent(slug)}`;

  const renderIcon = () => {
    if (icon_url) {
      return (
        <Image
          src={icon_url}
          alt={name_ar}
          width={variant === "large" ? 48 : 32}
          height={variant === "large" ? 48 : 32}
          className="object-contain"
        />
      );
    }
    if (emoji) {
      return <span className="text-2xl sm:text-3xl">{emoji}</span>;
    }
    return <span className="text-2xl sm:text-3xl">📦</span>;
  };

  if (variant === "compact") {
    return (
      <Link
        href={linkHref}
        className={`
          flex flex-col items-center p-3 rounded-2xl
          bg-white shadow-sm hover:shadow-lg
          transition-all duration-300 hover:-translate-y-1
          ${className}
        `}
      >
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-light to-green-100 flex items-center justify-center mb-2 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
          {renderIcon()}
        </div>
        <span className="text-xs font-medium text-[#111827] text-center line-clamp-1 leading-tight">
          {name_ar}
        </span>
      </Link>
    );
  }

  if (variant === "large") {
    return (
      <Link
        href={linkHref}
        className={`
          flex flex-col items-center p-6 rounded-3xl
          bg-white shadow-md hover:shadow-xl
          transition-all duration-300 hover:-translate-y-2
          ${className}
        `}
      >
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-light to-green-100 flex items-center justify-center mb-4 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 shadow-inner">
          {renderIcon()}
        </div>
        <span className="text-base font-semibold text-[#111827] text-center line-clamp-2 leading-tight">
          {name_ar}
        </span>
        {count !== undefined && (
          <span className="text-sm text-[#9CA3AF] mt-1">{count} منتج</span>
        )}
      </Link>
    );
  }

  // Default variant
  return (
    <Link
      href={linkHref}
      className={`
        group flex flex-col items-center p-4 rounded-3xl
        bg-white shadow-sm hover:shadow-xl
        transition-all duration-300 hover:-translate-y-1
        ${className}
      `}
    >
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-light to-green-100 flex items-center justify-center mb-3 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
        {renderIcon()}
      </div>
      <span className="text-sm font-medium text-[#111827] text-center line-clamp-2 leading-tight group-hover:text-primary transition-colors">
        {name_ar}
      </span>
      {count !== undefined && (
        <span className="text-xs text-[#9CA3AF] mt-1">{count} منتج</span>
      )}
    </Link>
  );
}

// Horizontal Category List Component
interface CategoryListProps {
  categories: {
    id: number | string;
    name_ar: string;
    slug: string;
    icon_url?: string | null;
    emoji?: string;
    count?: number;
  }[];
  variant?: "default" | "compact" | "large";
  className?: string;
}

export function CategoryList({
  categories,
  variant = "default",
  className = "",
}: CategoryListProps) {
  return (
    <div
      className={`grid gap-3 ${
        variant === "large"
          ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
          : "grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8"
      } ${className}`}
    >
      {categories.map((category) => (
        <CategoryCard
          key={category.id}
          {...category}
          variant={variant}
        />
      ))}
    </div>
  );
}

// Horizontal Scroll Category List
interface CategoryScrollProps {
  categories: {
    id: number | string;
    name_ar: string;
    slug: string;
    icon_url?: string | null;
    emoji?: string;
    count?: number;
  }[];
  selectedSlug?: string;
  onSelect?: (slug: string) => void;
  showAll?: boolean;
  className?: string;
}

export function CategoryScroll({
  categories,
  selectedSlug,
  onSelect,
  showAll = true,
  className = "",
}: CategoryScrollProps) {
  return (
    <div
      className={`flex gap-2 overflow-x-auto pb-2 scrollbar-hide ${className}`}
    >
      {showAll && (
        <button
          onClick={() => onSelect?.("")}
          className={`
            flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium
            transition-all duration-200
            ${
              !selectedSlug
                ? "bg-primary text-white shadow-lg shadow-primary/20"
                : "bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB]"
            }
          `}
        >
          الكل
        </button>
      )}
      {categories.map((category) => (
        <button
          key={category.id}
          onClick={() => onSelect?.(category.slug)}
          className={`
            flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium
            flex items-center gap-2
            transition-all duration-200
            ${
              selectedSlug === category.slug
                ? "bg-primary text-white shadow-lg shadow-primary/20"
                : "bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB]"
            }
          `}
        >
          {category.icon_url ? (
            <Image
              src={category.icon_url}
              alt={category.name_ar}
              width={16}
              height={16}
              className="object-contain"
            />
          ) : category.emoji ? (
            <span>{category.emoji}</span>
          ) : null}
          <span>{category.name_ar}</span>
        </button>
      ))}
    </div>
  );
}
