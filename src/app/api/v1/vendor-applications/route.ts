/**
 * Public storefront endpoint: prospective merchants apply to open a
 * store on City Markets.
 *
 *   POST /api/v1/vendor-applications
 *     Body: business info + owner info + initial operational prefs.
 *     Auth: NONE (the storefront form is anonymous — anyone can apply).
 *     Throttle: per-IP and per-email so a single client cannot flood
 *               the admin queue with junk submissions.
 *     Behaviour: INSERT into vendor_applications with status='new'.
 *                 The plaintext password is hashed immediately and
 *                 discarded; the admin will hand the merchant their
 *                 temporary password via a separate channel (the admin
 *                 UI exposes the email and lets the admin rotate the
 *                 password before notifying the merchant).
 *
 *   GET /api/v1/vendor-applications/<id>?email=...
 *     Auth: NONE — but you must know both the application UUID AND the
 *     applicant email (case-insensitive match). Returns the public-safe
 *     subset (status + admin_notes + reviewed_at). Never returns the
 *     password hash or internal admin_notes.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import {
  checkRateLimit,
  createRateLimitHeaders,
  GENERAL_API_CONFIG,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { vendorTypeSchema } from "@/lib/validation/primitives";

import { error as logError } from "@/lib/logger";

// 5 submissions per IP / 10 minutes — generous for legitimate retries
// (the form may be re-submitted while the user fixes a field) but tight
// enough to bound junk traffic. Per-email cap stops a single applicant
// from re-applying while their previous one is still in review.
const VENDOR_APAP_IP = {
  ...GENERAL_API_CONFIG,
  windowMs: 10 * 60 * 1000,
  maxRequests: 5,
  keyPrefix: "vendor:apply:ip",
};
const VENDOR_APAP_EMAIL = {
  ...GENERAL_API_CONFIG,
  windowMs: 10 * 60 * 1000,
  maxRequests: 3,
  keyPrefix: "vendor:apply:email",
};

const PHONE_RE = /^[+\d][\d\s\-()]{5,20}$/;

const applicationSchema = z.object({
  businessNameAr: z.string().trim().min(2).max(120),
  businessNameEn: z.string().trim().max(120).optional().or(z.literal("")),
  // Single source of truth — `vendorTypeSchema` is the same enum used
  // by `/api/admin/vendors` and the admin vendor form. Adding a new
  // vendor type only requires updating `VENDOR_TYPES` in
  // `src/lib/catalog/vendors.ts`.
  vendorType: vendorTypeSchema,
  descriptionAr: z.string().trim().max(1000).optional().or(z.literal("")),
  descriptionEn: z.string().trim().max(1000).optional().or(z.literal("")),

  ownerFullName: z.string().trim().min(2).max(120),
  ownerEmail: z.string().trim().toLowerCase().email().max(160),
  // bcrypt truncates after 72 bytes anyway, but we enforce a sane lower
  // bound here so callers don't accidentally send 1-char passwords.
  ownerPassword: z.string().min(8).max(128),
  ownerPhone: z.string().trim().regex(PHONE_RE, "رقم الجوال غير صالح"),
  ownerWhatsapp: z
    .string()
    .trim()
    .regex(PHONE_RE, "رقم الواتساب غير صالح")
    .optional()
    .or(z.literal("")),

  addressAr: z.string().trim().max(240).optional().or(z.literal("")),
  pickupLat: z.number().min(-90).max(90).optional(),
  pickupLng: z.number().min(-180).max(180).optional(),
  city: z.string().trim().max(80).optional().or(z.literal("")),

  deliveryMode: z.enum(["shared", "own_courier", "pickup_only"]).optional(),
  acceptsCod: z.boolean().optional(),
  acceptsOnlinePayment: z.boolean().optional(),

  // Optional supporting documents (URLs to commercial registration,
  // ID copy, menu PDF, etc.). Not validated server-side beyond the
  // length cap — the admin reviews them in the dashboard.
  documents: z
    .array(
      z.object({
        kind: z.string().max(40),
        url: z.string().url().max(500),
      }),
    )
    .max(10)
    .optional(),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  const ipRl = await checkRateLimit(ip, VENDOR_APAP_IP);
  if (!ipRl.allowed) {
    return NextResponse.json(
      {
        error: "تم إرسال عدد كبير من الطلبات. حاول لاحقاً.",
      },
      {
        status: 429,
        headers: createRateLimitHeaders(ipRl),
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بيانات الطلب غير صالحة" }, { status: 400 });
  }

  const parsed = applicationSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message || "بيانات الطلب غير صالحة" },
      { status: 400 },
    );
  }
  const v = parsed.data;

  // Per-email throttle uses the OWNER email, not the IP — protects
  // against a single applicant re-submitting while their previous one
  // is still being reviewed. Applied AFTER the schema parse so we know
  // the email is well-formed before consulting the limiter.
  const emailRl = await checkRateLimit(v.ownerEmail, VENDOR_APAP_EMAIL);
  if (!emailRl.allowed) {
    return NextResponse.json(
      { error: "لديك طلب سابق قيد المراجعة. انتظر رد الإدارة." },
      { status: 429, headers: createRateLimitHeaders(emailRl) },
    );
  }

  try {
    const passwordHash = await hashPassword(v.ownerPassword);

    const result = await query(
      `INSERT INTO vendor_applications (
         business_name_ar, business_name_en, vendor_type,
         description_ar, description_en,
         owner_full_name, owner_email, owner_password_hash,
         owner_phone, owner_whatsapp,
         address_ar, pickup_lat, pickup_lng, city,
         delivery_mode, accepts_cod, accepts_online_payment,
         documents
       ) VALUES (
         $1, $2, $3,
         $4, $5,
         $6, $7, $8,
         $9, $10,
         $11, $12, $13, $14,
         COALESCE($15, 'shared'), COALESCE($16, TRUE), COALESCE($17, TRUE),
         COALESCE($18, '[]'::jsonb)
       )
       RETURNING id, status, created_at`,
      [
        v.businessNameAr,
        v.businessNameEn || null,
        v.vendorType,
        v.descriptionAr || null,
        v.descriptionEn || null,
        v.ownerFullName,
        v.ownerEmail,
        passwordHash,
        v.ownerPhone,
        v.ownerWhatsapp || null,
        v.addressAr || null,
        v.pickupLat ?? null,
        v.pickupLng ?? null,
        v.city || null,
        v.deliveryMode ?? null,
        v.acceptsCod ?? null,
        v.acceptsOnlinePayment ?? null,
        v.documents ? JSON.stringify(v.documents) : null,
      ],
    );

    return NextResponse.json(
      {
        success: true,
        application: {
          id: result.rows[0].id,
          status: result.rows[0].status,
          createdAt: result.rows[0].created_at,
        },
      },
      { status: 201, headers: createRateLimitHeaders(emailRl) },
    );
  } catch (error: any) {
    if (error?.code === "23505") {
      // Partial unique index uq_vendor_applications_open_email —
      // same email already has an OPEN ('new') application.
      return NextResponse.json(
        { error: "لديك طلب سابق قيد المراجعة بنفس البريد الإلكتروني." },
        { status: 409 },
      );
    }
    logError("vendor application INSERT error:", error);
    return NextResponse.json(
      { error: "تعذّر إرسال الطلب. حاول لاحقاً." },
      { status: 500 },
    );
  }
}