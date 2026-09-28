/**
 * Dynamic home layout — reads /api/v1/home-layout?device=... and renders
 * each section via the renderer registry. Falls back to the legacy
 * <HomeRedesign /> when the layout is empty so the storefront never
 * shows a blank page during the rollout window.
 *
 * Device detection uses `useIsDesktop()` (a useMediaQuery hook). The
 * server always renders the mobile layout first (matches the admin
 * default + keeps SSR output deterministic), then the client switches
 * to desktop after hydration if the viewport is wide.
 */
"use client";

import { useEffect, useState } from "react";
import { useIsDesktop } from "@/hooks/use-media-query";
import type { DeviceType, Section } from "@/lib/home-layout-types";
import { renderSection } from "./section-renderers";

interface LayoutResponse {
  device_type: DeviceType;
  sections: Section[];
  version: string;
  updated_at: string;
}

interface DynamicHomeLayoutProps {
  /** Server-side rendered initial value (optional). */
  initialLayout?: LayoutResponse | null;
  /** Fallback component when sections are empty. */
  fallback: React.ReactNode;
}

async function fetchLayout(device: DeviceType, signal: AbortSignal): Promise<LayoutResponse | null> {
  try {
    const res = await fetch(`/api/v1/home-layout?device=${device}`, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success: boolean; data?: LayoutResponse };
    if (!json.success || !json.data) return null;
    return json.data;
  } catch {
    return null;
  }
}

export function DynamicHomeLayout({ initialLayout, fallback }: DynamicHomeLayoutProps) {
  const isDesktop = useIsDesktop();
  const device: DeviceType = isDesktop ? "desktop" : "mobile";

  const [layout, setLayout] = useState<LayoutResponse | null>(initialLayout ?? null);

  useEffect(() => {
    // Skip the refetch on the very first render when the SSR payload
    // already covers this device — saves a roundtrip.
    if (initialLayout && initialLayout.device_type === device) return;

    const ac = new AbortController();
    fetchLayout(device, ac.signal).then((res) => {
      if (!ac.signal.aborted) setLayout(res);
    });
    return () => ac.abort();
    // We intentionally don't include `initialLayout` in deps — it's a
    // server-seeded initial value, not a reactive one. Re-fetching on
    // every layout prop change would defeat the purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  // No layout, or empty sections → fall back to the legacy composition
  // so the storefront never breaks during the rollout.
  if (!layout || !Array.isArray(layout.sections) || layout.sections.length === 0) {
    return <>{fallback}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {layout.sections.map((section, i) => (
        <div key={section.id ?? `${section.type}-${i}`}>{renderSection(section)}</div>
      ))}
    </div>
  );
}