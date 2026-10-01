/**
 * PATCH /api/admin/vendor-applications/[id]
 *
 *   { action: "approve", slug?: string, primary_color?: string, is_featured?: boolean }
 *     Atomically:
 *       1. INSERT into `vendors` using the application data
 *       2. INSERT into `vendor_staff` with role='owner' using the
 *          password_hash that was hashed at submission time
 *       3. INSERT default `vendor_settings` row
 *       4. UPDATE the application: status='approved', reviewed_by,
 *          reviewed_at, approved_vendor_id
 *
 *     Slug generation:
 *       - Admin may pass an explicit slug.
 *       - Otherwise derive via generateSlug(business_name_ar) — Latin
 *         transliteration. If the slug collides, append `-<n>` until free.
 *
 *   { action: "reject", rejection_reason: string }
 *     Sets status='rejected' + the admin-supplied reason. The owner
 *     row is NOT created; the password_hash is left in place (so if the
 *     admin later un-rejects the application by hand no migration is
 *     needed) but no vendor_staff row exists yet.
 *
 *   { action: "note", admin_notes: string }
 *     Free-form internal note, no status change. Useful for tagging an
 *     application with a follow-up.
 *
 * All branches run inside a single transaction so partial approvals
 * never leave the database in a half-built state.
 */
import { UUID_RE } from "@/lib/uuid";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { logAdminAction } from "@/lib/admin-audit";
import { generateSlug } from "@/lib/slug";

import { error as logError } from "@/lib/logger";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    slug: z
      .string()
      .trim()
      .max(80)
      .regex(SLUG_RE, "slug يجب أن يحتوي على حروف لاتينية صغيرة وأرقام وشرطات فقط")
      .optional()
      .or(z.literal("")),
    primary_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "اللون يجب أن يكون بصيغة #RRGGBB")
      .optional(),
    is_featured: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("reject"),
    rejection_reason: z.string().trim().min(2).max(500),
    admin_notes: z.string().trim().max(2000).optional(),
  }),
  z.object({
    action: z.literal("note"),
    admin_notes: z.string().trim().min(1).max(2000),
  }),
]);

async function nextFreeSlug(
  client: import("pg").PoolClient,
  base: string,
): Promise<string> {
  const cleaned = base || `store-${Date.now()}`;
  let candidate = cleaned;
  let n = 2;
  // We tolerate up to 100 collisions before failing — covers the
  // realistic case where multiple applicants produce the same translit.
  while (n < 102) {
    const check = await client.query(
      `SELECT 1 FROM vendors WHERE slug = $1 LIMIT 1`,
      [candidate],
    );
    if (check.rows.length === 0) return candidate;
    candidate = `${cleaned}-${n}`;
    n++;
  }
  throw new Error("تعذّر توليد slug فريد");
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { success: false, error: "المعرّف غير صالح" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "بيانات غير صالحة" },
      { status: 400 },
    );
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { success: false, error: first?.message || "بيانات غير صالحة" },
      { status: 400 },
    );
  }
  const payload = parsed.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // FOR UPDATE so two admins don't race to approve the same row.
    const app = await client.query(
      `SELECT id, status, owner_email, owner_password_hash,
              business_name_ar, business_name_en,
              vendor_type, description_ar, description_en,
              owner_full_name, owner_phone, owner_whatsapp,
              address_ar, pickup_lat, pickup_lng, city,
              delivery_mode, accepts_cod, accepts_online_payment
         FROM vendor_applications
        WHERE id = $1
        FOR UPDATE`,
      [id],
    );
    if (app.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: "الطلب غير موجود" },
        { status: 404 },
      );
    }
    const application = app.rows[0];

    if (payload.action === "approve") {
      if (application.status !== "new") {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            success: false,
            error: `لا يمكن الموافقة على طلب تمت معالجته سابقاً (الحالة: ${application.status}).`,
          },
          { status: 400 },
        );
      }

      // Reject if the owner email already has an ACTIVE vendor login
      // (e.g. another approved application already produced one). The
      // partial unique index only covers open applications — past
      // approved applications can leave an orphan staff row that would
      // block a re-approve.
      const existingOwner = await client.query(
        `SELECT 1 FROM vendor_staff WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [application.owner_email],
      );
      if (existingOwner.rows.length > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            success: false,
            error:
              "يوجد حساب مالك مسجّل بنفس البريد مسبقاً. احذف الحساب القديم أو غيّر البريد.",
          },
          { status: 409 },
        );
      }

      // Slug: admin-supplied, else translit of business_name_ar.
      let baseSlug =
        payload.slug && payload.slug.length > 0
          ? payload.slug
          : generateSlug(application.business_name_ar);
      if (!baseSlug) baseSlug = `store-${Date.now()}`;
      const slug = await nextFreeSlug(client, baseSlug);

      const primaryColor =
        payload.primary_color || "#009345";

      // 1) INSERT vendor
      const vendorInsert = await client.query(
        `INSERT INTO vendors (
           slug, name_ar, name_en, description_ar, description_en,
           vendor_type, primary_color,
           contact_phone, contact_email, contact_whatsapp,
           address_ar, pickup_lat, pickup_lng,
           is_active, is_featured, sort_order
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7,
           $8, $9, $10,
           $11, $12, $13,
           TRUE, COALESCE($14, FALSE), 0
         )
         RETURNING id`,
        [
          slug,
          application.business_name_ar,
          application.business_name_en || null,
          application.description_ar || null,
          application.description_en || null,
          application.vendor_type,
          primaryColor,
          application.owner_phone || null,
          application.owner_email || null,
          application.owner_whatsapp || null,
          application.address_ar || null,
          application.pickup_lat ?? null,
          application.pickup_lng ?? null,
          payload.is_featured ?? null,
        ],
      );
      const vendorId = vendorInsert.rows[0].id;

      // 2) INSERT vendor_staff owner
      await client.query(
        `INSERT INTO vendor_staff (
           vendor_id, email, password_hash,
           full_name_ar, full_name_en, role, is_active
         ) VALUES ($1, LOWER($2), $3, $4, NULL, 'owner', TRUE)`,
        [
          vendorId,
          application.owner_email,
          application.owner_password_hash,
          application.owner_full_name,
        ],
      );

      // 3) INSERT default vendor_settings
      await client.query(
        `INSERT INTO vendor_settings (
           vendor_id, delivery_mode, accepts_cod, accepts_online_payment
         ) VALUES ($1, $2, $3, $4)`,
        [
          vendorId,
          application.delivery_mode || "shared",
          application.accepts_cod !== false,
          application.accepts_online_payment !== false,
        ],
      );

      // 4) Mark application approved
      await client.query(
        `UPDATE vendor_applications
            SET status = 'approved',
                reviewed_by = $1,
                reviewed_at = NOW(),
                approved_vendor_id = $2
          WHERE id = $3`,
        [gate.admin.id, vendorId, id],
      );

      await client.query("COMMIT");

      await logAdminAction(gate.admin, "vendor_application.approve", {
        entityType: "vendor_application",
        entityId: id,
        details: { vendorId, slug, email: application.owner_email },
        request,
      });

      return NextResponse.json({
        success: true,
        vendorId,
        slug,
      });
    }

    if (payload.action === "reject") {
      if (application.status !== "new") {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            success: false,
            error: `لا يمكن رفض طلب تمت معالجته سابقاً (الحالة: ${application.status}).`,
          },
          { status: 400 },
        );
      }
      await client.query(
        `UPDATE vendor_applications
            SET status = 'rejected',
                rejection_reason = $1,
                admin_notes = COALESCE($2, admin_notes),
                reviewed_by = $3,
                reviewed_at = NOW()
          WHERE id = $4`,
        [
          payload.rejection_reason,
          payload.admin_notes ?? null,
          gate.admin.id,
          id,
        ],
      );
      await client.query("COMMIT");

      await logAdminAction(gate.admin, "vendor_application.reject", {
        entityType: "vendor_application",
        entityId: id,
        details: { reason: payload.rejection_reason },
        request,
      });
      return NextResponse.json({ success: true });
    }

    // action === "note"
    await client.query(
      `UPDATE vendor_applications
          SET admin_notes = $1
        WHERE id = $2`,
      [payload.admin_notes, id],
    );
    await client.query("COMMIT");

    await logAdminAction(gate.admin, "vendor_application.note", {
      entityType: "vendor_application",
      entityId: id,
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => {});
    logError("admin vendor-applications PATCH:", error);
    const msg =
      error?.code === "23505"
        ? "تعارض في قاعدة البيانات (slug أو إيميل مكرر)"
        : error?.message || "فشل التحديث";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}