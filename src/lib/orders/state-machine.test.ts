/**
 * Tests for the central Order State Machine
 * (src/lib/orders/state-machine.ts).
 *
 * P2-1 (production hardening 2) — these tests replace the per-route
 * transition assertions that previously lived in driver + vendor route
 * tests. The state machine is now the single source of truth for
 * role-gated transitions; a regression here would mean a status flip
 * slipped through validation.
 */
import { describe, expect, it } from "vitest";

import {
  ALL_ORDER_STATES,
  ALL_PAYMENT_STATES,
  ALL_VENDOR_ORDER_STATES,
  InvalidTransitionError,
  assertValidTransition,
  canTransition,
  invalidTransitionMessage,
} from "./state-machine";

describe("canTransition — parent orders (orders.status)", () => {
  it("admin can move pending → confirmed", () => {
    expect(canTransition("admin", "orders", "pending", "confirmed")).toBe(true);
  });

  it("admin can move confirmed → shopping", () => {
    expect(canTransition("admin", "orders", "confirmed", "shopping")).toBe(true);
  });

  it("admin cannot skip intermediate states (pending → delivered)", () => {
    expect(canTransition("admin", "orders", "pending", "delivered")).toBe(false);
  });

  it("admin cannot move delivered (terminal)", () => {
    expect(canTransition("admin", "orders", "delivered", "cancelled")).toBe(false);
  });

  it("system can flip pending → confirmed (webhook lifecycle)", () => {
    expect(canTransition("system", "orders", "pending", "confirmed")).toBe(true);
  });

  it("driver can pick up from pending", () => {
    expect(canTransition("driver", "orders", "pending", "on_the_way")).toBe(true);
  });

  it("driver cannot pick up from confirmed (admin must hand off)", () => {
    expect(canTransition("driver", "orders", "confirmed", "on_the_way")).toBe(false);
  });

  it("driver cannot skip pending → delivered directly", () => {
    expect(canTransition("driver", "orders", "pending", "delivered")).toBe(false);
  });

  it("driver can complete on_the_way → delivered", () => {
    expect(canTransition("driver", "orders", "on_the_way", "delivered")).toBe(true);
  });

  it("driver can cancel from on_the_way", () => {
    expect(canTransition("driver", "orders", "on_the_way", "cancelled")).toBe(true);
  });

  it("vendor cannot write to orders.status", () => {
    // Vendors own vendor_orders.status; they have no authority on the
    // parent column. Any attempt should be rejected.
    expect(canTransition("vendor", "orders", "pending", "confirmed")).toBe(false);
  });

  it("customer can cancel a pending order only", () => {
    expect(canTransition("customer", "orders", "pending", "cancelled")).toBe(true);
    expect(canTransition("customer", "orders", "confirmed", "cancelled")).toBe(false);
    expect(canTransition("customer", "orders", "on_the_way", "cancelled")).toBe(false);
  });
});

describe("canTransition — vendor orders (vendor_orders.status)", () => {
  it("vendor can move pending → confirmed", () => {
    expect(canTransition("vendor", "vendor_orders", "pending", "confirmed")).toBe(true);
  });

  it("vendor can move confirmed → preparing", () => {
    expect(canTransition("vendor", "vendor_orders", "confirmed", "preparing")).toBe(true);
  });

  it("vendor can move preparing → ready", () => {
    expect(canTransition("vendor", "vendor_orders", "preparing", "ready")).toBe(true);
  });

  it("vendor can move ready → out_for_delivery", () => {
    expect(canTransition("vendor", "vendor_orders", "ready", "out_for_delivery")).toBe(true);
  });

  it("vendor can move out_for_delivery → delivered", () => {
    expect(canTransition("vendor", "vendor_orders", "out_for_delivery", "delivered")).toBe(true);
  });

  it("vendor cannot skip from confirmed to ready", () => {
    expect(canTransition("vendor", "vendor_orders", "confirmed", "ready")).toBe(false);
  });

  it("vendor cannot write to vendor_orders from driver role", () => {
    expect(canTransition("driver", "vendor_orders", "preparing", "ready")).toBe(false);
  });

  it("admin has same authority as vendor on vendor_orders", () => {
    expect(canTransition("admin", "vendor_orders", "confirmed", "preparing")).toBe(true);
  });
});

describe("canTransition — payment status", () => {
  it("system can flip pending → paid (gateway confirmed)", () => {
    expect(canTransition("system", "payment", "pending", "paid")).toBe(true);
  });

  it("system can flip pending → failed (gateway declined)", () => {
    expect(canTransition("system", "payment", "pending", "failed")).toBe(true);
  });

  it("system can flip paid → refunded", () => {
    expect(canTransition("system", "payment", "paid", "refunded")).toBe(true);
  });

  it("system can flip failed → pending (retry)", () => {
    expect(canTransition("system", "payment", "failed", "pending")).toBe(true);
  });

  it("system cannot flip paid → failed (no regression)", () => {
    expect(canTransition("system", "payment", "paid", "failed")).toBe(false);
  });

  it("system cannot flip refunded (terminal)", () => {
    expect(canTransition("system", "payment", "refunded", "paid")).toBe(false);
  });

  it("driver can flip pending → paid (COD collection)", () => {
    expect(canTransition("driver", "payment", "pending", "paid")).toBe(true);
  });

  it("driver cannot flip paid → refunded (refunds are admin-only)", () => {
    expect(canTransition("driver", "payment", "paid", "refunded")).toBe(false);
  });

  it("customer cannot directly flip payment status", () => {
    expect(canTransition("customer", "payment", "pending", "paid")).toBe(false);
    expect(canTransition("customer", "payment", "paid", "refunded")).toBe(false);
  });
});

describe("assertValidTransition", () => {
  it("does not throw on a valid transition", () => {
    expect(() => assertValidTransition("admin", "orders", "pending", "confirmed"))
      .not.toThrow();
  });

  it("throws InvalidTransitionError on a rejected transition", () => {
    try {
      assertValidTransition("customer", "orders", "on_the_way", "cancelled");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      expect((e as InvalidTransitionError).role).toBe("customer");
      expect((e as InvalidTransitionError).column).toBe("orders");
      expect((e as InvalidTransitionError).from).toBe("on_the_way");
      expect((e as InvalidTransitionError).to).toBe("cancelled");
    }
  });
});

describe("invalidTransitionMessage", () => {
  it("returns the lifecycle-flavored Arabic message for orders", () => {
    const msg = invalidTransitionMessage("customer", "orders", "on_the_way", "cancelled");
    expect(msg).toMatch(/لا يمكن تغيير حالة الطلب/);
  });

  it("returns the payment-flavored Arabic message for payment", () => {
    const msg = invalidTransitionMessage("customer", "payment", "paid", "refunded");
    expect(msg).toMatch(/لا يمكن تغيير حالة الدفع/);
  });
});

describe("ALL_*_STATES lists", () => {
  it("ALL_ORDER_STATES does NOT include 'paid' (lifecycle invariant)", () => {
    expect(ALL_ORDER_STATES).not.toContain("paid");
  });

  it("ALL_PAYMENT_STATES includes only payment-relevant values", () => {
    expect(new Set(ALL_PAYMENT_STATES)).toEqual(
      new Set(["pending", "paid", "failed", "refunded"]),
    );
  });

  it("ALL_VENDOR_ORDER_STATES includes vendor-only values not in parent", () => {
    expect(ALL_VENDOR_ORDER_STATES).toContain("preparing");
    expect(ALL_VENDOR_ORDER_STATES).toContain("ready");
    expect(ALL_VENDOR_ORDER_STATES).toContain("out_for_delivery");
    expect(ALL_VENDOR_ORDER_STATES).toContain("refunded");
  });
});
