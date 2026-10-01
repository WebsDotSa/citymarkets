"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Store, ArrowLeft } from "lucide-react";

interface HomeVendor {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  logo?: string | null;
  banner?: string | null;
  type: string;
  primaryColor: string;
  isOpen: boolean;
}

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

function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || "#009345").replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function VendorCard({ vendor }: { vendor: HomeVendor }) {
  const tint = vendor.primaryColor || "#009345";
  const emoji = TYPE_EMOJI[vendor.type] || "🏪";

  return (
    <Link
      href={`/vendors/${vendor.slug}`}
      className="group flex-shrink-0 w-44 sm:w-52"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="relative h-44 sm:h-52 rounded-3xl overflow-hidden bg-white border border-slate-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
        {/* gradient header */}
        <div
          className="absolute inset-x-0 top-0 h-20 sm:h-24"
          style={{
            background: `linear-gradient(135deg, ${hexToRgba(tint, 0.18)} 0%, ${hexToRgba(tint, 0.05)} 100%)`,
          }}
        />

        {/* open/closed pill */}
        <div className="absolute top-3 end-3 z-10">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold backdrop-blur-md ${
              vendor.isOpen
                ? "bg-emerald-500/95 text-white shadow-sm"
                : "bg-slate-700/90 text-white"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                vendor.isOpen ? "bg-white animate-pulse" : "bg-slate-300"
              }`}
            />
            {vendor.isOpen ? "مفتوح" : "مغلق"}
          </span>
        </div>

        {/* logo / emoji */}
        <div className="absolute inset-x-0 top-6 sm:top-8 flex justify-center">
          <div
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white shadow-md flex items-center justify-center group-hover:scale-110 transition-transform duration-300"
            style={{ boxShadow: `0 8px 24px ${hexToRgba(tint, 0.25)}` }}
          >
            {vendor.logo ? (
              <Image
                src={vendor.logo}
                alt={vendor.name}
                width={64}
                height={64}
                className="object-contain w-12 h-12 sm:w-16 sm:h-16"
                unoptimized
              />
            ) : (
              <span className="text-3xl sm:text-4xl">{emoji}</span>
            )}
          </div>
        </div>

        {/* bottom content */}
        <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4 pt-12">
          <h3 className="text-sm sm:text-base font-bold text-slate-900 line-clamp-1 group-hover:text-primary transition-colors">
            {vendor.name}
          </h3>
          {vendor.description && (
            <p className="text-[11px] sm:text-xs text-slate-500 line-clamp-2 mt-0.5 leading-snug">
              {vendor.description}
            </p>
          )}
          <div className="mt-2 flex items-center gap-1 text-[11px] font-bold text-primary">
            تصفح المتجر
            <ArrowLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
          </div>
        </div>

        {/* accent bar */}
        <div
          className="absolute bottom-0 inset-x-0 h-1"
          style={{ backgroundColor: tint }}
        />
      </div>
    </Link>
  );
}

export function StoresCarouselSection() {
  const [vendors, setVendors] = useState<HomeVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/v1/vendors", { signal: ac.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!ac.signal.aborted) {
          setVendors(Array.isArray(d?.vendors) ? d.vendors : []);
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
    el.scrollBy({
      left: dir === "left" ? -240 : 240,
      behavior: "smooth",
    });
  };

  if (!loading && vendors.length === 0) return null;

  return (
    <section className="py-8 sm:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-sm">
              <Store className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
                تسوّق من المتاجر
              </h2>
              <p className="text-sm text-slate-500 mt-0.5 font-normal">
                قهوة، هدايا، عبايات وأكثر
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/vendors"
              className="hidden sm:flex items-center gap-1 text-sm font-bold text-primary hover:text-primary-dark transition-colors"
            >
              عرض الكل
              <ChevronLeft className="w-4 h-4" />
            </Link>
            {vendors.length > 3 && (
              <>
                <button
                  onClick={() => scrollBy("right")}
                  aria-label="السابق"
                  className="hidden md:flex w-9 h-9 bg-white border border-slate-100 shadow-sm rounded-full items-center justify-center hover:bg-slate-50 transition-colors"
                >
                  <ChevronRight className="w-4 h-4 text-slate-700" />
                </button>
                <button
                  onClick={() => scrollBy("left")}
                  aria-label="التالي"
                  className="hidden md:flex w-9 h-9 bg-white border border-slate-100 shadow-sm rounded-full items-center justify-center hover:bg-slate-50 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4 text-slate-700" />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="-mx-4 sm:mx-0">
          <div
            ref={scrollerRef}
            className="flex gap-4 overflow-x-auto px-4 sm:px-0 pb-2 scrollbar-hide"
            style={{ scrollSnapType: "x mandatory" }}
          >
            {loading
              ? [...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className="flex-shrink-0 w-44 sm:w-52 h-44 sm:h-52 rounded-3xl bg-slate-100 animate-pulse"
                  />
                ))
              : vendors.map((v) => <VendorCard key={v.id} vendor={v} />)}
          </div>
        </div>
      </div>
    </section>
  );
}