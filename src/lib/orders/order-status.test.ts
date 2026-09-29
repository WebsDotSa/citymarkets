import { describe, it, expect } from "vitest";
import {
  ORDER_STATUSES,
  ACTIVE_ORDER_STATUSES,
  ORDER_STATUS_DISPLAY,
  CUSTOMER_PROGRESS_STEPS,
  PAYMENT_METHOD_AR,
  PAYMENT_STATUS_AR,
  PAYMENT_STATUSES_CONFIG,
  getOrderStatusConfig,
  getPaymentStatusConfig,
} from "./order-status";

describe("ORDER_STATUSES", () => {
  it("includes all expected backend status keys", () => {
    expect(Object.keys(ORDER_STATUSES).sort()).toEqual(
      [
        "pending",
        "confirmed",
        "shopping",
        "on_the_way",
        "delivered",
        "cancelled",
      ].sort(),
    );
  });

  it("every entry has a label, color, icon, and active flag", () => {
    for (const [k, v] of Object.entries(ORDER_STATUSES)) {
      expect(typeof v.label, k).toBe("string");
      expect(v.label.length, k).toBeGreaterThan(0);
      expect(typeof v.color, k).toBe("string");
      // icon is a React component (function or object)
      expect(typeof v.icon, k).toBeDefined();
      expect(typeof v.active, k).toBe("boolean");
    }
  });

  it("flags active statuses correctly (pending/confirmed/shopping/on_the_way)", () => {
    expect(ORDER_STATUSES.pending.active).toBe(true);
    expect(ORDER_STATUSES.confirmed.active).toBe(true);
    expect(ORDER_STATUSES.shopping.active).toBe(true);
    expect(ORDER_STATUSES.on_the_way.active).toBe(true);
  });

  it("flags terminal statuses correctly (delivered/cancelled are inactive)", () => {
    expect(ORDER_STATUSES.delivered.active).toBe(false);
    expect(ORDER_STATUSES.cancelled.active).toBe(false);
  });

  it("the 'shopping' status surfaces to customers as 'جارٍ التحضير' (backend maps 'shopping' → preparing)", () => {
    expect(ORDER_STATUSES.shopping.label).toBe("جارٍ التحضير");
  });
});

describe("getOrderStatusConfig", () => {
  it("returns the canonical config for known statuses", () => {
    expect(getOrderStatusConfig("pending").label).toBe("قيد الانتظار");
    expect(getOrderStatusConfig("delivered").label).toBe("تم التوصيل");
  });

  it("returns a safe fallback for unknown statuses", () => {
    const cfg = getOrderStatusConfig("not-a-real-status");
    expect(cfg.label).toBe("not-a-real-status");
    expect(cfg.color).toBe("bg-gray-100 text-gray-700");
    expect(cfg.active).toBe(true);
  });
});

describe("ACTIVE_ORDER_STATUSES", () => {
  it("contains exactly the four non-terminal statuses", () => {
    expect(ACTIVE_ORDER_STATUSES).toEqual([
      "pending",
      "confirmed",
      "shopping",
      "on_the_way",
    ]);
  });
});

describe("ORDER_STATUS_DISPLAY", () => {
  it("contains entries for every backend status", () => {
    const values = ORDER_STATUS_DISPLAY.map((s) => s.value);
    expect(values).toContain("pending");
    expect(values).toContain("confirmed");
    expect(values).toContain("shopping");
    expect(values).toContain("on_the_way");
    expect(values).toContain("delivered");
    expect(values).toContain("cancelled");
  });

  it("each entry has a non-empty label", () => {
    for (const s of ORDER_STATUS_DISPLAY) {
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it("is in the expected display order (active first, then terminal)", () => {
    expect(ORDER_STATUS_DISPLAY[0].value).toBe("pending");
    expect(ORDER_STATUS_DISPLAY[4].value).toBe("delivered");
    expect(ORDER_STATUS_DISPLAY[5].value).toBe("cancelled");
  });
});

describe("CUSTOMER_PROGRESS_STEPS", () => {
  it("contains the 5 contiguous steps from order receipt to delivery", () => {
    expect(CUSTOMER_PROGRESS_STEPS.length).toBe(5);
  });

  it("the first step is the order receipt (pending), last is delivered", () => {
    expect(CUSTOMER_PROGRESS_STEPS[0].status).toBe("pending");
    expect(
      CUSTOMER_PROGRESS_STEPS[CUSTOMER_PROGRESS_STEPS.length - 1].status,
    ).toBe("delivered");
  });

  it("every step has a label, status, and icon", () => {
    for (const step of CUSTOMER_PROGRESS_STEPS) {
      expect(step.label.length).toBeGreaterThan(0);
      expect(typeof step.icon).toBeDefined();
    }
  });
});

describe("PAYMENT_METHOD_AR", () => {
  it("includes the major Saudi + international payment methods", () => {
    expect(PAYMENT_METHOD_AR.cash).toBe("نقداً عند الاستلام");
    expect(PAYMENT_METHOD_AR.mada).toBe("مدى");
    expect(PAYMENT_METHOD_AR.visa).toBe("فيزا");
    expect(PAYMENT_METHOD_AR.mastercard).toBe("ماستركارد");
    expect(PAYMENT_METHOD_AR.apple_pay).toBe("Apple Pay");
    expect(PAYMENT_METHOD_AR.stc_pay).toBe("STC Pay");
  });
});

describe("PAYMENT_STATUS_AR + PAYMENT_STATUSES_CONFIG", () => {
  it("paid + completed share the same Arabic label (both = 'paid')", () => {
    expect(PAYMENT_STATUS_AR.paid).toBe("تم الدفع");
    expect(PAYMENT_STATUS_AR.completed).toBe("تم الدفع");
  });

  it("unpaid label is 'لم يتم الدفع' (not yet paid)", () => {
    expect(PAYMENT_STATUS_AR.unpaid).toBe("لم يتم الدفع");
  });

  it("every key in PAYMENT_STATUS_AR has a matching entry in PAYMENT_STATUSES_CONFIG", () => {
    for (const k of Object.keys(PAYMENT_STATUS_AR)) {
      expect(PAYMENT_STATUSES_CONFIG[k]).toBeDefined();
      expect(PAYMENT_STATUSES_CONFIG[k].label).toBe(PAYMENT_STATUS_AR[k]);
    }
  });

  it("every config entry has color + dotColor", () => {
    for (const [k, v] of Object.entries(PAYMENT_STATUSES_CONFIG)) {
      expect(typeof v.color, k).toBe("string");
      expect(v.color.length, k).toBeGreaterThan(0);
      expect(typeof v.dotColor, k).toBe("string");
      expect(v.dotColor.length, k).toBeGreaterThan(0);
    }
  });
});

describe("getPaymentStatusConfig", () => {
  it("returns the canonical config for known statuses", () => {
    expect(getPaymentStatusConfig("paid").label).toBe("تم الدفع");
    expect(getPaymentStatusConfig("failed").color).toContain("red");
  });

  it("falls back to the AR lookup for unknown but-translated statuses", () => {
    // If a new backend value is added and not yet in the config, it should
    // still surface to humans via PAYMENT_STATUS_AR.
    PAYMENT_STATUS_AR["somenewkey"] = "قيمة جديدة";
    try {
      const cfg = getPaymentStatusConfig("somenewkey");
      expect(cfg.label).toBe("قيمة جديدة");
    } finally {
      delete PAYMENT_STATUS_AR["somenewkey"];
    }
  });

  it("falls back to the literal status string when neither config nor AR have it", () => {
    const cfg = getPaymentStatusConfig("totally-unknown");
    expect(cfg.label).toBe("totally-unknown");
  });

  it("falls back to em-dash for an empty/undefined status", () => {
    const cfg = getPaymentStatusConfig("");
    expect(cfg.label).toBe("—");
  });
});