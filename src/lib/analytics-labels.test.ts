import { describe, it, expect } from "vitest";
import {
  VENDOR_TYPE_AR,
  EVENT_NAME_AR,
  ANALYTICS_TABS,
  VENDOR_TYPE_FILTER,
  COUNTRY_AR,
  METRIC_LABELS,
  getVendorTypeAr,
  getEventNameAr,
  getCountryAr,
} from "./analytics-labels";

describe("analytics-labels", () => {
  describe("VENDOR_TYPE_AR", () => {
    it("covers every vendor type in the DB CHECK constraint", () => {
      // These five vendor types are enforced by migration 010.
      for (const key of [
        "food_beverage",
        "fashion",
        "gifts",
        "electronics",
        "services",
      ]) {
        expect(VENDOR_TYPE_AR[key]).toBeTruthy();
      }
    });
  });

  describe("EVENT_NAME_AR", () => {
    it("covers the canonical event names emitted by useAnalytics", () => {
      for (const key of ["add_to_cart", "checkout_start", "purchase", "search", "signup"]) {
        expect(EVENT_NAME_AR[key]).toBeTruthy();
      }
    });
  });

  describe("ANALYTICS_TABS", () => {
    it("has a stable, unique set of values", () => {
      const values = ANALYTICS_TABS.map((t) => t.value);
      expect(new Set(values).size).toBe(values.length);
      expect(values).toContain("overview");
      expect(values).toContain("visitors");
      expect(values).toContain("orders");
      expect(values).toContain("products");
    });

    it("labels are non-empty Arabic", () => {
      for (const t of ANALYTICS_TABS) {
        expect(t.label.length).toBeGreaterThan(0);
      }
    });
  });

  describe("VENDOR_TYPE_FILTER", () => {
    it("starts with the 'all' option", () => {
      expect(VENDOR_TYPE_FILTER[0].value).toBe("");
      expect(VENDOR_TYPE_FILTER[0].label).toBe("كل المتاجر");
    });

    it("includes every vendor type", () => {
      const nonEmpty = VENDOR_TYPE_FILTER.filter((v) => v.value !== "");
      expect(nonEmpty.length).toBe(Object.keys(VENDOR_TYPE_AR).length);
    });
  });

  describe("getVendorTypeAr", () => {
    it("returns Arabic for known types", () => {
      expect(getVendorTypeAr("food_beverage")).toBe("مطاعم ومقاهي");
      expect(getVendorTypeAr("fashion")).toBe("أزياء وعبايات");
    });

    it("falls back to the slug for unknown types", () => {
      expect(getVendorTypeAr("custom_type")).toBe("custom_type");
    });

    it("returns em-dash for nullish", () => {
      expect(getVendorTypeAr(null)).toBe("—");
      expect(getVendorTypeAr(undefined)).toBe("—");
      expect(getVendorTypeAr("")).toBe("—");
    });
  });

  describe("getEventNameAr", () => {
    it("returns Arabic for known events", () => {
      expect(getEventNameAr("add_to_cart")).toBe("إضافة إلى السلة");
      expect(getEventNameAr("purchase")).toBe("إتمام الطلب");
    });

    it("falls back to the event name for unknown values", () => {
      expect(getEventNameAr("custom_event")).toBe("custom_event");
    });
  });

  describe("getCountryAr", () => {
    it("returns Arabic for known country codes", () => {
      expect(getCountryAr("SA")).toBe("السعودية");
      expect(getCountryAr("AE")).toBe("الإمارات");
    });

    it("uppercases unknown codes", () => {
      expect(getCountryAr("xx")).toBe("XX");
    });

    it("returns 'غير محدد' for missing codes", () => {
      expect(getCountryAr(null)).toBe("غير محدد");
      expect(getCountryAr("")).toBe("غير محدد");
    });
  });

  describe("COUNTRY_AR", () => {
    it("includes Saudi Arabia (the primary market)", () => {
      expect(COUNTRY_AR.SA).toBeTruthy();
    });
  });

  describe("METRIC_LABELS", () => {
    it("defines all keys referenced by the analytics UI", () => {
      for (const key of [
        "revenue",
        "orders",
        "averageOrder",
        "visitors",
        "pageViews",
        "conversion",
        "uniqueSessions",
        "topCountry",
        "pagesPerSession",
        "mobile",
        "desktop",
        "tablet",
      ]) {
        expect(METRIC_LABELS[key as keyof typeof METRIC_LABELS]).toBeTruthy();
      }
    });
  });
});
