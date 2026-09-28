"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ArrowLeft, Sparkles } from "lucide-react";

interface Banner {
  id: string;
  image_url: string;
  link_type: string;
  link_value: string | null;
  title?: string | null;
  subtitle?: string | null;
}

function getBannerHref(linkType?: string, linkValue?: string | null): string {
  if (!linkValue || linkType === "none") return "/catalog";
  if (linkType === "category") return `/categories/${encodeURIComponent(linkValue)}`;
  if (linkType === "product") return `/products/${encodeURIComponent(linkValue)}`;
  if (linkType === "offer") return `/offers`;
  if (linkType === "external") {
    try {
      const url = new URL(linkValue);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "/catalog";
    } catch {
      return "/catalog";
    }
  }
  return "/catalog";
}

export function BannersCarouselSection() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/v1/banners", { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => {
        if (ac.signal.aborted) return;
        if (d.success) setBanners(d.data || []);
        setLoading(false);
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  const next = useCallback(() => {
    setCurrent((p) => (p + 1) % banners.length);
  }, [banners.length]);

  const prev = useCallback(() => {
    setCurrent((p) => (p - 1 + banners.length) % banners.length);
  }, [banners.length]);

  useEffect(() => {
    if (paused || banners.length <= 1) return;
    const t = setInterval(next, 5500);
    return () => clearInterval(t);
  }, [paused, next, banners.length]);

  if (loading) {
    return (
      <section className="py-4 sm:py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="h-48 sm:h-72 lg:h-80 rounded-3xl bg-slate-100 animate-pulse" />
        </div>
      </section>
    );
  }

  if (banners.length === 0) return null;

  const cur = banners[current];
  const href = getBannerHref(cur.link_type, cur.link_value);

  return (
    <section className="py-4 sm:py-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div
          className="relative group"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {/* Banner card */}
          <div className="relative h-56 sm:h-72 lg:h-80 rounded-3xl overflow-hidden bg-slate-900 shadow-xl">
              <Link href={href} className="block w-full h-full">
                <Image
                  src={cur.image_url}
                  alt={cur.title || `بانر ${current + 1}`}
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1280px) 80vw, 1280px"
                  priority={current === 0}
                  fetchPriority={current === 0 ? "high" : "auto"}
                  quality={85}
                  className="object-cover"
                />
              </Link>

              {/* glass overlay */}
              <div className="absolute inset-0 bg-gradient-to-l from-slate-900/80 via-slate-900/40 to-transparent" />

              {/* content */}
              <div className="absolute inset-0 flex items-center p-6 sm:p-10 lg:p-14">
                <div className="max-w-xl">
                  {cur.link_type === "category" && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/15 backdrop-blur-md border border-white/20 rounded-full text-white text-xs font-semibold mb-4">
                      <Sparkles className="w-3 h-3" />
                      عرض حصري
                    </span>
                  )}
                  <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white leading-tight">
                    {cur.title || "تسوّق من أسواق سيتي"}
                  </h2>
                  {cur.subtitle && (
                    <p className="mt-3 text-white/80 text-sm sm:text-base lg:text-lg max-w-md">
                      {cur.subtitle}
                    </p>
                  )}
                  <Link
                    href={href}
                    className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-white text-slate-900 rounded-2xl font-bold text-sm hover:bg-slate-50 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                  >
                    تسوّق الآن
                    <ArrowLeft className="w-4 h-4" />
                  </Link>
                </div>
              </div>

              {/* prev / next — desktop only, appear on hover */}
              {banners.length > 1 && (
                <>
                  <button
                    onClick={prev}
                    aria-label="السابق"
                    className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 bg-white/90 backdrop-blur-md rounded-full items-center justify-center shadow-lg hover:bg-white transition-all opacity-0 group-hover:opacity-100"
                  >
                    <ChevronRight className="w-5 h-5 text-slate-900" />
                  </button>
                  <button
                    onClick={next}
                    aria-label="التالي"
                    className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 bg-white/90 backdrop-blur-md rounded-full items-center justify-center shadow-lg hover:bg-white transition-all opacity-0 group-hover:opacity-100"
                  >
                    <ChevronLeft className="w-5 h-5 text-slate-900" />
                  </button>
                </>
              )}
            </div>

          {/* dots — below the card, centered */}
          {banners.length > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              {banners.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrent(i)}
                  aria-label={`الانتقال للشريحة ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === current ? "w-8 bg-primary" : "w-1.5 bg-slate-300 hover:bg-slate-400"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}