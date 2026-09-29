import { describe, it, expect } from "vitest";
import { buildOrderPaidConfirmationBody } from "./order-paid-confirm";

describe("buildOrderPaidConfirmationBody", () => {
  it("returns the base message when recovered_from_abandoned_count is 0", () => {
    const body = buildOrderPaidConfirmationBody({
      phone: "0500000000",
      customer_name: "أحمد",
      order_id: "abc-123",
      total: 100,
      recovered_from_abandoned_count: 0,
    });
    expect(body).toContain("تم تأكيد دفع طلبك #abc-123");
    expect(body).toContain("100.00 ر.س");
    expect(body).not.toContain("نلاحظ");
  });

  it("appends the recovery line when recovered_from_abandoned_count > 0", () => {
    const body = buildOrderPaidConfirmationBody({
      phone: "0500000000",
      customer_name: "أحمد",
      order_id: "abc-123",
      total: 100,
      recovered_from_abandoned_count: 2,
    });
    expect(body).toContain("تم تأكيد دفع طلبك #abc-123");
    expect(body).toContain("نلاحظ إنه عندك 2 سلات سابقة");
    expect(body).toContain("يسعدنا رجوعك");
  });

  it("singularises the count for 1 recovered cart", () => {
    const body = buildOrderPaidConfirmationBody({
      phone: "0500000000",
      customer_name: null,
      order_id: "abc-9",
      total: 50,
      recovered_from_abandoned_count: 1,
    });
    expect(body).toContain("نلاحظ إنه عندك 1 سلات");
  });

  it("defaults recovered_from_abandoned_count to 0 when undefined", () => {
    const body = buildOrderPaidConfirmationBody({
      phone: "0500000000",
      customer_name: null,
      order_id: "abc-1",
      total: 25,
    });
    expect(body).not.toContain("نلاحظ");
  });

  it("clamps negative counts to 0", () => {
    const body = buildOrderPaidConfirmationBody({
      phone: "0500000000",
      customer_name: null,
      order_id: "abc-1",
      total: 25,
      recovered_from_abandoned_count: -3,
    });
    expect(body).not.toContain("نلاحظ");
  });

  it("rounds total to two decimals", () => {
    const body = buildOrderPaidConfirmationBody({
      phone: "0500000000",
      customer_name: null,
      order_id: "abc-1",
      total: 12.345,
      recovered_from_abandoned_count: 0,
    });
    expect(body).toContain("12.35 ر.س");
  });
});
