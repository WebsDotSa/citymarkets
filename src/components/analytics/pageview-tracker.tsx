"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const COOKIE_NAME = "session_id";
const SESSION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * SECURITY (PCP-144, Phase 15 Frontend Audit): the session_id cookie is
 * set client-side via `document.cookie`, so the browser only includes
 * the `Secure` flag when the page itself was served over HTTPS — the
 * dev server at http://127.0.0.1:3005 would otherwise refuse to write
 * the cookie. We probe `window.location.protocol` and append `Secure`
 * only when the page is HTTPS. Production is HTTPS (terminated at the
 * proxy), so production deployments correctly receive the flag.
 */
function isHttps(): boolean {
  if (typeof window === "undefined") return false;
  return window.location?.protocol === "https:";
}

function getSessionId(): string {
  if (typeof document === "undefined") return "";
  // Reuse session_id cookie set by middleware when present.
  const existing = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${COOKIE_NAME}=`))
    ?.split("=")[1];
  if (existing) return existing;

  // Otherwise mint a short-lived one.
  const id = crypto.randomUUID?.() ?? `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toUTCString();
  const secure = isHttps() ? "; Secure" : "";
  document.cookie = `${COOKIE_NAME}=${id}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax${secure}`;
  return id;
}

function send(path: string, referrer: string, sessionId: string) {
  // Use sendBeacon if available — it survives page unloads.
  const payload = JSON.stringify({ path, referrer, sessionId });
  if (navigator.sendBeacon?.("/api/v1/analytics/pageview", new Blob([payload], { type: "application/json" }))) {
    return;
  }
  // Fallback to fetch with keepalive.
  fetch("/api/v1/analytics/pageview", {
    method: "POST",
    body: payload,
    headers: { "Content-Type": "application/json" },
    keepalive: true,
  }).catch(() => {});
}

export function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    const sessionId = getSessionId();
    const fullPath = searchParams?.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname;
    const referrer = document.referrer || "";
    // Debounce: if the user navigates between sub-views, throttle to 1s.
    const timer = setTimeout(() => send(fullPath, referrer, sessionId), 800);
    return () => clearTimeout(timer);
  }, [pathname, searchParams]);

  return null;
}
