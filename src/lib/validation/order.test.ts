import { describe, it, expect } from "vitest";
import { orderEditSchema, orderStatusSchema, updateOrderSchema } from "./order";

/**
 * Regression tests for P0-4 — orderEditSchema enum mismatch.
 *
 * Bug: orderEditSchema accepted vendor-only status values
 * ('preparing', 'accepted', 'in_progress') which are NOT in the
 * Postgres `order_status_enum` on the parent `orders` table. An admin
 * POSTing `{status: "preparing"}` would pass Zod validation, then
 * crash at the DB with `invalid input value for enum order_status_enum`.
 *
 * Fix: orderEditSchema now reuses orderStatusSchema, which mirrors
 * `order_status_enum` exactly. 'paid' is intentionally excluded —
 * it's a payment_status only and must never be written to the
 * lifecycle column.
 */

describe("orderStatusSchema (parent orders.status enum)", () => {
  it("accepts every value in order_status_enum (migration 001+033 minus 'paid')", () => {
    for (const v of [
      "pending",
      "confirmed",
      "shopping",
      "on_the_way",
      "delivered",
      "cancelled",
    ]) {
      expect(orderStatusSchema.safeParse(v).success).toBe(true);
    }
  });

  it("rejects 'paid' (payment_status only)", () => {
    expect(orderStatusSchema.safeParse("paid").success).toBe(false);
  });

  it("rejects vendor-only statuses", () => {
    for (const v of ["preparing", "accepted", "in_progress", "ready", "out_for_delivery"]) {
      expect(orderStatusSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe("orderEditSchema (admin PATCH /api/admin/orders/[id])", () => {
  it("accepts a valid status with the parent enum only", () => {
    const parsed = orderEditSchema.safeParse({ status: "confirmed" });
    expect(parsed.success).toBe(true);
  });

  it("REJECTS vendor-only status 'preparing' (P0-4 regression)", () => {
    // Pre-fix: this passed Zod and crashed at the DB with
    // `invalid input value for enum order_status_enum: "preparing"`.
    // Post-fix: caught at the API boundary with 400.
    const parsed = orderEditSchema.safeParse({ status: "preparing" });
    expect(parsed.success).toBe(false);
  });

  it("REJECTS vendor-only status 'accepted'", () => {
    const parsed = orderEditSchema.safeParse({ status: "accepted" });
    expect(parsed.success).toBe(false);
  });

  it("REJECTS vendor-only status 'in_progress'", () => {
    const parsed = orderEditSchema.safeParse({ status: "in_progress" });
    expect(parsed.success).toBe(false);
  });

  it("REJECTS 'paid' (payment_status only)", () => {
    const parsed = orderEditSchema.safeParse({ status: "paid" });
    expect(parsed.success).toBe(false);
  });

  it("accepts a fully-formed edit body with items + status", () => {
    const parsed = orderEditSchema.safeParse({
      status: "on_the_way",
      internal_notes: "Driver delayed",
      final_subtotal: 99.5,
      final_delivery_fee: 10,
      items: [
        { itemId: "00000000-0000-0000-0000-000000000001", resolved_price: 50 },
      ],
      driver_id: null,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("updateOrderSchema (admin PUT /api/admin/orders)", () => {
  it("accepts parent-enum statuses only", () => {
    for (const v of ["pending", "confirmed", "shopping", "on_the_way", "delivered", "cancelled"]) {
      expect(updateOrderSchema.safeParse({ status: v }).success).toBe(true);
    }
  });

  it("REJECTS vendor-only statuses", () => {
    expect(updateOrderSchema.safeParse({ status: "preparing" }).success).toBe(false);
  });
});