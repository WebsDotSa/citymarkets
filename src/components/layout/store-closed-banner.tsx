"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, X, Clock } from "lucide-react";
import { isStorefrontRoute, isAiChatRoute } from "@/lib/app-routes";

const STORAGE_KEY = "cm_store_closed_dismissed_at";
// Re-show after 30 min so the user does not permanently silence an
// important site-wide notice.
const SUPPRESS_MS = 30 * 60 * 1000;

type HoursInfo = {
  enabled: boolean;
  open_time: string;
  close_time: string;
  message: string;
};

/**
 * Sticky top banner that appears whenever the admin has closed the
 * store OR we're currently outside the configured working hours.
 * Fetched on the client so the admin can flip the toggle and see
 * the change within ~30 s (the public endpoint's cache TTL) without
 * redeploying.
 *
 * Hidden on:
 *   - admin/vendor portals (`isStorefrontRoute` returns false there)
 *   - the AI chat surface (full-screen — the banner would push the
 *     messages down)
 */
export function StoreClosedBanner() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string>(
    "الموقع مغلق مؤقتاً — لا يمكن الشراء الآن عبر الموقع",
  );
  const [hours, setHours] = useState<HoursInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ts = Number(localStorage.getItem(STORAGE_KEY) || "0");
    if (ts && Date.now() - ts < SUPPRESS_MS) {
      setDismissed(true);
    }
  }, []);

  useEffect(() => {
    // Only run on the storefront — keeps API traffic + DOM weight off
    // the admin and vendor portals.
    if (!isStorefrontRoute(pathname)) return;
    if (isAiChatRoute(pathname)) return;

    const ac = new AbortController();
    fetch("/api/v1/store-status", { signal: ac.signal })
      .then((r) => r.json())
      .then((res) => {
        if (ac.signal.aborted) return;
        if (res && res.success) {
          // New API shape: `hours` is present when the admin has saved
          // working-hours config (or the default is shipped). Older
          // clients running against a backend without the field keep
          // working because we fall through to the legacy branch.
          if (res.hours && typeof res.hours === "object") {
            setHours({
              enabled: !!res.hours.enabled,
              open_time: String(res.hours.open_time || ""),
              close_time: String(res.hours.close_time || ""),
              message:
                typeof res.hours.message === "string" ? res.hours.message : "",
            });
          }
          if (res.is_open === false) {
            setOpen(true);
            if (typeof res.message === "string" && res.message.trim().length > 0) {
              setMessage(res.message);
            }
          } else {
            setOpen(false);
          }
        }
      })
      .catch(() => {
        // Network blip → do not flash a banner we can't verify.
        if (!ac.signal.aborted) setOpen(false);
      });
    return () => ac.abort();
  }, [pathname]);

  if (!open || dismissed) return null;
  if (isAiChatRoute(pathname)) return null;

  // Show working-hours chip only when the server told us the store is
  // closed specifically because of hours (admin toggle stays bare).
  const showHoursChip =
    hours && hours.enabled && hours.open_time && hours.close_time;

  return (
    <div
      dir="rtl"
      role="alert"
      aria-live="polite"
      className="sticky top-0 z-50 w-full bg-red-600 text-white shadow-md"
    >
      <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
        <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="text-sm sm:text-[15px] font-semibold leading-snug">
            {message}
          </p>
          {showHoursChip && (
            <p className="mt-0.5 flex items-center gap-1.5 text-[12px] sm:text-[13px] text-white/90">
              <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <span>
                ساعات العمل: {hours!.open_time} — {hours!.close_time}
              </span>
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="إخفاء الإشعار مؤقتاً"
          onClick={() => {
            try {
              localStorage.setItem(STORAGE_KEY, String(Date.now()));
            } catch {}
            setDismissed(true);
          }}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/30 transition-colors"
        >
          <X className="w-4 h-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
