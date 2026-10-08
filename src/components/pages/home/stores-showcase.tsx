"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Store } from "lucide-react";

// Shape returned by /api/v1/vendors (camelCase). Kept local so a future
// API rename is caught at compile time at the fetch site.
type HomeVendor = {
  id: string;
  slug: string;
  name: string;
  nameEn?: string | null;
  description?: string | null;
  logo?: string | null;
  banner?: string | null;
  type: string;
  primaryColor: string;
  isOpen: boolean;
};

// Map vendor_type → Saudi-relevant emoji fallback (only used when logo is
// missing or fails to load). Keeps the card visually distinct in the
// horizontal scroll without needing per-vendor artwork.
const TYPE_EMOJI: Record<string, string> = {
  food_beverage: "☕",
  fashion: "👗",
  gifts: "🎁",
  electronics: "📱",
  services: "🛠️",
  grocery_supermarket: "🛒",
  restaurant_cafe: "🍽️",
  sweets_bakery: "🥐",
  pharmacy_health: "💊",
  beauty_cosmetics: "💄",
  flowers_plants: "🌹",
  books_stationery: "📚",
  sports_fitness: "🏋️",
  home_appliances: "🔌",
  furniture_home: "🛋️",
  jewelry_watches: "💍",
  cars_auto: "🚗",
  pets_animals: "🐾",
  kids_babies: "🍼",
  music_instruments: "🎸",
  tools_industrial: "🧰",
  travel_tourism: "✈️",
  real_estate: "🏠",
  // Legacy aliases kept for backwards compat with stored slugs.
  grocery: "🛒",
  restaurant: "🍽️",
  bakery: "🥐",
};

// Soften the vendor's primary color for the card background. We can't
// trust it to be readable against white text — hex math here stays in
// 8-bit space and clips to safe bounds.
function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || "#009345").replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface VendorCardProps {
  vendor: HomeVendor;
}

function VendorCard({ vendor }: VendorCardProps) {
  const tint = vendor.primaryColor || "#009345";
  const bg = hexToRgba(tint, 0.08);
  const ring = hexToRgba(tint, 0.25);
  const emoji = TYPE_EMOJI[vendor.type] || "🏪";

  return (
    <Link
      href={`/vendors/${vendor.slug}`}
      className="group flex-shrink-0 w-40 sm:w-44"
      style={{ scrollSnapAlign: "start" }}
    >
      <div
        className="relative h-32 sm:h-36 rounded-2xl overflow-hidden border-2 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
        style={{
          backgroundColor: bg,
          borderColor: ring,
        }}
      >
        {/* Logo / emoji centerpiece */}
        <div className="absolute inset-0 flex items-center justify-center">
          {vendor.logo ? (
            <Image
              src={vendor.logo}
              alt={vendor.name}
              width={72}
              height={72}
              className="object-contain transition-transform duration-300 group-hover:scale-110"
              unoptimized
            />
          ) : (
            <span className="text-5xl sm:text-6xl transition-transform duration-300 group-hover:scale-110">
              {emoji}
            </span>
          )}
        </div>

        {/* Open / closed pill — top-left in RTL */}
        <div className="absolute top-2 right-2">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-tiny font-bold backdrop-blur ${
              vendor.isOpen
                ? "bg-emerald-500/95 text-white"
                : "bg-gray-800/80 text-white"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                vendor.isOpen ? "bg-white animate-pulse" : "bg-gray-300"
              }`}
            />
            {vendor.isOpen ? "مفتوح" : "مغلق"}
          </span>
        </div>

        {/* Primary color accent bar at the bottom of the card */}
        <div
          className="absolute bottom-0 inset-x-0 h-1"
          style={{ backgroundColor: tint }}
        />
      </div>

      {/* Store name + type under the card */}
      <div className="mt-2 px-1">
        <h3 className="text-sm font-bold text-gray-900 line-clamp-1 group-hover:text-primary transition-colors">
          {vendor.name}
        </h3>
        {vendor.description && (
          <p className="text-2xs text-gray-500 line-clamp-1 mt-0.5">
            {vendor.description}
          </p>
        )}
      </div>
    </Link>
  );
}

export function StoresShowcase() {
  const [vendors, setVendors] = useState<HomeVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/v1/vendors", { signal: ac.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!ac.signal.aborted) {
          setVendors(Array.isArray(data?.vendors) ? data.vendors : []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  const scrollBy = (dir: "left" | "right") => {
    const el = scrollerRef.current;
    if (!el) return;
    // RTL: scrollBy with a positive number moves visually left; in RTL
    // "next" is to the right which corresponds to negative scrollLeft.
    const amount = 200;
    el.scrollBy({
      left: dir === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  // Don't render the section if there are no featured stores — keeps the
  // home page from showing an empty "stores" header on a fresh install.
  if (!loading && vendors.length === 0) return null;

  return (
    <section className="px-4 pt-4">
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-sm">
            <Store className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-gray-900 leading-tight">
              تسوق من المتاجر
            </h2>
            <p className="text-2xs sm:text-xs text-gray-500 mt-0.5">
              قهوة، هدايا، عبايات والمزيد
            </p>
          </div>
        </div>
        <Link
          href="/vendors"
          className="flex items-center gap-1 text-xs sm:text-sm font-semibold text-primary hover:text-primary-dark transition-colors"
        >
          عرض الكل
          <ChevronLeft className="w-4 h-4" />
        </Link>
      </div>

      {/* Cards scroller */}
      <div className="relative">
        <div
          ref={scrollerRef}
          className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide"
          style={{ scrollSnapType: "x mandatory" }}
        >
          {loading
            ? [...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="flex-shrink-0 w-40 sm:w-44 h-32 sm:h-36 rounded-2xl bg-gray-100 animate-pulse"
                />
              ))
            : vendors.map((v) => <VendorCard key={v.id} vendor={v} />)}
        </div>

        {/* Desktop nav arrows — only when there's enough cards to scroll */}
        {vendors.length > 3 && (
          <>
            <button
              onClick={() => scrollBy("right")}
              aria-label="السابق"
              className="hidden sm:flex absolute -right-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-white shadow-lg rounded-full items-center justify-center hover:bg-gray-50 z-10 border border-gray-100"
            >
              <ChevronRight className="w-4 h-4 text-gray-700" />
            </button>
            <button
              onClick={() => scrollBy("left")}
              aria-label="التالي"
              className="hidden sm:flex absolute -left-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-white shadow-lg rounded-full items-center justify-center hover:bg-gray-50 z-10 border border-gray-100"
            >
              <ChevronLeft className="w-4 h-4 text-gray-700" />
            </button>
          </>
        )}
      </div>
    </section>
  );
}