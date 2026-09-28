"use client";

import Link from "next/link";
import {
  getCategoryEmoji,
  resolveCategoryImageSrc,
} from "@/lib/category-media";

interface CategoryTileProps {
  name: string;
  slug: string;
  emoji?: string;
  imageUrl?: string | null;
}

export function CategoryTile({
  name,
  slug,
  emoji = "📦",
  imageUrl,
}: CategoryTileProps) {
  const src = resolveCategoryImageSrc(imageUrl);
  const fallbackEmoji = getCategoryEmoji(imageUrl, emoji);

  return (
    <Link
      href={`/categories/${encodeURIComponent(slug)}`}
      className="group block"
    >
      <div className="relative bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100/80 min-h-[118px] flex flex-col">
        <p className="text-[13px] font-bold text-gray-900 px-3 pt-3 pb-1 line-clamp-2 leading-tight text-right">
          {name}
        </p>
        <div className="flex-1 flex items-end justify-center px-2 pb-2 bg-gradient-to-br from-primary-light/40 via-white to-gray-50/80 min-h-[72px]">
          {src ? (
            <img
              src={src}
              alt={name}
              className="max-h-[64px] w-auto max-w-full object-contain group-hover:scale-105 transition-transform drop-shadow-sm"
            />
          ) : (
            <span className="text-4xl drop-shadow-sm group-hover:scale-105 transition-transform">
              {fallbackEmoji}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
