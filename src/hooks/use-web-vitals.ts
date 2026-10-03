"use client";

import { useEffect } from "react";
import { initWebVitalsMonitoring } from "@/lib/performance/web-vitals";

/**
 * Hook to initialize Web Vitals monitoring
 * Call once on app initialization (e.g., in root layout or _app)
 *
 * Usage:
 *   export default function RootLayout() {
 *     useWebVitals();
 *     return <>{children}</>;
 *   }
 */
export function useWebVitals(): void {
  useEffect(() => {
    // Initialize monitoring on mount
    initWebVitalsMonitoring();
  }, []);
}
