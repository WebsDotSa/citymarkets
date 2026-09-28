/**
 * Validation schemas for the home layout builder.
 *
 * The contract lives in `@/lib/home-layout-types`. Every section type
 * has its own zod schema; the top-level `homeLayoutInputSchema` uses a
 * discriminated union on `type` so we get the first failure with a
 * localized Arabic message.
 *
 * Kept intentionally pragmatic: optional fields with `.optional().nullable()`
 * everywhere so the admin form can save partial edits without forcing
 * every field to be filled in.
 */
import { z } from "zod";

const idSchema = z.string().min(1).max(100);
const hexColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "يجب أن يكون لون hex صحيح (#RGB أو #RRGGBB)")
  .optional()
  .or(z.literal("").transform(() => undefined));
const urlSchema = z
  .string()
  .max(2000, "الرابط طويل جداً")
  .optional()
  .or(z.literal("").transform(() => undefined));
const htmlSchema = z
  .string()
  .max(20000, "النص طويل جداً (الحد 20,000 حرف)")
  .optional();
const isoDateSchema = z
  .string()
  .refine((s) => !s || !Number.isNaN(Date.parse(s)), "يجب أن يكون تاريخ صحيح")
  .optional();

const inlineBannerSchema = z.object({
  id: z.string().optional(),
  image_url: z.string().min(1, "صورة البانر مطلوبة").max(2000),
  title_ar: z.string().max(200).optional().or(z.literal("").transform(() => undefined)),
  subtitle_ar: z.string().max(300).optional().or(z.literal("").transform(() => undefined)),
  link_type: z.enum(["none", "product", "category", "external", "vendor"], {
    errorMap: () => ({ message: "نوع الرابط غير صالح" }),
  }),
  link_value: z.string().max(500).nullable().optional(),
  ends_at: z.string().nullable().optional(),
  discount_label: z.string().max(50).nullable().optional(),
});

const heroBannerSettingsSchema = z.object({
  title_ar: z.string().max(200).optional().or(z.literal("").transform(() => undefined)),
  subtitle_ar: z.string().max(300).optional().or(z.literal("").transform(() => undefined)),
  image_url: urlSchema,
  show_search: z.boolean().optional(),
  show_location: z.boolean().optional(),
  background_color: hexColorSchema,
});

const bannersSettingsSchema = z.object({
  layout: z.enum(["carousel", "grid_2", "grid_3", "tall", "wide"], {
    errorMap: () => ({ message: "نمط البنرات غير صالح" }),
  }),
  aspect_ratio: z
    .string()
    .regex(/^\d+\/\d+$/, "يجب أن يكون نسبة مثل 16/9")
    .optional(),
  height: z.number().int().min(60).max(2000).optional(),
  auto_play: z.boolean().optional(),
  show_dots: z.boolean().optional(),
  banners: z.array(inlineBannerSchema).max(20, "الحد الأقصى 20 بنر"),
});

const categoriesSettingsSchema = z.object({
  title: z.string().max(200).optional().or(z.literal("").transform(() => undefined)),
  columns: z.number().int().min(3, "الحد الأدنى 3 أعمدة").max(8, "الحد الأقصى 8 أعمدة"),
  root_only: z.boolean().optional(),
  max_items: z.number().int().min(1).max(50).optional(),
  background_color: hexColorSchema,
  show_icons: z.boolean().optional(),
});

const productsSettingsSchema = z.object({
  title: z.string().min(1, "العنوان مطلوب").max(200),
  subtitle: z.string().max(300).optional().or(z.literal("").transform(() => undefined)),
  source: z.enum(["featured", "best_selling", "on_offer", "new", "custom"], {
    errorMap: () => ({ message: "مصدر المنتجات غير صالح" }),
  }),
  product_ids: z.array(z.string()).max(100).optional(),
  category_id: z.string().nullable().optional(),
  limit: z.number().int().min(1, "الحد الأدنى منتج واحد").max(50, "الحد الأقصى 50"),
  display: z.enum(["grid", "carousel"], {
    errorMap: () => ({ message: "نمط العرض غير صالح" }),
  }),
  columns: z.number().int().min(2).max(6).optional(),
  background_color: hexColorSchema,
  header_icon: z.string().max(50).optional(),
  cta_text: z.string().max(80).optional().or(z.literal("").transform(() => undefined)),
  cta_link: urlSchema,
  show_prices: z.boolean().optional(),
});

const offersGridSettingsSchema = productsSettingsSchema.extend({
  source: z.literal("featured_offers"),
  offer_ids: z.array(z.string()).max(50).optional(),
});

const offersStripSettingsSchema = z.object({
  title: z.string().min(1, "العنوان مطلوب").max(200),
  subtitle: z.string().max(300).optional().or(z.literal("").transform(() => undefined)),
  banners: z.array(inlineBannerSchema).max(10, "الحد الأقصى 10 بنرات عروض"),
  background_color: hexColorSchema,
  text_color: hexColorSchema,
  countdown_enabled: z.boolean().optional(),
  auto_play: z.boolean().optional(),
});

const lightningDealsSettingsSchema = z
  .object({
    title: z.string().min(1, "العنوان مطلوب").max(200),
    subtitle: z.string().max(300).optional().or(z.literal("").transform(() => undefined)),
    background_color: hexColorSchema,
    header_color: hexColorSchema,
    border_color: hexColorSchema,
    footer_text: z.string().max(80).optional().or(z.literal("").transform(() => undefined)),
    footer_link: urlSchema,
    ends_at: z.string().min(1, "وقت الانتهاء مطلوب"),
    product_source: z.enum(["on_offer", "custom"], {
      errorMap: () => ({ message: "مصدر المنتجات غير صالح" }),
    }),
    product_ids: z.array(z.string()).max(50).optional(),
    limit: z.number().int().min(1).max(20).optional(),
    show_countdown: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.ends_at && Number.isNaN(Date.parse(val.ends_at))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ends_at"],
        message: "وقت الانتهاء يجب أن يكون تاريخ صحيح",
      });
    }
  });

const categorySectionSettingsSchema = z.object({
  category_id: z.string().min(1, "الفئة مطلوبة"),
  title_override: z.string().max(200).optional().or(z.literal("").transform(() => undefined)),
  subtitle_override: z.string().max(300).optional().or(z.literal("").transform(() => undefined)),
  background_color: hexColorSchema,
  layout: z.enum(["grid", "list"], {
    errorMap: () => ({ message: "نمط العرض غير صالح" }),
  }),
  limit: z.number().int().min(1).max(50).optional(),
  show_prices: z.boolean().optional(),
});

const storesSettingsSchema = z.object({
  title: z.string().min(1, "العنوان مطلوب").max(200),
  subtitle: z.string().max(300).optional().or(z.literal("").transform(() => undefined)),
  limit: z.number().int().min(1).max(50).optional(),
  featured_only: z.boolean().optional(),
  display: z.enum(["carousel", "grid"], {
    errorMap: () => ({ message: "نمط العرض غير صالح" }),
  }),
});

const couponsSettingsSchema = z.object({
  title: z.string().max(200).optional().or(z.literal("").transform(() => undefined)),
  limit: z.number().int().min(1).max(20).optional(),
  display: z.enum(["strip", "grid"], {
    errorMap: () => ({ message: "نمط العرض غير صالح" }),
  }),
});

const htmlBlockSettingsSchema = z.object({
  content_html: z.string().min(1, "المحتوى مطلوب").max(20000),
  background_color: hexColorSchema,
  text_color: hexColorSchema,
});

const ctaSettingsSchema = z.object({
  variant: z.enum(["join", "partner"], {
    errorMap: () => ({ message: "نوع CTA غير صالح" }),
  }),
  title: z.string().max(200).optional().or(z.literal("").transform(() => undefined)),
  subtitle: z.string().max(300).optional().or(z.literal("").transform(() => undefined)),
  cta_text: z.string().max(80).optional().or(z.literal("").transform(() => undefined)),
  cta_href: urlSchema,
  background_color: hexColorSchema,
  text_color: hexColorSchema,
});

const sectionSchema = z.discriminatedUnion("type", [
  z.object({ id: idSchema, type: z.literal("hero_banner"), visible: z.boolean(), settings: heroBannerSettingsSchema }),
  z.object({ id: idSchema, type: z.literal("banners"), visible: z.boolean(), settings: bannersSettingsSchema }),
  z.object({ id: idSchema, type: z.literal("categories"), visible: z.boolean(), settings: categoriesSettingsSchema }),
  z.object({ id: idSchema, type: z.literal("products"), visible: z.boolean(), settings: productsSettingsSchema }),
  z.object({ id: idSchema, type: z.literal("offers_grid"), visible: z.boolean(), settings: offersGridSettingsSchema }),
  z.object({ id: idSchema, type: z.literal("offers_strip"), visible: z.boolean(), settings: offersStripSettingsSchema }),
  z.object({ id: idSchema, type: z.literal("lightning_deals"), visible: z.boolean(), settings: lightningDealsSettingsSchema }),
  z.object({ id: idSchema, type: z.literal("category_section"), visible: z.boolean(), settings: categorySectionSettingsSchema }),
  z.object({ id: idSchema, type: z.literal("stores"), visible: z.boolean(), settings: storesSettingsSchema }),
  z.object({ id: idSchema, type: z.literal("coupons"), visible: z.boolean(), settings: couponsSettingsSchema }),
  z.object({ id: idSchema, type: z.literal("html_block"), visible: z.boolean(), settings: htmlBlockSettingsSchema }),
  z.object({ id: idSchema, type: z.literal("cta"), visible: z.boolean(), settings: ctaSettingsSchema }),
]);

/** Top-level input — what the admin PUT submits. */
export const homeLayoutInputSchema = z.object({
  name: z.string().min(1, "الاسم مطلوب").max(100).optional(),
  is_active: z.boolean().optional(),
  sections: z.array(sectionSchema).max(50, "الحد الأقصى 50 قسم"),
});

/** GET query validation. */
export const homeLayoutQuerySchema = z.object({
  device: z.enum(["mobile", "desktop"]).default("mobile"),
});

export type HomeLayoutInput = z.infer<typeof homeLayoutInputSchema>;