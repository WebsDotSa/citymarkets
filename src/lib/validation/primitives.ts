/**
 * Internal Zod primitives shared across multiple validation files.
 *
 * NOT exported from `@/lib/validation` (the public barrel). These are
 * implementation details used to compose the feature-specific schemas
 * in vendor.ts, admin.ts, etc.
 */

import { z } from "zod";
import { VENDOR_TYPES, HEX_COLOR_RE, isAllowedImageUrl } from "@/lib/catalog";

export const vendorTypeSchema = z.enum(
  VENDOR_TYPES as unknown as [string, ...string[]],
  { errorMap: () => ({ message: "نوع المتجر غير صالح" }) },
);

export const latSchema = z
  .number({ invalid_type_error: "خط العرض يجب أن يكون رقماً" })
  .gte(-90, "خط العرض خارج النطاق")
  .lte(90, "خط العرض خارج النطاق")
  .optional()
  .nullable();

export const lngSchema = z
  .number({ invalid_type_error: "خط الطول يجب أن يكون رقماً" })
  .gte(-180, "خط الطول خارج النطاق")
  .lte(180, "خط الطول خارج النطاق")
  .optional()
  .nullable();

export const colorSchema = z
  .string()
  .regex(HEX_COLOR_RE, "اللون يجب أن يكون بصيغة #RRGGBB")
  .default("#009345");

export const optionalImageUrl = z
  .string()
  .max(500, "الرابط طويل جداً")
  .refine(isAllowedImageUrl, "رابط الصورة غير مسموح")
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

export const optionalEmail = z
  .string()
  .email("البريد الإلكتروني غير صحيح")
  .max(254)
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

export const optionalPhone = z
  .string()
  .regex(/^(\+966|966|0)?5\d{8}$/, "رقم الجوال غير صحيح")
  .max(20)
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

export const optionalWhatsapp = z
  .string()
  .regex(/^(\+966|966|0)?5\d{8}$/, "رقم الواتساب غير صحيح")
  .max(20)
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

export const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 24h");