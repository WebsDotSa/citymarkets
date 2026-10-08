"use client";

import { useState } from "react";

interface CategoryImageProps {
  src: string | null;
  emoji: string;
  imageClassName: string;
  fallbackClassName: string;
  loading?: "eager" | "lazy";
}

export function CategoryImage({
  src,
  emoji,
  imageClassName,
  fallbackClassName,
  loading = "lazy",
}: CategoryImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return (
      <span className={fallbackClassName} aria-hidden="true">
        {emoji}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading={loading}
      decoding="async"
      onError={() => setFailedSrc(src)}
      className={imageClassName}
    />
  );
}