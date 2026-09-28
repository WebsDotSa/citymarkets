"use client";

import { useState } from "react";

type Props = {
  src?: string | null;
  alt?: string;
  className?: string;
};

/** صورة منتج في الطلب — بدون محسّن Next.js لتجنب تعطل الصفحة عند 404 */
export function OrderItemThumb({ src, alt = "", className = "" }: Props) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <ThumbFrame className={className}>
        <span className="text-lg" aria-hidden>
          📦
        </span>
      </ThumbFrame>
    );
  }

  return (
    <ThumbFrame className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="absolute inset-0 w-full h-full object-cover"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </ThumbFrame>
  );
}

function ThumbFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative overflow-hidden ${className ?? ""}`}>
      {children}
    </div>
  );
}
