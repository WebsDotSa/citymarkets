"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ArrowLeft, Percent } from "lucide-react";

interface HeroBannerProps {
  banners: {
    id: string;
    image_url: string;
    link_type?: string;
    link_value?: string | null;
    title?: string;
    subtitle?: string;
  }[];
  autoPlay?: boolean;
  autoPlayInterval?: number;
  className?: string;
}

function getBannerHref(linkType?: string, linkValue?: string | null): string {
  if (!linkValue || linkType === "none") return "/catalog";
  if (linkType === "category") return `/categories/${encodeURIComponent(linkValue)}`;
  if (linkType === "product") return `/products/${encodeURIComponent(linkValue)}`;
  if (linkType === "external") {
    try {
      const url = new URL(linkValue);
      return url.protocol === "http:" || url.protocol === "https:"
        ? url.toString()
        : "/catalog";
    } catch {
      return "/catalog";
    }
  }
  return "/catalog";
}

export function HeroBanner({
  banners,
  autoPlay = true,
  autoPlayInterval = 5000,
  className = "",
}: HeroBannerProps) {
  const [current, setCurrent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const next = useCallback(() => {
    setCurrent((prev) => (prev + 1) % banners.length);
  }, [banners.length]);

  const prev = useCallback(() => {
    setCurrent((prev) => (prev - 1 + banners.length) % banners.length);
  }, [banners.length]);

  const goTo = (index: number) => {
    setCurrent(index);
  };

  useEffect(() => {
    if (!autoPlay || isPaused || banners.length <= 1) return;

    const timer = setInterval(() => {
      next();
    }, autoPlayInterval);

    return () => clearInterval(timer);
  }, [autoPlay, autoPlayInterval, isPaused, banners.length, next]);

  if (banners.length === 0) return null;

  const currentBanner = banners[current];
  const bannerHref = getBannerHref(
    currentBanner.link_type,
    currentBanner.link_value
  );

  return (
    <div
      className={`relative ${className}`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Banner Container */}
      <div className="relative h-48 sm:h-64 md:h-80 rounded-3xl overflow-hidden">
        <Link
          href={bannerHref}
          className="block w-full h-full"
        >
          <Image
            src={currentBanner.image_url}
            alt={currentBanner.title || `عرض ${current + 1}`}
            fill
            sizes="100vw"
            // First slide = LCP element. `priority` enables preload +
            // fetchpriority=high; the explicit fetchPriority prop is a
            // belt-and-suspenders pass-through for the underlying <img>.
            // (2026-08-17 PageSpeed Performance fix.)
            priority={current === 0}
            fetchPriority={current === 0 ? "high" : "auto"}
            quality={85}
          />
        </Link>

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-l from-black/60 via-black/30 to-transparent" />

        {/* Content */}
        <div className="absolute inset-0 flex items-center p-6 sm:p-10">
          <div className="max-w-md animate-slide-up">
            {currentBanner.link_type === "category" && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 backdrop-blur rounded-full text-white text-xs font-medium mb-3">
                <Percent className="w-3 h-3" />
                خصم يصل إلى 30%
              </span>
            )}
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-2 leading-tight">
              {currentBanner.title || "تسوق الآن من أسواق سيتي"}
            </h2>
            <p className="text-white/80 text-sm sm:text-base mb-4">
              {currentBanner.subtitle || "توصيل سريع خلال 45 دقيقة إلى باب بيتك"}
            </p>
            <Link
              href={bannerHref}
              className="inline-flex items-center gap-2 px-6 py-3 bg-white text-[#111827] rounded-2xl font-semibold hover:bg-primary-light transition-all shadow-lg hover:shadow-xl"
            >
              تسوق الآن
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* Navigation Arrows */}
      {banners.length > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute end-4 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 bg-white/90 backdrop-blur rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-all z-10"
            aria-label="السابق"
          >
            <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6 text-[#111827]" />
          </button>
          <button
            onClick={next}
            className="absolute start-4 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 bg-white/90 backdrop-blur rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-all z-10"
            aria-label="التالي"
          >
            <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6 text-[#111827]" />
          </button>
        </>
      )}

      {/* Dots */}
      {banners.length > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {banners.map((_, index) => (
            <button
              key={index}
              onClick={() => goTo(index)}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                index === current
                  ? "w-8 bg-primary"
                  : "bg-[#E5E7EB] hover:bg-[#D1D5DB]"
              }`}
              aria-label={`الانتقال للشريحة ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Static Hero Banner (for smaller sections)
interface StaticHeroProps {
  title: string;
  subtitle?: string;
  backgroundImage?: string;
  gradient?: string;
  ctaLabel?: string;
  ctaHref?: string;
  className?: string;
}

export function StaticHero({
  title,
  subtitle,
  backgroundImage,
  gradient = "from-[#009345] to-[#00B359]",
  ctaLabel = "تسوق الآن",
  ctaHref = "/catalog",
  className = "",
}: StaticHeroProps) {
  return (
    <div
      className={`relative rounded-3xl overflow-hidden bg-gradient-to-l ${gradient} ${className}`}
      style={{
        minHeight: "180px",
        ...(backgroundImage && {
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }),
      }}
    >
      {/* Overlay for background images */}
      {backgroundImage && (
        <div className="absolute inset-0 bg-gradient-to-l from-black/60 to-transparent" />
      )}

      <div className="relative z-10 p-6 sm:p-8 flex flex-col justify-center h-full">
        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2 leading-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="text-white/90 text-sm sm:text-base mb-4 max-w-md">
            {subtitle}
          </p>
        )}
        <Link
          href={ctaHref}
          className="inline-flex items-center gap-2 w-fit px-6 py-3 bg-white text-[#111827] rounded-2xl font-semibold hover:bg-primary-light transition-all shadow-lg"
        >
          {ctaLabel}
          <ArrowLeft className="w-4 h-4" />
        </Link>
      </div>

      {/* Decorative Elements */}
      <div className="absolute top-0 start-0 w-32 h-32 bg-white/10 rounded-full -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 end-0 w-48 h-48 bg-white/10 rounded-full translate-x-1/3 translate-y-1/3" />
    </div>
  );
}

// Promo Strip Component
interface PromoStripProps {
  className?: string;
}

export function PromoStrip({ className }: PromoStripProps) {
  const features = [
    { icon: "🚚", label: "توصيل سريع", value: "45 دقيقة" },
    { icon: "🔒", label: "دفع آمن", value: "100%" },
    { icon: "📞", label: "دعم", value: "24/7" },
    { icon: "🏷️", label: "خصومات", value: "يومياً" },
  ];

  return (
    <div
      className={`grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-3xl bg-gradient-to-l from-[#009345] to-[#00B359] ${className}`}
    >
      {features.map((item, i) => (
        <div
          key={i}
          className="flex items-center gap-3 text-white"
        >
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center text-lg sm:text-xl flex-shrink-0">
            {item.icon}
          </div>
          <div>
            <p className="text-xs opacity-80">{item.label}</p>
            <p className="font-bold text-sm sm:text-base">{item.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
