"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X, Smartphone, Sparkles, ChevronLeft } from "lucide-react";
import { isAiChatRoute } from "@/lib/app-routes";

const STORAGE_KEY = "cm_app…ssed";
const APP_STORE_URL =
  "https://apps.apple.com/sa/app/citymarkets-food-grocery/id1269038878?adj_t=183w5xrn&utm_source=C1000149L&utm_medium=referral";

export function AppInstallBanner() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    const dismissed = localStorage.getItem(STORAGE_KEY) === "1";
    if (isMobile && !dismissed) setVisible(true);
  }, []);

  if (!visible || isAiChatRoute(pathname)) return null;

  return (
    <div dir="rtl" className="md:hidden relative w-full overflow-hidden">
      {/* Brand gradient backdrop — uses the primary green ramp so the
          banner reads as part of the City Markets identity. */}
      <div
        className="absolute inset-0 bg-gradient-to-l from-primary-700 via-primary to-primary-400"
        aria-hidden
      />
      {/* Soft glow layers for visual depth without an external image */}
      <div
        className="absolute inset-0 opacity-30"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 50%, rgba(255,255,255,0.35), transparent 45%), radial-gradient(circle at 90% 30%, rgba(255,255,255,0.2), transparent 50%)",
        }}
      />

      <div className="relative flex items-center gap-2.5 px-3 py-2.5 text-white">
        {/* Close button — proper X icon (was favicon.ico) */}
        <button
          type="button"
          aria-label="إغلاق"
          onClick={() => {
            try {
              localStorage.setItem(STORAGE_KEY, "1");
            } catch {}
            setVisible(false);
          }}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/30 backdrop-blur transition-colors"
        >
          <X className="w-4 h-4" strokeWidth={2.5} />
        </button>

        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="nofollow noreferrer noopener"
          className="flex-1 flex items-center gap-3 min-w-0 group"
        >
          {/* App icon tile with exclusive-perks badge */}
          <div className="relative shrink-0">
            <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-lg shadow-black/10">
              <img
                alt="City Markets"
                src="/favicon.ico?v=2"
                className="w-7 h-7"
              />
            </div>
            <span className="absolute -top-1 -start-1 w-4 h-4 rounded-full bg-amber-400 border-2 border-primary-600 flex items-center justify-center">
              <Sparkles className="w-2.5 h-2.5 text-amber-900" strokeWidth={3} />
            </span>
          </div>

          {/* Copy block — clear hierarchy: brand first, benefit second */}
          <div className="flex-1 min-w-0">
            <h3 className="text-[13.5px] font-extrabold leading-tight truncate flex items-center gap-1">
              <Smartphone className="w-3.5 h-3.5 shrink-0 opacity-90" strokeWidth={2.5} />
              <span>تجربة أسواق سيتي أفضل عبر التطبيق</span>
            </h3>
            <span className="text-[11px] opacity-90 truncate block mt-0.5">
              عروض حصرية + توصيل أسرع
            </span>
          </div>

          {/* CTA pill — chevron points "forward" in RTL */}
          <span className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-full bg-white text-primary-700 shadow-md shadow-black/10 group-hover:bg-primary-50 group-active:scale-95 transition-all">
            افتح
            <ChevronLeft className="w-3 h-3" strokeWidth={3} />
          </span>
        </a>
      </div>
    </div>
  );
}