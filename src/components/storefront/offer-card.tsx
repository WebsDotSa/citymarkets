"use client";

// Reusable offer card used in /offers grid, /offers/[id] hero, and the
// home page's featured-offers carousel. Two visual variants:
//   - "hero"     : large landscape image with title overlay + countdown
//   - "standard" : square-ish card with image + discount pill + title

import Link from "next/link";
import Image from "next/image";
import { Sparkles } from "lucide-react";
import { OfferCountdown } from "./offer-countdown";
import type { ActiveOfferInfo } from "@/lib/types";

export interface OfferCardData {
  id: string;
  title_ar: string;
  image_url: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  starts_at: string;
  ends_at: string;
  is_featured?: boolean;
  /** Product count, when known (e.g. from list endpoint). */
  product_count?: number;
}

interface OfferCardProps {
  offer: OfferCardData;
  variant?: "hero" | "standard";
  priority?: boolean;
}

function discountLabel(o: OfferCardData): string {
  return o.discount_type === "percentage"
    ? `خصم ${o.discount_value}%`
    : `خصم ${o.discount_value} ر.س`;
}

export function OfferCard({ offer, variant = "standard", priority = false }: OfferCardProps) {
  if (variant === "hero") {
    return (
      <Link
        href={`/offers/${offer.id}`}
        className="block relative rounded-3xl overflow-hidden shadow-md hover:shadow-lg transition-shadow group"
        aria-label={`عرض: ${offer.title_ar}`}
      >
        <div className="relative aspect-[16/9] bg-gray-100">
          {offer.image_url ? (
            <Image
              src={offer.image_url}
              alt={offer.title_ar}
              fill
              priority={priority}
              sizes="(max-width: 768px) 100vw, 800px"
              className="object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="absolute top-3 right-3 flex flex-wrap items-center gap-2">
            {offer.is_featured ? (
              <span className="inline-flex items-center gap-1 bg-amber-400 text-amber-900 text-2xs font-bold px-2 py-1 rounded-full">
                <Sparkles className="w-3 h-3" />
                مميّز
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 bg-red-500 text-white text-2xs font-bold px-2 py-1 rounded-full">
              {discountLabel(offer)}
            </span>
          </div>
          <div className="absolute bottom-0 inset-x-0 p-4 sm:p-5 text-white">
            <h2 className="text-lg sm:text-2xl font-bold leading-tight line-clamp-2 mb-2">
              {offer.title_ar}
            </h2>
            <OfferCountdown endsAt={offer.ends_at} showSeconds={false} />
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/offers/${offer.id}`}
      className="block relative bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all group"
      aria-label={`عرض: ${offer.title_ar}`}
    >
      <div className="relative aspect-[4/3] bg-gray-100">
        {offer.image_url ? (
          <Image
            src={offer.image_url}
            alt={offer.title_ar}
            fill
            priority={priority}
            sizes="(max-width: 768px) 50vw, 280px"
            className="object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : null}
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          <span className="inline-flex items-center gap-1 bg-red-500 text-white text-tiny font-bold px-2 py-1 rounded-full">
            {discountLabel(offer)}
          </span>
          {offer.is_featured ? (
            <span className="inline-flex items-center gap-1 bg-amber-400 text-amber-900 text-tiny font-bold px-2 py-0.5 rounded-full">
              <Sparkles className="w-3 h-3" />
              مميّز
            </span>
          ) : null}
        </div>
      </div>
      <div className="p-3 space-y-2">
        <h3 className="text-sm font-bold text-secondary line-clamp-1">
          {offer.title_ar}
        </h3>
        <div className="flex items-center justify-between gap-2">
          <OfferCountdown endsAt={offer.ends_at} variant="compact" />
          {typeof offer.product_count === "number" ? (
            <span className="text-tiny text-gray-500">
              {offer.product_count} منتج
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
