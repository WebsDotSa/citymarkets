/**
 * Tests for src/lib/api-response.ts — the standardized envelope that
 * the mobile client pins to.
 */
import { describe, expect, it } from "vitest";
import {
  ok,
  badRequest,
  validationError,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooManyRequests,
  csrfError,
  internalError,
  outOfStock,
  cartEmpty,
  invalidOtp,
  otpExpired,
  paymentFailed,
  couponInvalid,
  addressRequired,
  ErrorCodes,
  isOk,
  isErr,
} from "@/lib/api-response";

async function readBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("api-response — success envelope", () => {
  it("ok() returns a 200 envelope with success:true and data", async () => {
    const res = ok({ hello: "world" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await readBody<{ success: boolean; data: { hello: string } }>(res);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ hello: "world" });
    expect(typeof (body as Record<string, unknown>).requestId).toBe("string");
  });

  it("ok() exposes pagination when provided", async () => {
    const res = ok([{ id: 1 }, { id: 2 }], {
      pagination: { page: 1, limit: 20, total: 100, totalPages: 5 },
    });
    const body = (await res.json()) as {
      success: boolean;
      pagination: { page: number; total: number };
    };
    expect(body.success).toBe(true);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.total).toBe(100);
  });
});

describe("api-response — error envelope", () => {
  const codes = [
    { name: "badRequest",       fn: badRequest,                       status: 400, code: ErrorCodes.BAD_REQUEST },
    { name: "validationError",  fn: validationError,                  status: 422, code: ErrorCodes.VALIDATION_FAILED },
    { name: "unauthorized",     fn: unauthorized,                     status: 401, code: ErrorCodes.UNAUTHORIZED },
    { name: "forbidden",        fn: forbidden,                        status: 403, code: ErrorCodes.FORBIDDEN },
    { name: "notFound",         fn: notFound,                         status: 404, code: ErrorCodes.NOT_FOUND },
    { name: "conflict",         fn: conflict,                         status: 409, code: ErrorCodes.CONFLICT },
    { name: "tooManyRequests",  fn: () => tooManyRequests(60),        status: 429, code: ErrorCodes.RATE_LIMITED },
    { name: "csrfError",        fn: csrfError,                        status: 403, code: ErrorCodes.CSRF_ERROR },
    { name: "internalError",    fn: internalError,                    status: 500, code: ErrorCodes.INTERNAL },
    { name: "outOfStock",       fn: outOfStock,                       status: 409, code: ErrorCodes.OUT_OF_STOCK },
    { name: "cartEmpty",        fn: cartEmpty,                        status: 400, code: ErrorCodes.CART_EMPTY },
    { name: "invalidOtp",       fn: invalidOtp,                       status: 401, code: ErrorCodes.INVALID_OTP },
    { name: "otpExpired",       fn: otpExpired,                       status: 401, code: ErrorCodes.OTP_EXPIRED },
    { name: "paymentFailed",    fn: paymentFailed,                    status: 402, code: ErrorCodes.PAYMENT_FAILED },
    { name: "couponInvalid",    fn: () => couponInvalid("XYZ"),       status: 422, code: ErrorCodes.COUPON_INVALID },
    { name: "addressRequired",  fn: addressRequired,                  status: 400, code: ErrorCodes.ADDRESS_REQUIRED },
  ];

  for (const { name, fn, status, code } of codes) {
    it(`${name} returns an error envelope with the right HTTP status and stable code`, async () => {
      const res = fn();
      expect(res.status).toBe(status);
      const body = (await res.json()) as {
        success: false;
        error: { code: string; messageAr: string; messageEn: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(code);
      expect(body.error.messageAr.length).toBeGreaterThan(0);
      expect(body.error.messageEn.length).toBeGreaterThan(0);
      expect(isErr(body as unknown as { success: false })).toBe(true);
    });
  }

  it("tooManyRequests sets Retry-After header", async () => {
    const res = tooManyRequests(120);
    expect(res.headers.get("Retry-After")).toBe("120");
  });

  it("csrfError sets X-CSRF-Error header", async () => {
    const res = csrfError();
    expect(res.headers.get("X-CSRF-Error")).toBe("true");
  });

  it("outOfStock surfaces productId in details", async () => {
    const res = outOfStock("prod-123");
    const body = (await res.json()) as {
      error: { details: { productId: string } | undefined };
    };
    expect(body.error.details?.productId).toBe("prod-123");
  });

  it("couponInvalid echoes the coupon code in details", async () => {
    const res = couponInvalid("SAVE20");
    const body = (await res.json()) as {
      error: { details: { couponCode: string } | undefined };
    };
    expect(body.error.details?.couponCode).toBe("SAVE20");
  });

  it("messageAr and messageEn can be overridden per call site", async () => {
    const res = badRequest({
      ar: "رقم الطلب غير صالح",
      en: "Invalid order number",
      details: { orderId: "abc" },
    });
    const body = (await res.json()) as {
      error: { messageAr: string; messageEn: string; details: { orderId: string } };
    };
    expect(body.error.messageAr).toBe("رقم الطلب غير صالح");
    expect(body.error.messageEn).toBe("Invalid order number");
    expect(body.error.details.orderId).toBe("abc");
  });
});

describe("api-response — type guards", () => {
  it("isOk narrows success envelopes", async () => {
    const a = ok({ x: 1 });
    const body = await readBody<{ success: true; data: { x: number } }>(a);
    type SuccessBody = { success: true; data: { x: number } };
    if (isOk(body as unknown as { success: true; data: { x: number } })) {
      expect((body as SuccessBody).success).toBe(true);
      expect((body as SuccessBody).data.x).toBe(1);
    } else {
      throw new Error("expected success envelope");
    }
  });

  it("isErr narrows error envelopes", async () => {
    const a = notFound();
    const body = await readBody<{ success: false }>(a);
    expect(isErr(body as unknown as { success: false })).toBe(true);
  });
});
