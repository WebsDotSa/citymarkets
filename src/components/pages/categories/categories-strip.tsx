"use client";

/**
 * MainCatsImageStrip
 *
 * The sticky horizontal scroller of root-category image cards that sits
 * between the hero and the main grid. Renders medium image cards (image
 * + name + product count) instead of text pills.
 *
 *   • Mobile  : horizontal scroll (snap), 96×96 image + name under it
 *   • Desktop : responsive grid, medium image cards in marketing order
 *
 * The image is sourced from `icon_url` when present, otherwise falls back
 * to a per-category emoji on a colored gradient.
 */

import { useEffect, useRef } from "react";
import { ChevronLeft } from "lucide-react";
import type { CategoryTreeNode } from '@/lib/catalog';
import {
  getCategoryEmoji,
  resolveCategoryImageSrc,
} from '@/lib/catalog';
import { emojiForCategoryName } from '@/lib/catalog';

interface MainCatsImageStripProps {
  roots: CategoryTreeNode[];
  activeId: string | null;
  onSelect: (id: string) => void;
  totalProducts: number;
}

export function MainCatsImageStrip({
  roots,
  activeId,
  onSelect,
  totalProducts,
}: MainCatsImageStripProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeId || !scrollerRef.current) return;
    const el = scrollerRef.current.querySelector<HTMLElement>(
      `[data-root-id="${activeId}"]`,
    );
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  }, [activeId]);

  const scroll = (direction: "left" | "right") => {
    if (!scrollerRef.current) return;
    const scrollAmount = direction === "left" ? -280 : 280;
    scrollerRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" });
  };

  return (
    <nav
      aria-label="الأقسام الرئيسية"
      className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-100 shadow-xs"
    >
      <div className="px-4 sm:px-6 max-w-6xl mx-auto py-2.5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[11px] font-black text-slate-500 uppercase tracking-wider">
            الأقسام الرئيسية
          </p>
          <span
            className="text-[11px] text-slate-400 font-bold tabular-nums"
            dir="ltr"
          >
            {roots.length} · {totalProducts.toLocaleString("en-US")} منتج
          </span>
        </div>

        {/* Horizontal scroller with navigation arrows for desktop */}
        <div className="relative group/strip">
          {/* Scroll Right Button (moves towards right in RTL) */}
          <button
            type="button"
            onClick={() => scroll("right")}
            aria-label="التمرير لليمن"
            className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 items-center justify-center rounded-full bg-white/90 shadow-md border border-slate-200 text-slate-700 hover:bg-white hover:scale-105 active:scale-95 transition-all"
          >
            <ChevronLeft className="w-4 h-4 rotate-180" aria-hidden="true" />
          </button>

          {/* Scrollable Container - pure horizontal flex on all screen sizes */}
          <div
            ref={scrollerRef}
            className="flex items-center gap-2 overflow-x-auto scrollbar-none py-1 px-0.5 scroll-smooth"
            style={{
              scrollSnapType: "x mandatory",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            }}
          >
            {roots.map((root) => {
              const isActive = String(root.id) === activeId;
              const src = resolveCategoryImageSrc(root.icon_url);
              const emoji = getCategoryEmoji(
                root.icon_url,
                emojiForCategoryName(root.name_ar),
              );
              return (
                <button
                  key={root.id}
                  type="button"
                  data-root-id={String(root.id)}
                  onClick={() => onSelect(String(root.id))}
                  aria-current={isActive ? "true" : undefined}
                  aria-label={`${root.name_ar} — ${root.descendantCount} منتج`}
                  className={`shrink-0 w-[88px] sm:w-[104px] group relative flex flex-col items-center gap-1.5 p-2 sm:p-2.5 rounded-2xl border transition-all text-center ${
                    isActive
                      ? "border-[#009345] bg-white shadow-md ring-1 ring-[#009345]/40"
                      : "border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm"
                  }`}
                  style={{ scrollSnapAlign: "center" }}
                >
                  <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-white overflow-hidden flex items-center justify-center transition-transform group-hover:scale-105">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span
                        className="text-2xl sm:text-3xl drop-shadow-xs select-none"
                        aria-hidden="true"
                      >
                        {emoji}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[11px] font-bold leading-tight line-clamp-1 w-full px-0.5 ${
                      isActive ? "text-[#007A38]" : "text-slate-700"
                    }`}
                  >
                    {root.name_ar}
                  </span>
                  <span
                    className={`text-[9px] font-bold tabular-nums ${
                      isActive ? "text-[#007A38]/80" : "text-slate-400"
                    }`}
                    dir="ltr"
                  >
                    {root.descendantCount.toLocaleString("en-US")}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Scroll Left Button (moves towards left in RTL) */}
          <button
            type="button"
            onClick={() => scroll("left")}
            aria-label="التمرير لليسار"
            className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 items-center justify-center rounded-full bg-white/90 shadow-md border border-slate-200 text-slate-700 hover:bg-white hover:scale-105 active:scale-95 transition-all"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </nav>
  );
}
