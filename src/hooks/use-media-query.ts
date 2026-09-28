"use client";

/**
 * SSR-safe media query hook.
 *
 * Returns `false` during SSR (server always renders the desktop-first
 * fallback), then synchronizes with the real media query once mounted.
 *
 * The hook is intentionally tiny — no debounce, no event-listener
 * bookkeeping beyond what the platform provides. If you need a richer
 * abstraction (multiple breakpoints, derived values), build it on top.
 */
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  // Default to `false` on the server so the initial markup matches what
  // the smallest device gets. The component will re-render after mount
  // if the viewport is actually wider.
  const [matches, setMatches] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    // `addEventListener` is the modern API; `addListener` is the legacy
    // fallback for Safari < 14. Both are no-ops if already registered.
    if (mq.addEventListener) {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, [query]);

  return matches;
}

/** Convenience: returns `true` for desktop, `false` for mobile. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 768px)");
}