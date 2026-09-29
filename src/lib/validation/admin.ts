/**
 * Admin-only validation schemas: user management, inventory,
 * notifications, store-status, delivery settings, coupons, offers.
 *
 * Anything that's edited from /admin/* dashboard but never touched
 * from a customer endpoint lives here.
 */

import { z } from "zod";
import { couponCodeSchema } from "./common";
import { hhmm } from "./primitives";

// ──────────────────────────────────────────────────────────────────────
// Saudi-style mobile number (used for admin & owner staff phone fields).
// Accepts: 5XXXXXXXX / 05XXXXXXXX / 9665XXXXXXXX / +9665XXXXXXXX.
// ──────────────────────────────────────────────────────────────────────
export const saudiPhoneSchema = z
  .string()
  .trim()
  .regex(
    /^(\+?966|0)?5\d{8}$/,
    "رقم الجوال غير صالح — مثال: 5XXXXXXXX",
  )
  .transform((v) => v.replace(/\s|-/g, ""));

// ──────────────────────────────────────────────────────────────────────
// Admin user-management (manual create / edit / loyalty overrides)
// ──────────────────────────────────────────────────────────────────────

export const loyaltyTierSchema = z.enum(
  ["bronze", "silver", "gold", "platinum"],
  { errorMap: () => ({ message: "مستوى الولاء غير صالح" }) },
);

/**
 * Schema for creating a staff member under `admin_users` from
 * `/admin/(dashboard)/settings/admins` (the "الموظفين" page).
 *
 * Phone is now REQUIRED (login-by-phone-OTP is one of two surfaces),
 * email is OPTIONAL. Existing client code that keeps the old
 * `email required, phone optional` semantics will fail validation if
 * it doesn't include a phone — that's deliberate, surface the new
 * requirement to the admin dashboard instead of silently dropping it.
 *
 * NOTE on role: the DB enum (`admin_role_enum` in migration
 * `003_admin_banners_fix.sql`) is `super_admin | admin | manager |
 * support` but the dashboard's dropdown has historically also sent
 * `editor / viewer / delivery_driver` (TS-side union). We accept any
 * non-empty string here and let the DB reject with 23522 — switching
 * to a strict union would break the existing UI in one go.
 */
export const adminStaffCreateSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب").max(120),
  phone: saudiPhoneSchema,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("بريد إلكتروني غير صالح")
    .max(254)
    .optional()
    .or(z.literal("")),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").max(128),
  // BUGFIX (audit 2026-09-29): tighten role to the closed enum used by
  // src/lib/admin-types.ts. The DB enum (admin_role_enum) is a subset
  // (`super_admin | admin | manager | support` per migration 003) but
  // the dashboard also emits `editor`, `viewer`, `delivery_driver`.
  // Whitelisting the union here gives a clean Arabic 400 instead of
  // letting Postgres raise 23522 → 500.
  role: z
    .enum(["super_admin", "admin", "manager", "support", "editor", "viewer", "delivery_driver"], {
      errorMap: () => ({ message: "الدور غير صالح" }),
    })
    .optional(),
  is_active: z.boolean().optional(),
});

/**
 * Edit schema. Phone stays required (so the auth surface cannot be
 * downgraded to email-only by accident), email can be cleared (the
 * operator may intentionally drop it), and password is optional
 * (empty means "keep current").
 */
export const adminStaffUpdateSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب").max(120),
  phone: saudiPhoneSchema,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("بريد إلكتروني غير صالح")
    .max(254)
    .optional()
    .or(z.literal("")),
  // BUGFIX (audit 2026-09-29): same closed-enum tightening as the create
  // schema above. See comment on `adminStaffCreateSchema.role`.
  role: z
    .enum(["super_admin", "admin", "manager", "support", "editor", "viewer", "delivery_driver"], {
      errorMap: () => ({ message: "الدور غير صالح" }),
    })
    .optional(),
  is_active: z.boolean().optional(),
  password: z
    .string()
    .min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل")
    .max(128)
    .optional()
    .or(z.literal("")),
});

// Legacy alias kept for backwards compatibility with /api/admin/users
// (used for customer table — phone required there since the dawn of
//  the customer-OTP flow).
export const adminUserInputSchema = z.object({
  phone: z.string().min(9, "رقم الجوال مطلوب").max(20),
  name: z.string().max(100).optional().nullable(),
  email: z
    .string()
    .email("بريد إلكتروني غير صالح")
    .optional()
    .nullable()
    .or(z.literal("")),
  loyalty_points: z.number().int().min(0).max(1_000_000).optional(),
  loyalty_tier: loyaltyTierSchema.optional(),
});

// ──────────────────────────────────────────────────────────────────────
// Admin login — supports two surfaces: email+password OR phone+OTP.
// ──────────────────────────────────────────────────────────────────────

/**
 * Admin login schema (discriminated by `mode`).
 *
 *   { mode: "password", email|username, password }
 *   { mode: "otp", phone, code }
 *
 * Server side: `mode` is inferred from which fields are present and
 * routed to the right handler. Both payload shapes go through this
 * single schema so the API surface stays tight.
 */
export const adminLoginInputSchema = z
  .object({
    mode: z.enum(["password", "otp"]).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("")),
    username: z.string().trim().min(1).max(50).optional().or(z.literal("")),
    password: z.string().min(1).max(200).optional().or(z.literal("")),
    phone: saudiPhoneSchema.optional(),
    code: z.string().trim().regex(/^\d{4,6}$/).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    const hasPassword = !!data.password;
    // Phone alone is enough to enter the OTP branch — the code is only
    // required once the client decides to verify. This lets the "send
    // OTP" request (`{ mode:"otp", phone }`) reach the handler.
    const hasOtp = !!data.phone;
    if (!hasPassword && !hasOtp) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "أدخل البريد وكلمة المرور أو رقم الجوال ورمز التحقق",
        path: ["password"],
      });
    }
    if (hasOtp && data.code && !/^\d{4,6}$/.test(data.code)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "رمز التحقق يجب أن يكون 4 إلى 6 أرقام",
        path: ["code"],
      });
    }
    if (hasPassword && !data.email && !data.username) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "البريد الإلكتروني مطلوب مع كلمة المرور",
        path: ["email"],
      });
    }
  });

// ──────────────────────────────────────────────────────────────────────
// Admin: vendor owner login (vendors create / edit).
// Phone is REQUIRED for owner login, email is OPTIONAL.
// ──────────────────────────────────────────────────────────────────────

export const vendorOwnerLoginSchema = z
  .object({
    phone: saudiPhoneSchema,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("بريد إلكتروني غير صالح")
      .max(254)
      .optional()
      .or(z.literal("")),
    password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").max(128),
  })
  .strict();

export const vendorOwnerLoginUpdateSchema = z
  .object({
    phone: saudiPhoneSchema.optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("بريد إلكتروني غير صالح")
      .max(254)
      .optional()
      .or(z.literal(""))
      .or(z.null()),
    password: z.string().min(8).max(128).optional().or(z.literal("")).or(z.null()),
  })
  .strict()
  .refine(
    (v) =>
      v.phone !== undefined || v.email !== undefined || v.password !== undefined,
    { message: "لا يوجد حقول لتحديثها" },
  );

// ──────────────────────────────────────────────────────────────────────
// Vendor login (in /vendor/[slug]/admin) — accepts phone OR email.
// ──────────────────────────────────────────────────────────────────────

/**
 * Vendor staff login schema. The store slug is still required (each
 * vendor runs its own isolated auth realm), but the identifier may
 * be either a phone number or an email address.
 */
export const vendorStaffLoginSchema = z
  .object({
    vendorSlug: z.string().trim().min(1),
    identifier: z.string().trim().min(3).max(254),
    password: z.string().min(1).max(200),
  })
  .superRefine((data, ctx) => {
    const id = data.identifier;
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id);
    const isPhone = /^(\+?966|0)?5\d{8}$/.test(id.replace(/[\s-]/g, ""));
    if (!isEmail && !isPhone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "أدخل بريد إلكتروني أو رقم جوال سعودي صالح",
        path: ["identifier"],
      });
    }
  });

// ──────────────────────────────────────────────────────────────────────
// Delivery settings (pricing / slots / hours)
// ──────────────────────────────────────────────────────────────────────

/**
 * Delivery pricing schema (migration 060 — zones are gone).
 *
 * All knobs are admin-tunable from `/admin/delivery-settings` and
 * persisted under `delivery_settings.pricing` in the DB:
 *
 *   - `baseSar`            — flat fee for the first `includedKm` km
 *   - `includedKm`         — distance covered by the flat fee
 *   - `perExtraKmSar`      — additional fee per km beyond `includedKm`
 *   - `serviceFee*`        — optional service-charge line
 *   - `taxPercent`         — optional VAT line
 *
 * `computeDistanceFee(distanceKm, settings)` from
 * `@/lib/delivery-distance-fee` is the single source of truth at
 * checkout. The main store's lat/lng (set via `/admin/stores`) is the
 * distance origin.
 */
export const deliveryPricingSchema = z.object({
  // Distance-based delivery fee knobs
  baseSar: z.number().min(0).max(1000).optional(),
  includedKm: z.number().min(0).max(1000).optional(),
  perExtraKmSar: z.number().min(0).max(100).optional(),
  // Service fee + tax
  serviceFeeEnabled: z.boolean().optional(),
  serviceFeeType: z.enum(["fixed", "percent"]).optional(),
  serviceFeeValue: z.number().min(0).max(10000).optional(),
  taxEnabled: z.boolean().optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  maxDiscount: z.number().min(0).max(1000000).optional(),
});

/**
 * Delivery time-slots config schema (nested under `slots` key in
 * `delivery_settings`). Admin can edit windows + capacity via the
 * dashboard; defaults ship from migration 047.
 */
export const deliverySlotWindowSchema = z.object({
  id: z.string().min(1).max(64),
  label_ar: z.string().min(1).max(50),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 24h"),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 24h"),
  capacity: z.number().int().min(1).max(10000),
});

export const deliverySlotsSchema = z.object({
  enabled: z.boolean(),
  lead_time_minutes: z.number().int().min(0).max(24 * 60),
  max_days_ahead: z.number().int().min(0).max(60),
  min_days_ahead: z.number().int().min(0).max(60),
  timezone: z.string().min(1).max(64),
  slot_duration_minutes: z.number().int().min(15).max(720),
  windows: z.array(deliverySlotWindowSchema).min(1).max(20),
});

/**
 * Daily working-hours config (nested under `hours` key in
 * `delivery_settings`). When `enabled = true`, customers can only
 * place orders while the server clock (Asia/Riyadh, no DST) is
 * within `[open_time, close_time)`. The admin dashboard and the
 * checkout endpoint both consume this — the dashboard for the toggle
 * UI and the checkout as the authoritative gate so a tampered client
 * clock can never sneak an order through outside hours.
 *
 * Overnight windows (e.g. 18:00 → 02:00) are supported: if `close <
 * open` we treat it as wrapping past midnight.
 */
export const deliveryHoursSchema = z
  .object({
    enabled: z.boolean(),
    open_time: hhmm,
    close_time: hhmm,
    timezone: z.string().min(1).max(64).default("Asia/Riyadh"),
    closed_message: z
      .string()
      .trim()
      .max(500)
      .default(
        "التوصيل متاح فقط خلال ساعات العمل — يرجى المحاولة لاحقاً",
      ),
  })
  .strict()
  .refine((v) => v.open_time !== v.close_time, {
    message: "وقت الفتح والإغلاق لا يجب أن يتطابقا",
    path: ["close_time"],
  });

// ──────────────────────────────────────────────────────────────────────
// Inventory / notification / store-status settings
// ──────────────────────────────────────────────────────────────────────

export const inventorySettingsSchema = z
  .object({
    low_stock_threshold: z.coerce.number().int().min(1).max(100000),
  })
  .strict();

export const notificationSettingsSchema = z
  .object({
    whatsapp_admin_phone: z
      .string()
      .trim()
      .max(30)
      .refine(
        (value) => {
          if (value === "") return true;
          if (!/^[0-9+()\s-]+$/.test(value)) return false;
          const digits = value.replace(/\D/g, "").length;
          return digits >= 9 && digits <= 15;
        },
        "رقم واتساب غير صالح",
      )
      .default(""),
    notify_new_order: z.boolean().default(true),
    message_template: z
      .string()
      .trim()
      .max(2000)
      .default(
        "طلب جديد #{order_id} — {customer} — {total} ر.س — أسواق سيتي",
      ),
  })
  .strict();

/**
 * Admin-controlled open/closed toggle for the storefront.
 * `message` is the user-facing copy shown on the sticky banner; admins
 * can override the default. Empty messages fall back to the default.
 */
export const storeStatusSettingsSchema = z
  .object({
    is_open: z.boolean().default(true),
    message: z.string().trim().max(500).default(""),
  })
  .strict();

// ──────────────────────────────────────────────────────────────────────
// Coupons
// ──────────────────────────────────────────────────────────────────────

export const couponInputSchema = z.object({
  code: couponCodeSchema,
  type: z.enum(["percentage", "fixed", "free_delivery"], {
    errorMap: () => ({ message: "نوع الكوبون غير صالح" }),
  }),
  value: z.number().min(0).max(100000).optional().nullable(),
  min_order: z.number().min(0).max(1000000).optional().nullable(),
  max_discount: z.number().min(0).max(1000000).optional().nullable(),
  max_uses: z.number().int().min(0).max(1_000_000).optional().nullable(),
  source: z.enum(["admin", "spin", "event", "referral"]).optional(),
  expires_at: z.string().max(30).optional().nullable(),
  is_active: z.boolean().optional(),
});

// ──────────────────────────────────────────────────────────────────────
// Offers
// ──────────────────────────────────────────────────────────────────────

export const offerTargetInputSchema = z
  .object({
    target_type: z.enum(["product", "category", "vendor", "all"], {
      errorMap: () => ({ message: "نوع الهدف غير صالح" }),
    }),
    target_id: z.string().uuid().nullable().optional(),
  })
  .superRefine((t, ctx) => {
    if (t.target_type === "all" && t.target_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'لا يمكن تحديد هدف عند اختيار "الكل"',
        path: ["target_id"],
      });
    }
    if (t.target_type !== "all" && !t.target_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "يجب تحديد الهدف",
        path: ["target_id"],
      });
    }
  });

/**
 * Admin offer create/update schema.
 */
export const offerInputSchema = z
  .object({
    title_ar: z
      .string()
      .min(1, "عنوان العرض بالعربية مطلوب")
      .max(200),
    title_en: z.string().max(200).optional().nullable(),
    description_ar: z.string().max(2000).optional().nullable(),
    description_en: z.string().max(2000).optional().nullable(),
    image_url: z
      .string()
      .min(1, "رابط صورة العرض مطلوب")
      .max(500),
    discount_type: z.enum(["percentage", "fixed"], {
      errorMap: () => ({ message: "نوع الخصم غير صالح" }),
    }),
    discount_value: z
      .number()
      .positive("قيمة الخصم يجب أن تكون موجبة")
      .max(100000),
    max_discount: z.number().positive().max(100000).optional().nullable(),
    min_order: z.number().min(0).max(1000000).optional().nullable(),
    starts_at: z.string().max(30),
    ends_at: z.string().max(30),
    is_active: z.boolean().optional(),
    is_featured: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(9999).optional(),
    applies_to: z.enum(["catalog", "vendor", "mixed"]).optional(),
    targets: z
      .array(offerTargetInputSchema)
      .min(1, "يجب اختيار هدف واحد على الأقل"),
  })
  .superRefine((body, ctx) => {
    const start = Date.parse(body.starts_at);
    const end = Date.parse(body.ends_at);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "تاريخ غير صالح",
        path: ["starts_at"],
      });
      return;
    }
    if (end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "تاريخ النهاية يجب أن يكون بعد البداية",
        path: ["ends_at"],
      });
    }
    if (body.discount_type === "percentage" && body.discount_value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "النسبة يجب ألا تتجاوز 100",
        path: ["discount_value"],
      });
    }
  });
