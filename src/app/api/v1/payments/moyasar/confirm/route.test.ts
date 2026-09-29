/**
 * HTTP route tests for POST /api/v1/payments/moyasar/confirm.
 *
 * The service layer (`confirmMoyasarPaymentForOrder`) is unit-tested
 * separately at `src/lib/payments/moyasar-confirm.test.ts`. This file
 * focuses on the route's:
 *   - 503 when inline is not configured
 *   - 400 when order_id or payment_id is missing
 *   - 200 success shape: {success, order_id, payment_status, order_status}
 *   - 403 mapping when the service returns "غير مصرح" (unauthorized)
 *   - 400 mapping for any other service error
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(async () => ({ rows: [] })),
  },
}));
vi.mock("@/lib/identity", () => ({
  resolveCustomerUserIdFromRequest: vi.fn(async () => "user-1"),
}));
vi.mock("@/lib/payments/moyasar", () => ({
  fetchPayment: vi.fn(),
  isMoyasarConfigured: vi.fn(() => true),
  isMoyasarInlineConfigured: vi.fn(() => true),
  toHalalas: vi.fn((n: number) => Math.round(n * 100)),
}));
vi.mock("@/lib/payments/moyasar-confirm", () => ({
  confirmMoyasarPaymentForOrder: vi.fn(),
}));
vi.mock("@/lib/payments/event-ledger", () => ({
  recordPaymentEvent: vi.fn(async () => "inserted"),
  finalizePaymentEvent: vi.fn(),
}));
vi.mock("@/lib/orders/loyalty", () => ({
  awardPointsForOrder: vi.fn(),
  getLoyaltySettings: vi.fn(),
  resolveRedeemForOrder: vi.fn(),
}));
vi.mock("@/lib/orders/abandoned-carts", () => ({
  markAbandonedCartRecovered: vi.fn(async () => ({ recovered_count: 0 })),
}));
vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { isMoyasarInlineConfigured } from "@/lib/payments/moyasar";
import { confirmMoyasarPaymentForOrder } from "@/lib/payments/moyasar-confirm";
import { POST } from "./route";

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/v1/payments/moyasar/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/payments/moyasar/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 503 when inline is not configured", async () => {
    vi.mocked(isMoyasarInlineConfigured).mockReturnValueOnce(false);
    const res = await POST(postJson({ order_id: "o", payment_id: "p" }) as never);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json).toMatchObject({ success: false });
  });

  it("returns 400 when order_id is missing", async () => {
    const res = await POST(postJson({ payment_id: "p" }) as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ success: false });
  });

  it("returns 400 when payment_id is missing", async () => {
    const res = await POST(postJson({ order_id: "o" }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 200 success with order_id, payment_status, order_status", async () => {
    vi.mocked(confirmMoyasarPaymentForOrder).mockResolvedValueOnce({
      success: true,
      payment_status: "paid",
      order_status: "confirmed",
    });
    const res = await POST(
      postJson({ order_id: "o-1", payment_id: "p-1" }) as never,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      order_id: "o-1",
      payment_status: "paid",
      order_status: "confirmed",
    });
  });

  it("returns 403 when service returns 'غير مصرح'", async () => {
    vi.mocked(confirmMoyasarPaymentForOrder).mockResolvedValueOnce({
      success: false,
      error: "غير مصرح",
    });
    const res = await POST(
      postJson({ order_id: "o-1", payment_id: "p-1" }) as never,
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for any other service error", async () => {
    vi.mocked(confirmMoyasarPaymentForOrder).mockResolvedValueOnce({
      success: false,
      error: "مبلغ الدفع لا يطابق الطلب",
    });
    const res = await POST(
      postJson({ order_id: "o-1", payment_id: "p-1" }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("forwards orderId, paymentId, userId to the service", async () => {
    vi.mocked(confirmMoyasarPaymentForOrder).mockResolvedValueOnce({
      success: true,
      payment_status: "paid",
      order_status: "confirmed",
    });
    await POST(postJson({ order_id: "o-2", payment_id: "p-2" }) as never);
    expect(vi.mocked(confirmMoyasarPaymentForOrder)).toHaveBeenCalledWith({
      orderId: "o-2",
      paymentId: "p-2",
      userId: "user-1",
    });
  });

  it("accepts camelCase orderId / paymentId as well", async () => {
    vi.mocked(confirmMoyasarPaymentForOrder).mockResolvedValueOnce({
      success: true,
      payment_status: "paid",
      order_status: "confirmed",
    });
    await POST(postJson({ orderId: "o-3", paymentId: "p-3" }) as never);
    expect(vi.mocked(confirmMoyasarPaymentForOrder)).toHaveBeenCalledWith({
      orderId: "o-3",
      paymentId: "p-3",
      userId: "user-1",
    });
  });
});