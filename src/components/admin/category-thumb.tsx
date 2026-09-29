"use client";

import {
  getCategoryEmoji,
  resolveCategoryImageSrc,
} from '@/lib/catalog';

interface CategoryThumbProps {
  iconUrl?: string | null;
  name: string;
  className?: string;
  gradientClass?: string;
}

export function CategoryThumb({
  iconUrl,
  name,
  className = "w-12 h-12",
  gradientClass = "from-primary to-primary-dark",
}: CategoryThumbProps) {
  const src = resolveCategoryImageSrc(iconUrl);

  if (src) {
    return (
      <div
        className={`${className} rounded-xl overflow-hidden flex-shrink-0 bg-gray-50 border border-gray-100`}
      >
        <img
          src={src}
          alt={name}
          className="w-full h-full object-cover"
          onError={(e) => {
            const el = e.target as HTMLImageElement;
            el.style.display = "none";
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`${className} rounded-xl bg-gradient-to-br ${gradientClass} flex items-center justify-center flex-shrink-0`}
    >
      <span className="text-xl">{getCategoryEmoji(iconUrl)}</span>
    </div>
  );
}
