/**
 * Vendor CRUD validation — used by /api/admin/vendors POST/PUT/PATCH.
 *
 * Every field is checked so the admin UI can never write garbage
 * (e.g. lat=9999, "javascript:..." URLs, malformed emails).
 */

import { z } from "zod";
import {
  colorSchema,
  latSchema,
  lngSchema,
  optionalEmail,
  optionalImageUrl,
  optionalPhone,
  optionalWhatsapp,
  vendorTypeSchema,
} from "./primitives";

export const vendorCreateSchema = z.object({
  name_ar: z.string().min(1, "اسم المتجر بالعربية مطلوب").max(120),
  name_en: z.string().max(120).optional().nullable(),
  slug: z
    .string()
    .max(80)
    .regex(
      /^[a-z0-9-]+$/,
      "الـ slug يجب أن يحتوي على حروف لاتينية صغيرة وأرقام وشرطات فقط",
    )
    .optional()
    .nullable(),
  description_ar: z.string().max(2000).optional().nullable(),
  description_en: z.string().max(2000).optional().nullable(),
  logo_url: optionalImageUrl,
  banner_url: optionalImageUrl,
  vendor_type: vendorTypeSchema,
  category_slug: z.string().max(80).optional().nullable(),
  primary_color: colorSchema,
  contact_phone: optionalPhone,
  contact_email: optionalEmail,
  contact_whatsapp: optionalWhatsapp,
  address_ar: z.string().max(300).optional().nullable(),
  pickup_lat: latSchema,
  pickup_lng: lngSchema,
  is_active: z.boolean().optional().default(true),
  is_featured: z.boolean().optional().default(false),
  sort_order: z.number().int().min(0).max(100000).optional().default(0),
});

export const vendorUpdateSchema = vendorCreateSchema.partial();

export const vendorPatchSchema = z
  .object({
    is_active: z.boolean().optional(),
    is_featured: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(100000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "لا يوجد حقول لتحديثها",
  });