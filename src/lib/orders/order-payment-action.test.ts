import { describe, it, expect } from "vitest";
import { ONLINE_RETRY_METHODS } from "@/lib/payments/payment-methods";
import {
  getOrderPaymentAction,
  isRetryableOrderPayment,
  type OrderPaymentAction,
} from "./order-payment-action";

describe("ONLINE_RETRY_METHODS (re-exported via payment-methods)", () => {
  it("includes the unified online payment methods (excluding tamara which is order-level)", () => {
    expect(ONLINE_RETRY_METHODS).toContain("mada");
    expect(ONLINE_RETRY_METHODS).toContain("visa");
    expect(ONLINE_RETRY_METHODS).toContain("mastercard");
    expect(ONLINE_RETRY_METHODS).toContain("amex");
    expect(ONLINE_RETRY_METHODS).toContain("apple_pay");
  });

  it("contains exactly the supported cards + wallets", () => {
    expect(new Set(ONLINE_RETRY_METHODS).size).toBe(
      ONLINE_RETRY_METHODS.length,
    );
  });
});

describe("getOrderPaymentAction", () => {
  const cases: Array<{
    label: string;
    input: Parameters<typeof getOrderPaymentAction>[0];
    expected: OrderPaymentAction;
  }> = [
    {
      label: "unpaid + pending order => pay",
      input: { status: "pending", paymentStatus: "unpaid", paymentMethod: "mada" },
      expected: "pay",
    },
    {
      label: "unpaid + active order (confirmed) => pay",
      input: { status: "confirmed", paymentStatus: "unpaid", paymentMethod: "visa" },
      expected: "pay",
    },
    {
      label: "failed + pending order => retry",
      input: { status: "pending", paymentStatus: "failed", paymentMethod: "mada" },
      expected: "retry",
    },
    {
      label: "failed + cancelled order => retry (auto-cancelled payment failure)",
      input: { status: "cancelled", paymentStatus: "failed", paymentMethod: "mada" },
      expected: "retry",
    },
    {
      label: "failed + delivered order => none (terminal)",
      input: { status: "delivered", paymentStatus: "failed", paymentMethod: "mada" },
      expected: "none",
    },
    {
      label: "unpaid + cancelled order => none (admin/manual cancel)",
      input: { status: "cancelled", paymentStatus: "unpaid", paymentMethod: "visa" },
      expected: "none",
    },
    {
      label: "unpaid + delivered order => none",
      input: { status: "delivered", paymentStatus: "unpaid", paymentMethod: "visa" },
      expected: "none",
    },
    {
      label: "paid + pending order => none",
      input: { status: "pending", paymentStatus: "paid", paymentMethod: "mada" },
      expected: "none",
    },
    {
      label: "completed status => none",
      input: { status: "completed", paymentStatus: null, paymentMethod: "mada" },
      expected: "none",
    },
    {
      label: "refunded payment => none",
      input: { status: "pending", paymentStatus: "refunded", paymentMethod: "mada" },
      expected: "none",
    },
    {
      label: "pending payment + cash order => pay (still needs to pay)",
      input: { status: "pending", paymentStatus: "pending", paymentMethod: "cash" },
      expected: "pay",
    },
    {
      label: "pending payment + wallet order => pay",
      input: { status: "pending", paymentStatus: "pending", paymentMethod: "wallet" },
      expected: "pay",
    },
    {
      label: "pending payment + online order => none (already in flight)",
      input: { status: "pending", paymentStatus: "pending", paymentMethod: "mada" },
      expected: "none",
    },
    {
      label: "unknown order status => none (fail closed)",
      input: { status: "mystery", paymentStatus: "unpaid", paymentMethod: "mada" },
      expected: "none",
    },
    {
      label: "empty inputs => none",
      input: { status: "", paymentStatus: "", paymentMethod: "" },
      expected: "none",
    },
  ];

  for (const c of cases) {
    it(c.label, () => {
      expect(getOrderPaymentAction(c.input)).toBe(c.expected);
    });
  }
});

describe("isRetryableOrderPayment", () => {
  it("returns true only when getOrderPaymentAction === 'retry'", () => {
    expect(
      isRetryableOrderPayment({
        status: "cancelled",
        paymentStatus: "failed",
        paymentMethod: "mada",
      }),
    ).toBe(true);
    expect(
      isRetryableOrderPayment({
        status: "pending",
        paymentStatus: "unpaid",
        paymentMethod: "mada",
      }),
    ).toBe(false);
  });
});
