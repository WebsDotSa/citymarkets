import { requireIdParam } from "@/lib/request-params";
import { NextRequest, NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { logAdminAction } from "@/lib/admin-audit";
import {
  DEFAULT_STORE_OPENING_HOURS,
  parseStoreHours,
} from "@/lib/delivery/store-hours";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

/**
 * Coerce + validate `opening_hours` from the request body.
 *
 * Migration 079 (2026-09-30): the per-branch opening hours are
 * optional. If absent, we use the column DEFAULT (same as the global
 * fallback when the branch doesn't override). If present, we
 * `parseStoreHours` to apply the same HH:MM regex + timezone
 * fallback as the admin form.
 *
 * Returns the canonical JSONB-ready object.
 */
function coerceOpeningHours(raw: unknown): Record<string, unknown> {
  if (raw == null) {
    return { ...DEFAULT_STORE_OPENING_HOURS };
  }
  const parsed = parseStoreHours(raw);
  return {
    enabled: parsed.enabled,
    open_time: parsed.open_time,
    close_time: parsed.close_time,
    timezone: parsed.timezone,
    closed_message: parsed.closed_message,
  };
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const result = await query(
      // Migration 079 (2026-09-30): surface `opening_hours` so the
      // admin form can render the per-branch card without a second
      // round-trip. Old rows get the column DEFAULT backfill so the
      // admin never sees `null`.
      `SELECT id, name, name_ar, address,
              lat::float as lat, lng::float as lng,
              phone, is_active, is_main, opening_hours,
              created_at, updated_at
       FROM stores
       ORDER BY is_main DESC, name ASC`
    );
    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    logError("stores GET:", error);
    return NextResponse.json({ success: false, error: "فشل الجلب" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  const client = await pool.connect();
  try {
    const body = await request.json();
    await client.query("BEGIN");

    // Audit 2026-09-30 (Finding 5.1): wrap the "unset others, set new"
    // pair in a single transaction so a failed INSERT can never leave
    // the platform with zero `is_main = true` rows. Without the guard
    // a flaky network between the two statements was bricking every
    // checkout with a 503 "لم يتم تكوين الفرع الرئيسي".
    if (body.is_main) {
      await client.query(`UPDATE stores SET is_main = false WHERE is_main = true`);
    }

    const openingHours = coerceOpeningHours(body.opening_hours);

    const result = await client.query(
      `INSERT INTO stores (name, name_ar, address, lat, lng, phone, is_active, is_main, opening_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING id`,
      [
        body.name || body.name_ar,
        body.name_ar,
        body.address || "",
        Number(body.lat) || 0,
        Number(body.lng) || 0,
        body.phone || null,
        body.is_active !== false,
        body.is_main === true,
        JSON.stringify(openingHours),
      ]
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("INSERT did not return an id");
    await client.query("COMMIT");
    await logAdminAction(gate.admin, "store.create", {
      entityType: "store",
      entityId: id,
      details: body,
      request,
    });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    logError("stores POST:", error);
    return NextResponse.json({ success: false, error: "فشل الإنشاء" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  const client = await pool.connect();
  try {
    const url = new URL(request.url);
    const id = requireIdParam(url);
    if (id instanceof NextResponse) return id;
    const body = await request.json();

    await client.query("BEGIN");

    // Audit 2026-09-30 (Finding 5.1): wrap the unset-then-set pair in
    // a single transaction so the table never momentarily loses its
    // only main store. Pre-fix, a connection drop between the two
    // queries left every row with `is_main = false` and bricked every
    // checkout.
    if (body.is_main) {
      await client.query(
        `UPDATE stores SET is_main = false WHERE is_main = true AND id != $1`,
        [id],
      );
    }

    // Migration 079: opening_hours is part of the writable surface.
    // If the admin omits it we don't touch the column (preserves
    // whatever was set before). If present we overwrite via the
    // canonical coercion.
    if (body.opening_hours !== undefined) {
      const openingHours = coerceOpeningHours(body.opening_hours);
      await client.query(
        `UPDATE stores SET
           name = $1, name_ar = $2, address = $3, lat = $4, lng = $5,
           phone = $6, is_active = $7, is_main = $8,
           opening_hours = $9::jsonb, updated_at = NOW()
         WHERE id = $10`,
        [
          body.name || body.name_ar,
          body.name_ar,
          body.address || "",
          Number(body.lat) || 0,
          Number(body.lng) || 0,
          body.phone || null,
          body.is_active !== false,
          body.is_main === true,
          JSON.stringify(openingHours),
          id,
        ],
      );
    } else {
      await client.query(
        `UPDATE stores SET
           name = $1, name_ar = $2, address = $3, lat = $4, lng = $5,
           phone = $6, is_active = $7, is_main = $8, updated_at = NOW()
         WHERE id = $9`,
        [
          body.name || body.name_ar,
          body.name_ar,
          body.address || "",
          Number(body.lat) || 0,
          Number(body.lng) || 0,
          body.phone || null,
          body.is_active !== false,
          body.is_main === true,
          id,
        ]
      );
    }
    await client.query("COMMIT");
    await logAdminAction(gate.admin, "store.update", {
      entityType: "store",
      entityId: id,
      details: body,
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    logError("stores PUT:", error);
    return NextResponse.json({ success: false, error: "فشل التحديث" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const id = requireIdParam(url);
    if (id instanceof NextResponse) return id;

    // Check if this is the main store
    const check = await query(`SELECT is_main FROM stores WHERE id = $1`, [id]);
    if (check.rows[0]?.is_main) {
      return NextResponse.json({
        success: false,
        error: "لا يمكن حذف الفرع الرئيسي. عيّن فرع آخر كرئيسي أولاً."
      }, { status: 400 });
    }

    await query(`DELETE FROM stores WHERE id = $1`, [id]);
    await logAdminAction(gate.admin, "store.delete", {
      entityType: "store",
      entityId: id,
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("stores DELETE:", error);
    return NextResponse.json({ success: false, error: "فشل الحذف" }, { status: 500 });
  }
}
