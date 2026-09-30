/**
 * Tests for the payment-method registry (src/lib/payments/payment-methods.ts).
 *
 * P0-3 (full-system audit 2026-09-30): the legacy catalog orders route
 * used to accept arbitrary strings for `payment_method` (`cash`,
 * `tamara`, `moyasar_card`, `applepay`, …) and write them straight into
 * `orders.payment_method`. That broke the analytics filters downstream
 * (revenue under-counted). `resolvePaymentMethod` is the boundary that
 * turns legacy aliases into canonical `PaymentMethodId` values.
 */
import { describe, expect, it } from "vitest";

import {
  ALL_PAYMENT_METHODS,
  ALL_PAYMENT_METHODS_SET,
  PAYMENT_METHOD_ALIAS_MAP,
  PaymentMethodId,
  resolvePaymentMethod,
} from "./payment-methods";

describe("resolvePaymentMethod", () => {
  it("returns canonical values unchanged", () => {
    for (const m of ALL_PAYMENT_METHODS) {
      expect(resolvePaymentMethod(m)).toBe(m);
    }
  });

  it("translates every documented legacy alias", () => {
    const cases: Array<[string, PaymentMethodId]> = [
      ["cash", "wallet"],
      ["card", "mada"],
      ["moyasar", "mada"],
      ["moyasar_card", "mada"],
      ["moyasar_applepay", "apple_pay"],
      ["stc_pay", "bank_transfer"],
      ["stcpay", "bank_transfer"],
      ["tamara", "bank_transfer"],
      ["applepay", "apple_pay"],
      ["cod", "wallet"],
      ["cash_on_delivery", "wallet"],
      ["master_card", "mastercard"],
    ];
    for (const [legacy, canonical] of cases) {
      expect(resolvePaymentMethod(legacy)).toBe(canonical);
    }
  });

  it("defaults to 'wallet' when input is null/empty", () => {
    expect(resolvePaymentMethod(null)).toBe("wallet");
    expect(resolvePaymentMethod(undefined)).toBe("wallet");
    expect(resolvePaymentMethod("")).toBe("wallet");
  });

  it("throws on unknown payment-method strings (silent fallback is forbidden)", () => {
    expect(() => resolvePaymentMethod("bitcoin")).toThrow(/Unknown payment_method/);
    expect(() => resolvePaymentMethod("random_garbage")).toThrow();
  });
});

describe("ALL_PAYMENT_METHODS_SET", () => {
  it("matches the ALL_PAYMENT_METHODS tuple exactly", () => {
    expect(ALL_PAYMENT_METHODS_SET.size).toBe(ALL_PAYMENT_METHODS.length);
    for (const m of ALL_PAYMENT_METHODS) {
      expect(ALL_PAYMENT_METHODS_SET.has(m)).toBe(true);
    }
  });

  it("does NOT contain any legacy string", () => {
    for (const legacy of Object.keys(PAYMENT_METHOD_ALIAS_MAP)) {
      expect(ALL_PAYMENT_METHODS_SET.has(legacy)).toBe(false);
    }
  });
});

describe("PAYMENT_METHOD_ALIAS_MAP integrity", () => {
  it("every value is a canonical PaymentMethodId", () => {
    for (const [legacy, canonical] of Object.entries(PAYMENT_METHOD_ALIAS_MAP)) {
      expect(ALL_PAYMENT_METHODS_SET.has(canonical)).toBe(true);
      expect(legacy).not.toBe(canonical); // no self-mapping
    }
  });
});
