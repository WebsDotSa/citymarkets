/**
 * Common, cross-cutting validation schemas.
 *
 * These are the building blocks used by every feature file. Anything
 * that more than one feature depends on lives here. Anything that
 * only one feature depends on belongs in that feature file.
 */

import { z } from "zod";

/**
 * Saudi phone number validation
 * Accepts formats: 05XXXXXXXX, +9665XXXXXXXX, 5XXXXXXXX
 */
export const phoneSchema = z.string().regex(
  /^(\+966|966|0)?5\d{8}$/,
  "رقم الجوال غير صحيح",
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
 */
export const paymentMethodSchema = z.enum([
  // Legacy/general buckets the analytics layer still groups by.
  "cash",
  "card",
  "wallet",
  "apple_pay",
  "moyasar",
  // Specific gateways the checkout UI surfaces (moyasar-checkout-form +
  // quick-checkout.tsx + checkout-new.tsx all send one of these).
  "mada",
  "visa",
  "mastercard",
  "amex",
  "stc_pay",
  // Tamara — BNPL. Per-order selection, not a global provider.
  "tamara",
  // Bank transfer — surface in checkout-new.tsx (تحويل بنكي) and used by
  // legacy orders. Without this the Zod validation rejects the request
  // with a generic "بيانات غير صالحة" instead of letting the user
  // proceed.
  "bank_transfer",
]);