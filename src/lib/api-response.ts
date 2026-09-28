/**
 * Standardized API response helpers.
 *
 * Every API route should funnel responses through these helpers so the
 * native mobile client (and any future SDK) sees a single, predictable
 * envelope — wire-compatible with what the web app already speaks, but
 * with stable error codes and bilingual messages that localized UIs can
 * rely on.
 *
 * Wire format:
 *   Success: { success: true, data: T, requestId?: string }
 *   Error:   { success: false, error: { code, messageAr, messageEn, details? }, requestId?: string }
 *
 * `requestId` is sourced from the inbound `x-request-id` header (or a
 * generated UUID) so logs, Sentry, and mobile clients can correlate.
 *
 * ────────────────────────────────────────────────────────────────────
 * Migration guidance (2026-09-23)
 * ────────────────────────────────────────────────────────────────────
 * Not every route should adopt these helpers wholesale — the iOS
 * contract enforced by `scripts/ios-contract-smoke.mjs` pins the
 * existing `{ success, data }` envelope and the legacy
 * `{ success: false, error: <arabic string> }` error shape. Two
 * concrete buckets:
 *
 *   1. ADOPT (admin / new routes):
 *      - /api/admin/**           — no iOS consumer
 *      - /api/v1/manifest        — admin-style
 *      - /api/v1/public/**       — public, no iOS state contract
 *      - any new route created from this point on
 *
 *   2. KEEP AS-IS (iOS-affecting v1 routes):
 *      - /api/v1/addresses, /api/v1/delivery-addresses
 *      - /api/v1/cart, /api/v1/checkout
 *      - /api/v1/orders/**, /api/v1/payments/**
 *      - /api/v1/auth/**, /api/v1/profile/**
 *      - any route that the iOS APIClient.swift actively reads.
 *      Their snake_case + `{ success, data }` + `error: string` shape
 *      is contractual; changing it requires bumping the iOS build in
 *      lockstep.
 *
 * For these routes the path forward is:
 *   - Add `requestId` only (additive, backwards-compatible).
 *   - Leave the `error: <string>` shape alone for now.
 *   - When the iOS client is updated to consume the new error envelope,
 *     flip each route to `fail(ErrorCodes.X, status, ...)`.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

// Stable error codes — add a new branch rather than renaming an existing
// one. Mobile clients pin to these strings.
export const ErrorCodes = {
  // 4xx — client errors
  BAD_REQUEST: "BAD_REQUEST",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  GONE: "GONE",
  UNPROCESSABLE: "UNPROCESSABLE",
  RATE_LIMITED: "RATE_LIMITED",
  CSRF_ERROR: "CSRF_ERROR",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  // 5xx — server errors
  INTERNAL: "INTERNAL",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  // Business-logic errors
  OUT_OF_STOCK: "OUT_OF_STOCK",
  CART_EMPTY: "CART_EMPTY",
  INVALID_OTP: "INVALID_OTP",
  OTP_EXPIRED: "OTP_EXPIRED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  COUPON_INVALID: "COUPON_INVALID",
  ADDRESS_REQUIRED: "ADDRESS_REQUIRED",
  VENDOR_REJECTED: "VENDOR_REJECTED",
  AUTH_PROVIDER_DOWN: "AUTH_PROVIDER_DOWN",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ApiError {
  code: ErrorCode;
  messageAr: string;
  messageEn: string;
  details?: Record<string, unknown>;
  /** HTTP status — for internal use only; not serialized. */
  status?: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  requestId: string;
  /** Optional pagination metadata for list endpoints. */
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    nextCursor?: string | null;
  };
}

export interface ApiErrorEnvelope {
  success: false;
  error: ApiError;
  requestId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorEnvelope;

// Internal error messages table — Arabic + English so the client can
// pick the right one without an extra round-trip.
const ErrorMessages: Record<ErrorCode, { ar: string; en: string }> = {
  BAD_REQUEST: {
    ar: "طلب غير صالح",
    en: "Bad request",
  },
  VALIDATION_FAILED: {
    ar: "البيانات المُرسَلة غير صالحة",
    en: "Validation failed",
  },
  UNAUTHORIZED: {
    ar: "يلزم تسجيل الدخول",
    en: "Authentication required",
  },
  FORBIDDEN: {
    ar: "غير مصرح بالوصول",
    en: "Forbidden",
  },
  NOT_FOUND: {
    ar: "العنصر غير موجود",
    en: "Not found",
  },
  CONFLICT: {
    ar: "تعارض في البيانات",
    en: "Conflict",
  },
  GONE: {
    ar: "العنصر غير متاح",
    en: "Gone",
  },
  UNPROCESSABLE: {
    ar: "لا يمكن تنفيذ الطلب",
    en: "Unprocessable entity",
  },
  RATE_LIMITED: {
    ar: "تجاوزت الحد المسموح من المحاولات",
    en: "Too many requests",
  },
  CSRF_ERROR: {
    ar: "انتهاك أمان - رمز التحقق غير صالح",
    en: "Invalid CSRF token",
  },
  IDEMPOTENCY_CONFLICT: {
    ar: "تم تنفيذ هذه العملية سابقاً",
    en: "Duplicate request",
  },
  INTERNAL: {
    ar: "حدث خطأ غير متوقع",
    en: "Internal server error",
  },
  UPSTREAM_ERROR: {
    ar: "خطأ في الخدمة الخارجية",
    en: "Upstream service error",
  },
  SERVICE_UNAVAILABLE: {
    ar: "الخدمة غير متاحة مؤقتاً",
    en: "Service unavailable",
  },
  OUT_OF_STOCK: {
    ar: "المنتج غير متوفر في المخزون",
    en: "Product is out of stock",
  },
  CART_EMPTY: {
    ar: "السلة فارغة",
    en: "Cart is empty",
  },
  INVALID_OTP: {
    ar: "رمز التحقق غير صحيح",
    en: "Invalid OTP code",
  },
  OTP_EXPIRED: {
    ar: "انتهت صلاحية رمز التحقق",
    en: "OTP expired",
  },
  PAYMENT_FAILED: {
    ar: "فشلت عملية الدفع",
    en: "Payment failed",
  },
  COUPON_INVALID: {
    ar: "كود الخصم غير صالح",
    en: "Invalid coupon code",
  },
  ADDRESS_REQUIRED: {
    ar: "يلزم تحديد عنوان التوصيل",
    en: "Delivery address required",
  },
  VENDOR_REJECTED: {
    ar: "تم رفض الطلب من المتجر",
    en: "Vendor rejected the order",
  },
  AUTH_PROVIDER_DOWN: {
    ar: "خدمة المصادقة غير متاحة",
    en: "Authentication provider is unavailable",
  },
};

function getRequestId(request: Request): string {
  return (
    request.headers.get("x-request-id") ||
    request.headers.get("x-correlation-id") ||
    randomUUID()
  );
}

/**
 * 2xx success envelope. `data` MUST be JSON-serializable. List endpoints
 * may pass `pagination` for cursor/offset pagination.
 */
export function ok<T>(
  data: T,
  init?: ResponseInit & { pagination?: ApiSuccess<T>["pagination"] }
): NextResponse {
  const { pagination, headers, ...rest } = init ?? {};
  const body: ApiSuccess<T> = {
    success: true,
    data,
    requestId: randomUUID(),
    ...(pagination ? { pagination } : {}),
  };
  return NextResponse.json(body, {
    ...rest,
    headers: {
      "Cache-Control": "no-store",
      ...(headers ?? {}),
    },
  });
}

/**
 * 4xx/5xx error envelope. `code` is the stable machine-readable key;
 * `messageAr` / `messageEn` are the user-facing strings (either can be
 * overridden per call site — e.g. for vendor-specific errors).
 */
export function fail(
  code: ErrorCode,
  status: number,
  overrides?: {
    messageAr?: string;
    messageEn?: string;
    details?: Record<string, unknown>;
    headers?: HeadersInit;
  }
): NextResponse {
  const defaults = ErrorMessages[code] || ErrorMessages[ErrorCodes.INTERNAL];
  const body: ApiErrorEnvelope = {
    success: false,
    error: {
      code,
      messageAr: overrides?.messageAr ?? defaults.ar,
      messageEn: overrides?.messageEn ?? defaults.en,
      ...(overrides?.details ? { details: overrides.details } : {}),
    },
    requestId: randomUUID(),
  };
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(overrides?.headers ?? {}),
    },
  });
}

/**
 * Convenience helpers — keep call sites short and the wire contract
 * consistent.
 */
export const badRequest = (msg?: { ar?: string; en?: string; details?: Record<string, unknown> }) =>
  fail(ErrorCodes.BAD_REQUEST, 400, msg ? { messageAr: msg.ar, messageEn: msg.en, details: msg.details } : undefined);

export const validationError = (details?: Record<string, unknown>) =>
  fail(ErrorCodes.VALIDATION_FAILED, 422, { ...(details ? { details } : {}) });

export const unauthorized = (msg?: { ar?: string; en?: string }) =>
  fail(ErrorCodes.UNAUTHORIZED, 401, msg ? { messageAr: msg.ar, messageEn: msg.en } : undefined);

export const forbidden = (msg?: { ar?: string; en?: string }) =>
  fail(ErrorCodes.FORBIDDEN, 403, msg ? { messageAr: msg.ar, messageEn: msg.en } : undefined);

export const notFound = (msg?: { ar?: string; en?: string }) =>
  fail(ErrorCodes.NOT_FOUND, 404, msg ? { messageAr: msg.ar, messageEn: msg.en } : undefined);

export const conflict = (msg?: { ar?: string; en?: string; details?: Record<string, unknown> }) =>
  fail(ErrorCodes.CONFLICT, 409, msg ? { messageAr: msg.ar, messageEn: msg.en, details: msg.details } : undefined);

export const gone = (msg?: { ar?: string; en?: string }) =>
  fail(ErrorCodes.GONE, 410, msg ? { messageAr: msg.ar, messageEn: msg.en } : undefined);

export const tooManyRequests = (
  retryAfter: number,
  details?: Record<string, unknown>
) =>
  fail(ErrorCodes.RATE_LIMITED, 429, {
    details: { ...(details ?? {}), retryAfter },
    headers: { "Retry-After": String(retryAfter) },
  });

export const csrfError = () =>
  fail(ErrorCodes.CSRF_ERROR, 403, {
    headers: { "X-CSRF-Error": "true" },
  });

export const internalError = (details?: Record<string, unknown>) =>
  fail(ErrorCodes.INTERNAL, 500, details ? { details } : undefined);

export const upstreamError = (msg?: { ar?: string; en?: string }) =>
  fail(ErrorCodes.UPSTREAM_ERROR, 502, msg ? { messageAr: msg.ar, messageEn: msg.en } : undefined);

export const serviceUnavailable = (retryAfter = 30) =>
  fail(ErrorCodes.SERVICE_UNAVAILABLE, 503, {
    headers: { "Retry-After": String(retryAfter) },
  });

// Business-logic helpers (preserve the Arabic phrasing in `messageAr`
// when callers want to override in domain-specific ways).
export const outOfStock = (productId?: string) =>
  fail(ErrorCodes.OUT_OF_STOCK, 409, {
    headers: { "X-Out-Of-Stock": "true" },
    ...(productId ? { details: { productId } } : {}),
  });

export const cartEmpty = () => fail(ErrorCodes.CART_EMPTY, 400);

export const invalidOtp = (details?: Record<string, unknown>) =>
  fail(ErrorCodes.INVALID_OTP, 401, details ? { details } : undefined);

export const otpExpired = () => fail(ErrorCodes.OTP_EXPIRED, 401);

export const paymentFailed = (details?: Record<string, unknown>) =>
  fail(ErrorCodes.PAYMENT_FAILED, 402, details ? { details } : undefined);

export const couponInvalid = (code: string) =>
  fail(ErrorCodes.COUPON_INVALID, 422, {
    details: { couponCode: code },
  });

export const addressRequired = () => fail(ErrorCodes.ADDRESS_REQUIRED, 400);

/**
 * Build a function-bound `requestId` so handlers can echo it for log
 * correlation. Use `getRequestId(request)` only when you need it before
 * any response is built.
 */
export { getRequestId };

/** Type guard — narrows a value to a successful API response. */
export function isOk<T>(value: { success: boolean }): value is { success: true; data: T } {
  return value.success === true;
}

/** Type guard — narrows a value to an error envelope. */
export function isErr(value: { success: boolean }): value is { success: false; error: ApiError } {
  return value.success === false;
}
