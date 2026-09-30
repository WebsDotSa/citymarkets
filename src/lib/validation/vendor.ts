/**
 * Vendor CRUD validation — used by /api/admin/vendors POST/PUT/PATCH.
 *
 * Every field is checked so the admin UI can never write garbage
 * (e.g. lat=9999, "javascript:..." URLs, malformed emails).
 *
 * Slug charset is Unicode-aware (`/^[\p{L}\p{N}-]+$/u`) so Arabic
 * store names round-trip cleanly through PUT. The server's
 * auto-slugifier (`generateSlug` from `@/lib/slug`) transliterates
 * Arabic to Latin for the *new* vendor auto-fill case, but admins can
 * still type an Arabic slug explicitly on edit — the historical rows
 * with Arabic slugs also round-trip unchanged.
 *
 * Owner credentials (login_phone / login_email / password) live
 * OUTSIDE this schema on purpose. They are read from the raw request
 * body by the route so an explicit empty-string `login_email` keeps
 * its "clear the stored email" meaning (Zod's `optionalEmail` would
 * otherwise normalize `""` to `null`). The route still validates
 * format with the same `optionalPhone` / `optionalEmail` primitives
 * inside `upsertVendorOwner`.
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
  slugSchema,
  vendorTypeSchema,
} from "./primitives";

export const vendorCreateSchema = z.object({
  name_ar: z.string().trim().min(1, "اسم المتجر بالعربية مطلوب").max(120),
  name_en: z.string().trim().max(120).optional().nullable(),
  slug: slugSchema.optional().nullable(),
  description_ar: z.string().max(2000).optional().nullable(),
  description_en: z.string().max(2000).optional().nullable(),
  logo_url: optionalImageUrl,
  banner_url: optionalImageUrl,
  vendor_type: vendorTypeSchema,
  // Same shape as `slug` — keeping both slug-shaped fields on one
  // schema avoids drift if Arabic / accented category slugs appear.
  category_slug: slugSchema.optional().nullable(),
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