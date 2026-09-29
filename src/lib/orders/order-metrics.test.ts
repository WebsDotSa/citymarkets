import { describe, it, expect } from "vitest";
import {
  REVENUE_ORDER_STATUS,
  REVENUE_PAYMENT_STATUS,
  isElectronicPaymentMethod,
  countsAsElectronicRevenue,
  SQL_REVENUE_ELIGIBLE,
} from "./order-metrics";

describe("constants", () => {
  it("REVENUE_ORDER_STATUS is 'confirmed'", () => {
    expect(REVENUE_ORDER_STATUS).toBe("confirmed");
  });

  it("REVENUE_PAYMENT_STATUS is 'paid'", () => {
    expect(REVENUE_PAYMENT_STATUS).toBe("paid");
  });

  it("SQL_REVENUE_ELIGIBLE is a non-empty SQL fragment", () => {
    expect(typeof SQL_REVENUE_ELIGIBLE).toBe("string");
    expect(SQL_REVENUE_ELIGIBLE.length).toBeGreaterThan(0);
    expect(SQL_REVENUE_ELIGIBLE).toMatch(/status\s*=\s*'confirmed'/i);
    expect(SQL_REVENUE_ELIGIBLE).toMatch(/payment_method/i);
  });
});

describe("isElectronicPaymentMethod", () => {
  it("returns false for null/undefined/empty", () => {
    expect(isElectronicPaymentMethod(null)).toBe(false);
    expect(isElectronicPaymentMethod(undefined)).toBe(false);
    expect(isElectronicPaymentMethod("")).toBe(false);
  });

  it("returns false for cash", () => {
    expect(isElectronicPaymentMethod("cash")).toBe(false);
    expect(isElectronicPaymentMethod("CASH")).toBe(false);
    expect(isElectronicPaymentMethod("Cash")).toBe(false);
  });

  it("returns false for wallet", () => {
    expect(isElectronicPaymentMethod("wallet")).toBe(false);
    expect(isElectronicPaymentMethod("WALLET")).toBe(false);
  });

  it("returns true for mada / visa / mastercard / apple_pay / stc_pay", () => {
    expect(isElectronicPaymentMethod("mada")).toBe(true);
    expect(isElectronicPaymentMethod("visa")).toBe(true);
    expect(isElectronicPaymentMethod("mastercard")).toBe(true);
    expect(isElectronicPaymentMethod("apple_pay")).toBe(true);
    expect(isElectronicPaymentMethod("stc_pay")).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(isElectronicPaymentMethod("  VISA  ")).toBe(true);
    expect(isElectronicPaymentMethod("  cash  ")).toBe(false);
  });
});

describe("countsAsElectronicRevenue", () => {
  it("returns true when status=confirmed and method is electronic", () => {
    expect(
      countsAsElectronicRevenue({
        status: "confirmed",
        payment_method: "mada",
      }),
    ).toBe(true);
  });

  it("is case-sensitive: 'CONFIRMED' !== 'confirmed' (callers must lowercase first)", () => {
    expect(
      countsAsElectronicRevenue({
        status: "CONFIRMED",
        payment_method: "visa",
      }),
    ).toBe(false);
  });

  it("returns false when status is not 'confirmed'", () => {
    expect(
      countsAsElectronicRevenue({
        status: "pending",
        payment_method: "mada",
      }),
    ).toBe(false);
    expect(
      countsAsElectronicRevenue({
        status: "on_the_way",
        payment_method: "mada",
      }),
    ).toBe(false);
    expect(
      countsAsElectronicRevenue({
        status: "delivered",
        payment_method: "mada",
      }),
    ).toBe(false);
    expect(
      countsAsElectronicRevenue({
        status: "cancelled",
        payment_method: "mada",
      }),
    ).toBe(false);
  });

  it("returns false when payment_method is cash / wallet / empty even if status=confirmed", () => {
    expect(
      countsAsElectronicRevenue({
        status: "confirmed",
        payment_method: "cash",
      }),
    ).toBe(false);
    expect(
      countsAsElectronicRevenue({
        status: "confirmed",
        payment_method: "wallet",
      }),
    ).toBe(false);
    expect(
      countsAsElectronicRevenue({
        status: "confirmed",
        payment_method: null,
      }),
    ).toBe(false);
    expect(
      countsAsElectronicRevenue({
        status: "confirmed",
      }),
    ).toBe(false);
  });

  it("handles null status and null payment_method safely", () => {
    expect(countsAsElectronicRevenue({})).toBe(false);
    expect(
      countsAsElectronicRevenue({
        status: null,
        payment_method: null,
      }),
    ).toBe(false);
  });
});