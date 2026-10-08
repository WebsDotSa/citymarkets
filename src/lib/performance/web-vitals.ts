/**
 * Web Vitals monitoring for Core Web Vitals metrics.
 *
 * Metrics tracked:
 * - LCP (Largest Contentful Paint): When the largest element becomes visible
 * - FID (First Input Delay): Time from user input to browser responsiveness
 * - CLS (Cumulative Layout Shift): Unexpected visual shifts during page load
 * - FCP (First Contentful Paint): When first content appears
 * - TTFB (Time To First Byte): Server response time
 *
 * Send metrics to analytics (Google Analytics, monitoring service, etc.)
 */

export interface WebVital {
  name: string;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  delta?: number;
  id: string;
  navigationType?: string;
  entries?: PerformanceEntryList;
}

export interface CWVThresholds {
  good: number;
  needsImprovement: number;
}

// Core Web Vitals thresholds (milliseconds)
const THRESHOLDS: Record<string, CWVThresholds> = {
  LCP: { good: 2500, needsImprovement: 4000 },
  FID: { good: 100, needsImprovement: 300 },
  CLS: { good: 0.1, needsImprovement: 0.25 },
  FCP: { good: 1800, needsImprovement: 3000 },
  TTFB: { good: 600, needsImprovement: 1200 },
};

/**
 * Determine rating based on metric value and thresholds
 */
function getRating(metric: string, value: number): "good" | "needs-improvement" | "poor" {
  const threshold = THRESHOLDS[metric];
  if (!threshold) return "good";

  if (value <= threshold.good) return "good";
  if (value <= threshold.needsImprovement) return "needs-improvement";
  return "poor";
}

/**
 * Report a Web Vital metric
 */
export function reportWebVital(vital: WebVital): void {
  // Send to analytics service (Google Analytics, custom monitoring, etc.)
  if (typeof window !== "undefined" && "gtag" in window) {
    const gtag = (window as any).gtag as Function;
    gtag("event", vital.name, {
      event_category: "Web Vitals",
      event_label: vital.id,
      value: Math.round(vital.value),
      event_callback: undefined,
    });
  }

  // Log to console in development
  if (process.env.NODE_ENV === "development") {
    const color =
      vital.rating === "good"
        ? "color: green"
        : vital.rating === "needs-improvement"
          ? "color: orange"
          : "color: red";
    console.log(
      `%c${vital.name}`,
      `${color}; font-weight: bold`,
      `${vital.value.toFixed(2)}ms (${vital.rating})`
    );
  }
}

/**
 * Monitor Core Web Vitals using PerformanceObserver
 */
export function initWebVitalsMonitoring(): void {
  if (typeof window === "undefined") return;

  const storedMetrics: Record<string, number> = {};

  // Observe layout shift (CLS)
  try {
    const clsObserver = new PerformanceObserver((list) => {
      let cls = 0;
      for (const entry of list.getEntries()) {
        if ((entry as any).hadRecentInput) continue;
        cls += (entry as any).value;
      }
      if (cls !== storedMetrics["CLS"]) {
        storedMetrics["CLS"] = cls;
        reportWebVital({
          name: "CLS",
          value: cls,
          rating: getRating("CLS", cls),
          id: `cls-${Date.now()}`,
        });
      }
    });
    clsObserver.observe({ entryTypes: ["layout-shift"] });
  } catch (e) {
    console.warn("CLS observer not supported:", e);
  }

  // Observe largest contentful paint (LCP)
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1];
      const lcp = (lastEntry as any).renderTime || (lastEntry as any).loadTime;

      reportWebVital({
        name: "LCP",
        value: lcp,
        rating: getRating("LCP", lcp),
        id: `lcp-${(lastEntry as any).startTime}`,
      });
    });
    lcpObserver.observe({ entryTypes: ["largest-contentful-paint"] });
  } catch (e) {
    console.warn("LCP observer not supported:", e);
  }

  // Observe first input delay (FID) via PerformanceObserver
  try {
    const fidObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const entry = entries[0];
      const fid = (entry as any).processingDuration;

      reportWebVital({
        name: "FID",
        value: fid,
        rating: getRating("FID", fid),
        id: `fid-${(entry as any).startTime}`,
      });
    });
    fidObserver.observe({ entryTypes: ["first-input"] });
  } catch (e) {
    console.warn("FID observer not supported:", e);
  }

  // Fallback: Use navigation timing for TTFB (available in all browsers)
  if (performance.timing) {
    window.addEventListener("load", () => {
      const ttfb = performance.timing.responseStart - performance.timing.navigationStart;
      if (ttfb > 0) {
        reportWebVital({
          name: "TTFB",
          value: ttfb,
          rating: getRating("TTFB", ttfb),
          id: `ttfb-${Date.now()}`,
        });
      }
    });
  }
}

/**
 * Get all Web Vitals measurements in a single snapshot
 */
export function getWebVitalsMeasurements(): Partial<Record<string, number>> {
  const measurements: Partial<Record<string, number>> = {};

  // LCP
  const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
  if (lcpEntries.length > 0) {
    const lastLcp = lcpEntries[lcpEntries.length - 1];
    measurements.LCP = (lastLcp as any).renderTime || (lastLcp as any).loadTime;
  }

  // CLS
  const clsEntries = performance.getEntriesByType("layout-shift");
  let cls = 0;
  for (const entry of clsEntries) {
    if ((entry as any).hadRecentInput) continue;
    cls += (entry as any).value;
  }
  measurements.CLS = cls;

  // FCP
  const fcpEntries = performance.getEntriesByName("first-contentful-paint");
  if (fcpEntries.length > 0) {
    measurements.FCP = fcpEntries[0].startTime;
  }

  // TTFB
  if (performance.timing) {
    measurements.TTFB = performance.timing.responseStart - performance.timing.navigationStart;
  }

  return measurements;
}
