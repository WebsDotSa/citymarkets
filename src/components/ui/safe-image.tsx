"use client";

import Image, { ImageProps } from "next/image";
import { useState } from "react";

export type VendorType =
  | "food_beverage"
  | "fashion"
  | "gifts"
  | "electronics"
  | "services"
  | "grocery_supermarket"
  | "restaurant_cafe"
  | "sweets_bakery"
  | "pharmacy_health"
  | "beauty_cosmetics"
  | "flowers_plants"
  | "books_stationery"
  | "sports_fitness"
  | "home_appliances"
  | "furniture_home"
  | "jewelry_watches"
  | "cars_auto"
  | "pets_animals"
  | "kids_babies"
  | "music_instruments"
  | "tools_industrial"
  | "travel_tourism"
  | "real_estate";

const PRODUCT_PLACEHOLDER: Record<string, string> = {
  coffee: "/placeholders/products/coffee.svg",
  flowers: "/placeholders/products/flowers.svg",
};

const VENDOR_PRODUCT_TYPE: Record<string, VendorType> = {
  "aamiz-kafeh": "food_beverage",
  "aamiz-lilwarood": "gifts",
  "city-markets": "food_beverage",
};

interface SafeImageProps extends Omit<ImageProps, "src" | "alt" | "placeholder"> {
  src?: string | null;
  alt: string;
  /**
   * Logical type for placeholder selection:
   *   "coffee"   → coffee placeholder (food_beverage default)
   *   "flowers"  → flowers placeholder (gifts default)
   *   "default"  → generic box placeholder
   * If omitted, derives from `vendorSlug` (vendor page) or falls back to "default".
   */
  fallback?: "coffee" | "flowers" | "default";
  /** When set, picks the placeholder based on this vendor slug. */
  vendorSlug?: string;
}

function pickPlaceholder(fallback: SafeImageProps["fallback"], vendorSlug?: string) {
  if (fallback) return PRODUCT_PLACEHOLDER[fallback] ?? "/placeholders/products/default.svg";
  if (vendorSlug === "aamiz-lilwarood") return PRODUCT_PLACEHOLDER.flowers;
  if (vendorSlug === "aamiz-kafeh") return PRODUCT_PLACEHOLDER.coffee;
  return "/placeholders/products/default.svg";
}

export function SafeImage({
  src,
  alt,
  fallback,
  vendorSlug,
  className,
  ...rest
}: SafeImageProps) {
  const [errored, setErrored] = useState(false);
  const isMissing = !src || src.trim() === "" || errored;
  const finalSrc = isMissing ? pickPlaceholder(fallback, vendorSlug) : src;

  return (
    <Image
      {...rest}
      src={finalSrc}
      alt={alt}
      className={className}
      onError={() => setErrored(true)}
      unoptimized
    />
  );
}

export function vendorTypeFor(slug?: string): VendorType {
  if (!slug) return "food_beverage";
  return VENDOR_PRODUCT_TYPE[slug] ?? "food_beverage";
}
