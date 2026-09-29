/**
 * Common, cross-cutting validation schemas.
 *
 * These are the building blocks used by every feature file. Anything
 * that more than one feature depends on lives here. Anything that
 * only one feature depends on belongs in that feature file.
 *
 * Audit H33: file was renamed from `validation/common.ts` to
 * `validation/schemas.ts` (the old name was generic and obscured the
 * distinction between "Zod primitives + cross-cutting schemas" and
 * "feature schemas"). Also folded in the two helpers (`validateBody`,
 * `validationError`) previously in `validation/helpers.ts` so this
 * module is the single entry point for both schemas AND the helpers
 * that operate on them.
 */

import { z } from "zod";
import {
  ALL_PAYMENT_METHODS,
  LEGACY_PAYMENT_METHODS,
} from "@/lib/payments/payment-methods";

/**
 * Saudi phone number validation
 * Accepts formats: 05XXXXXXXX, +9665XXXXXXXX, 5XXXXXXXX
 */
export const phoneSchema = z.string().regex(
  /^(\+966|966|0)?5\d{8}$/,
  "رقم الجوال غير صالح",
);

/**
 * UUID validation for database IDs
 */
export const uuidSchema = z.string().uuid({
  message: "معرّف غير صالح",
});

/**
 * Product ID (accepts UUID format)
 */
export const productIdSchema = z
  .union([uuidSchema, z.string().uuid()])
  .optional();

/**
 * Address ID validation
 */
export const addressIdSchema = z.string().min(1, "عنوان مطلوب");

/**
 * Pagination schema
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const notificationsQuerySchema = z.object({
  unread: z.enum(["0", "1"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Search schema
 */
export const searchSchema = z.object({
  q: z.string().min(1).max(200).optional(),
  category: uuidSchema.optional(),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  sort: z.enum(["price_asc", "price_desc", "newest", "name"]).optional(),
});

/**
 * Coupon code schema — used by both validation/coupon.ts and
 * validation/order.ts so it lives here.
 */
export const couponCodeSchema = z
  .string()
  .min(3, "الكود قصير جدًا")
  .max(50, "الكود طويل جدًا")
  .regex(/^[A-Z0-9]+$/, "الكود يجب أن يكون أحرف إنجليزية وأرقام فقط")
  .toUpperCase();

/**
 * Payment method enum — shared between the legacy catalog checkout
 * and the unified multi-vendor checkout (Slice 3).
 *
 * Derived from the canonical `ALL_PAYMENT_METHODS` tuple in
 * `@/lib/payments/payment-methods` plus the documented legacy superset
 * `LEGACY_PAYMENT_METHODS`. Adding a new method now means one edit
 * (the tuple in `payment-methods.ts`) instead of two (audit S6).
 */
export const paymentMethodSchema = z.enum([
  ...ALL_PAYMENT_METHODS,
  ...LEGACY_PAYMENT_METHODS,
] as unknown as [string, ...string[]]);

/**
 * Helper function to validate request body.
 *
 * Folded from `validation/helpers.ts` (audit H33) so the foundational
 * schema module is the single entry point for both schemas AND the
 * helpers that operate on them.
 */
export function validateBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(body);

  if (!result.success) {
    const firstError = result.error.errors[0];
    return {
      success: false,
      error: firstError?.message || "بيانات غير صالحة",
    };
  }

  return { success: true, data: result.data };
}

/**
 * Helper function to create a validation-error response body.
 *
 * Folded from `validation/helpers.ts` (audit H33). Pair with
 * `validateBody` above for a consistent error envelope.
 */
export function validationError(error: string) {
  return {
    error,
    success: false,
  };
}
