import { NextRequest, NextResponse } from "next/server";
import { query, pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { logAdminAction } from "@/lib/admin-audit";
import { vendorCreateSchema, vendorUpdateSchema } from "@/lib/validation";
import { optionalPhone, optionalEmail } from "@/lib/validation/primitives";
import { hashPassword } from "@/lib/password";

import { error as logError } from '@/lib/logger';

function idCheck(url: URL) {
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "المعرّف مطلوب" }, { status: 400 });
  }
  return id;
}

// Slugify: lowercase, replace non-ASCII alphanumerics with dashes, collapse, trim
//
// NOTE: Intentionally NOT replaced with `generateSlug` from
// `@/lib/slug`. The canonical helper transliterates Arabic to Latin
// (فواكه → fawakeh); admin vendor slugs in this route are stored
// verbatim with Arabic characters preserved (matching the historical
// `vendors.slug` rows). Behaviour change would break lookups by slug
// for vendors created before the transliteration was introduced.
//
// Renamed from `slugify` to `slugifyKeepUnicode` to make the
// divergence from `@/lib/slug.generateSlug` obvious at every call site.
function slugifyKeepUnicode(input: string): string {
  return (input || "")
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Whether the admin's request has at least one owner-credential field
 * populated. Used by the route to decide whether to call
 * `upsertVendorOwner` at all — an empty form save on edit should be
 * a no-op (do not blank out the existing owner row).
 */
function hasOwnerCredentials(
  loginPhone: string | null | undefined,
  loginEmail: string | null | undefined,
  password: string | null | undefined
): boolean {
  const hasPhone = typeof loginPhone === "string" && loginPhone.trim().length > 0;
  const hasEmail = typeof loginEmail === "string" && loginEmail.trim().length > 0;
  const hasPassword = typeof password === "string" && password.length > 0;
  const clearEmail = typeof loginEmail === "string" && loginEmail.trim() === "";
  return hasPhone || hasEmail || hasPassword || clearEmail;
}

/**
 * Upsert the vendor owner login row in `vendor_staff`.
 *
 * Phone is REQUIRED for the *first* owner row on a brand-new vendor
 * (login by phone is the default surface — both password and OTP).
 * Email is OPTIONAL. Behavior:
 *
 *   - Creating a brand-new vendor with login info:
 *       → INSERT a `vendor_staff` row with role='owner' for this
 *         vendor. `phone` must be provided (`login_phone`); `email`
 *         may be omitted; `password` (≥8 chars) must be provided so
 *         the merchant can actually sign in.
 *   - Editing an existing vendor:
 *       → UPDATE only the fields the admin sent. Empty `password` =
 *         keep current hash. Empty `email` (=empty string) clears the
 *         stored email so the owner can sign in by phone only.
 *
 * Returns an error string if validation failed, or null on success.
 * The caller surfaces the error via the API response.
 *
 * `client` is an optional pg `PoolClient` — when supplied, every query
 * runs through that client so the call can be wrapped in a transaction
 * (used by POST so the vendor row + owner row commit or roll back
 * together — preventing the "فشل الإنشاء" toast on a row that was
 * actually inserted).
 */
async function upsertVendorOwner(
  vendorId: string,
  loginPhone: string | null | undefined,
  loginEmail: string | null | undefined,
  password: string | null | undefined,
  client?: {
    query: (...a: Parameters<typeof query>) => ReturnType<typeof query>;
  }
): Promise<string | null> {
  const hasPhone = typeof loginPhone === "string" && loginPhone.trim().length > 0;
  const hasEmail = typeof loginEmail === "string" && loginEmail.trim().length > 0;
  const hasPassword = typeof password === "string" && password.length > 0;

  // Reject email clear without explicit empty-string (UI sends '' on purpose).
  const clearEmail =
    typeof loginEmail === "string" && loginEmail.trim() === "";

  if (!hasPhone && !hasEmail && !hasPassword && !clearEmail) return null;

  const run = client ? client.query : (sql: string, params?: unknown[]) => query(sql, params);

  if (hasPhone && !optionalPhone.safeParse(loginPhone!.replace(/\s|-/g, "")).success) {
    return "رقم جوال المالك غير صالح — مثال: 5XXXXXXXX";
  }
  if (hasEmail && !optionalEmail.safeParse(loginEmail!.trim()).success) {
    return "البريد الإلكتروني للمالك غير صالح";
  }
  if (hasPassword && password!.length < 8) {
    return "كلمة مرور المالك يجب أن تكون 8 أحرف على الأقل";
  }

  // Find existing owner row for this vendor.
  const existing = await run(
    `SELECT id, phone, email FROM vendor_staff WHERE vendor_id = $1 AND role = 'owner' LIMIT 1`,
    [vendorId]
  );

  if (existing.rows.length === 0) {
    // No owner yet → phone must be set, password must be set to bootstrap one.
    if (!hasPhone) {
      return "يجب إدخال رقم جوال المالك لإنشاء حساب دخول المتجر";
    }
    if (!hasPassword) {
      return "يجب إدخال كلمة مرور (8 أحرف على الأقل) لإنشاء حساب المالك";
    }
    const passwordHash = await hashPassword(password!);
    const emailValue = hasEmail ? loginEmail!.trim().toLowerCase() : null;
    await run(
      `INSERT INTO vendor_staff (vendor_id, phone, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, 'owner', TRUE)`,
      [vendorId, loginPhone!.trim(), emailValue, passwordHash]
    );
    return null;
  }

  // Existing owner → update only the fields provided.
  const updates: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (hasPhone) {
    updates.push(`phone = $${i++}`);
    params.push(loginPhone!.trim());
  }
  if (hasEmail) {
    updates.push(`email = $${i++}`);
    params.push(loginEmail!.trim().toLowerCase());
  } else if (clearEmail) {
    updates.push(`email = NULL`);
  }
  if (hasPassword) {
    const passwordHash = await hashPassword(password!);
    updates.push(`password_hash = $${i++}`);
    params.push(passwordHash);
  }
  if (updates.length === 0) return null;
  params.push(existing.rows[0].id);
  await run(
    `UPDATE vendor_staff SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${i}`,
    params
  );
  return null;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    // LEFT JOIN keeps vendors without an owner row visible — the admin
    // UI shows those with a "⚠ بدون حساب دخول" badge so the operator
    // can spot vendors that exist but have no merchant login yet.
    const result = await query(
      `SELECT v.id, v.slug, v.name_ar, v.name_en, v.description_ar, v.description_en,
              v.logo_url, v.banner_url, v.vendor_type, v.category_slug, v.primary_color,
              v.contact_phone, v.contact_email, v.contact_whatsapp, v.address_ar,
              v.pickup_lat::float as pickup_lat, v.pickup_lng::float as pickup_lng,
              v.is_active, v.is_featured, v.sort_order,
              v.open_time::text AS open_time, v.close_time::text AS close_time,
              v.created_at, v.updated_at,
              owner.email AS login_email,
              owner.phone AS login_phone,
              (owner.id IS NOT NULL) AS has_owner
         FROM vendors v
         LEFT JOIN vendor_staff owner
           ON owner.vendor_id = v.id AND owner.role = 'owner'
         ORDER BY v.is_featured DESC, v.sort_order ASC, v.name_ar ASC`
    );
    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    logError("admin vendors GET:", error);
    return NextResponse.json({ success: false, error: "فشل الجلب" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;

  // Pre-validate the body BEFORE acquiring a DB transaction so we don't
  // hold a connection while we run JSON.parse + Zod.
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "صيغة الطلب غير صالحة" },
      { status: 400 }
    );
  }

  const parsed = vendorCreateSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { success: false, error: first?.message || "بيانات المتجر غير صالحة" },
      { status: 400 }
    );
  }
  const v = parsed.data;
  const slug = v.slug?.toString().trim() || slugifyKeepUnicode(v.name_ar);
  if (!slug) {
    return NextResponse.json(
      { success: false, error: "تعذّر توليد slug من الاسم" },
      { status: 400 }
    );
  }

  // Optionally pre-upsert the owner login in the same transaction. We
  // commit the vendor row + owner row together so the user never sees
  // a partial state ("فشل الإنشاء" toast yet the store is visible on
  // refresh). Skip the transaction entirely when the admin didn't
  // supply any owner fields — that's a normal "store-only" save.
  const loginPhone =
    typeof body.login_phone === "string" ? body.login_phone : null;
  const loginEmail =
    typeof body.login_email === "string" ? body.login_email : null;
  const password =
    typeof body.password === "string" ? body.password : null;

  let id: string | undefined;

  // Helper that runs the wrapped vendor INSERT (+ owner upsert) on the
  // transaction client. Errors raised here cause the surrounding
  // BEGIN/COMMIT block to roll back so no orphan vendor row survives.
  const runInTransaction = async (): Promise<
    { ok: true; id: string; slug: string } | { ok: false; status: number; error: string }
  > => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const insertResult = await client.query(
        `INSERT INTO vendors (
           slug, name_ar, name_en, description_ar, description_en,
           logo_url, banner_url, vendor_type, category_slug, primary_color,
           contact_phone, contact_email, contact_whatsapp, address_ar,
           pickup_lat, pickup_lng, is_active, is_featured, sort_order
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9, $10,
           $11, $12, $13, $14,
           $15, $16, $17, $18, $19
         )
         RETURNING id`,
        [
          slug,
          v.name_ar,
          v.name_en ?? null,
          v.description_ar ?? null,
          v.description_en ?? null,
          v.logo_url ?? null,
          v.banner_url ?? null,
          v.vendor_type,
          v.category_slug ?? null,
          v.primary_color || "#009345",
          v.contact_phone ?? null,
          v.contact_email ?? null,
          v.contact_whatsapp ?? null,
          v.address_ar ?? null,
          v.pickup_lat ?? null,
          v.pickup_lng ?? null,
          v.is_active !== false,
          v.is_featured === true,
          Number(v.sort_order) || 0,
        ]
      );
      const newId: string = insertResult.rows[0]?.id;
      if (!newId) throw new Error("vendor INSERT returned no id");

      // Owner upsert runs on the same client → same transaction. If it
      // throws (e.g. invalid phone format bubbles from upsert), the
      // outer CATCH rolls back the vendor INSERT too.
      if (hasOwnerCredentials(loginPhone, loginEmail, password)) {
        const ownerError = await upsertVendorOwner(
          newId,
          loginPhone,
          loginEmail,
          password,
          { query: (sql, params) => client.query(sql, params) as any }
        );
        if (ownerError) {
          // Translate validation errors into 400s without raising —
          // we still want to roll back the transaction.
          await client.query("ROLLBACK");
          return { ok: false, status: 400, error: ownerError };
        }
      }

      await client.query("COMMIT");
      return { ok: true, id: newId, slug };
    } catch (error: any) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  let result: Awaited<ReturnType<typeof runInTransaction>>;
  try {
    result = await runInTransaction();
  } catch (error: any) {
    logError("admin vendors POST:", error);
    const msg =
      error?.code === "23505"
        ? "الـ slug مستخدم من قبل متجر آخر — اختر slug فريد"
        : "فشل الإنشاء";
    const status = error?.code === "23505" ? 400 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }

  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  id = result.id;

  await logAdminAction(gate.admin, "vendor.create", {
    entityType: "vendor",
    entityId: id,
    details: { name_ar: v.name_ar, slug, vendor_type: v.vendor_type },
    request,
  });
  return NextResponse.json({ success: true, id, slug });
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const id = idCheck(url);
    if (id instanceof NextResponse) return id;
    const body = await request.json();
    const parsed = vendorUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { success: false, error: first?.message || "بيانات المتجر غير صالحة" },
        { status: 400 }
      );
    }
    const v = parsed.data;
    // name_ar is required only on create; on update it can be omitted.
    if (v.name_ar !== undefined && !String(v.name_ar).trim()) {
      return NextResponse.json(
        { success: false, error: "اسم المتجر بالعربية مطلوب" },
        { status: 400 }
      );
    }
    const slug = v.slug?.toString().trim() || (v.name_ar ? slugifyKeepUnicode(v.name_ar) : undefined);

    await query(
      // BUGFIX (audit 2026-09-29): wrap every column in COALESCE so a
      // partial PUT (the admin only changed the description) doesn't
      // null out unrelated fields. The toggle columns already used
      // COALESCE; the text columns used to be plain `= $N` and a
      // missing field in the JSON would overwrite the row with NULL.
      `UPDATE vendors SET
         slug = COALESCE($1, slug),
         name_ar = COALESCE($2, name_ar),
         name_en = COALESCE($3, name_en),
         description_ar = COALESCE($4, description_ar),
         description_en = COALESCE($5, description_en),
         logo_url = COALESCE($6, logo_url),
         banner_url = COALESCE($7, banner_url),
         vendor_type = COALESCE($8, vendor_type),
         category_slug = COALESCE($9, category_slug),
         primary_color = COALESCE($10, primary_color),
         contact_phone = COALESCE($11, contact_phone),
         contact_email = COALESCE($12, contact_email),
         contact_whatsapp = COALESCE($13, contact_whatsapp),
         address_ar = COALESCE($14, address_ar),
         pickup_lat = COALESCE($15, pickup_lat),
         pickup_lng = COALESCE($16, pickup_lng),
         is_active = COALESCE($17, is_active),
         is_featured = COALESCE($18, is_featured),
         sort_order = COALESCE($19, sort_order),
         updated_at = NOW()
       WHERE id = $20`,
      [
        slug ?? null,
        v.name_ar ?? null,
        v.name_en ?? null,
        v.description_ar ?? null,
        v.description_en ?? null,
        v.logo_url ?? null,
        v.banner_url ?? null,
        v.vendor_type ?? null,
        v.category_slug ?? null,
        v.primary_color ?? null,
        v.contact_phone ?? null,
        v.contact_email ?? null,
        v.contact_whatsapp ?? null,
        v.address_ar ?? null,
        v.pickup_lat ?? null,
        v.pickup_lng ?? null,
        v.is_active ?? null,
        v.is_featured ?? null,
        v.sort_order ?? null,
        id,
      ]
    );

    // Update owner credentials if provided. Empty password is ignored
    // so a partial form save (e.g. only the description was changed)
    // never wipes an existing password. Empty login_email is treated
    // as "clear it" only when explicitly sent as an empty string.
    const ownerPhone =
      typeof body.login_phone === "string" ? body.login_phone : null;
    const ownerEmail =
      typeof body.login_email === "string" ? body.login_email : null;
    const ownerPassword =
      typeof body.password === "string" ? body.password : null;

    if (hasOwnerCredentials(ownerPhone, ownerEmail, ownerPassword)) {
      const ownerError = await upsertVendorOwner(
        id,
        ownerPhone,
        ownerEmail,
        ownerPassword
      );
      if (ownerError) {
        return NextResponse.json({ success: false, error: ownerError }, { status: 400 });
      }
    }

    await logAdminAction(gate.admin, "vendor.update", {
      entityType: "vendor",
      entityId: id,
      details: { name_ar: v.name_ar, slug, vendor_type: v.vendor_type },
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    logError("admin vendors PUT:", error);
    const msg = error?.code === "23505" ? "الـ slug مستخدم من قبل متجر آخر" : "فشل التحديث";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const id = idCheck(url);
    if (id instanceof NextResponse) return id;

    // Check for related products / orders before deleting
    const products = await query(
      "SELECT COUNT(*)::int AS c FROM vendor_products WHERE vendor_id = $1",
      [id]
    );
    const orders = await query(
      "SELECT COUNT(*)::int AS c FROM vendor_orders WHERE vendor_id = $1",
      [id]
    );
    if (products.rows[0].c > 0 || orders.rows[0].c > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `لا يمكن حذف المتجر لوجود ${products.rows[0].c} منتج و ${orders.rows[0].c} طلب مرتبط. عطّل المتجر بدلاً من ذلك.`,
        },
        { status: 400 }
      );
    }

    await query("DELETE FROM vendors WHERE id = $1", [id]);
    await logAdminAction(gate.admin, "vendor.delete", {
      entityType: "vendor",
      entityId: id,
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("admin vendors DELETE:", error);
    return NextResponse.json({ success: false, error: "فشل الحذف" }, { status: 500 });
  }
}
