/**
 * Product, category, and banner validation schemas.
 *
 * These are owned by /api/admin/products, /api/admin/categories, and
 * /api/admin/banners respectively.
 */

import { z } from "zod";

/**
 * Admin product create/update schema
 */
export const productInputSchema = z.object({
  name_ar: z.string().min(1, "اسم المنتج بالعربية مطلوب").max(200),
  name_en: z.string().max(200).optional().nullable(),
  barcode: z.string().max(50).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  category_id: z
    // BUGFIX (audit 2026-09-29): DB column is uuid. Numbers used to slip
    // through (some clients send JSON numbers for UUID-shaped IDs) and
    // crashed Postgres with `invalid input syntax for type uuid` → 500.
    // Coerce to string and require a UUID shape up-front so the failure
    // is a clean 400 with an Arabic message instead.
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? String(v) : v))
    .pipe(
      z
        .string()
        .min(1, "الفئة مطلوبة")
        .regex(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          "الفئة غير صالحة",
        ),
    ),
  price: z.number().positive("السعر يجب أن يكون موجبًا"),
  discount_price: z.number().positive().nullable().optional(),
  stock_qty: z.number().int().min(0).optional(),
  unit: z.string().max(20).optional(),
  image_url: z
    .string()
    .url()
    .max(500)
    .optional()
    .nullable()
    .or(z.literal("")),
  images: z.array(z.string().url()).max(8).optional(),
  is_featured: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

/**
 * Admin banner create/update schema
 */
export const bannerInputSchema = z.object({
  image_url: z.string().min(1, "رابط الصورة مطلوب").max(500),
  link_type: z.enum(["none", "category", "product", "external"]).optional(),
  link_value: z.string().max(500).optional().nullable(),
  active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});

/**
 * Admin category create/update schema
 */
export const categoryInputSchema = z.object({
  name_ar: z.string().min(1, "اسم الفئة بالعربية مطلوب").max(100),
  name_en: z.string().max(100).optional().nullable(),
  slug: z.string().max(100).optional().nullable(),
  icon_url: z
    .string()
    .url()
    .max(500)
    .optional()
    .nullable()
    .or(z.literal("")),
  sort_order: z.number().int().min(0).optional(),
  parent_id: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  description_ar: z.string().max(500).optional().nullable(),
  description_en: z.string().max(500).optional().nullable(),
});