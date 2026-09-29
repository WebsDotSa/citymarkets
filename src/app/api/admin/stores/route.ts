import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { logAdminAction } from "@/lib/admin-audit";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

function idCheck(url: URL) {
  const id = url.searchParams.get("id");
  if (!id)
    return NextResponse.json({ success: false, error: "المعرّف مطلوب" }, { status: 400 });
  return id;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const result = await query(
      `SELECT id, name, name_ar, address, 
              lat::float as lat, lng::float as lng,
              phone, is_active, is_main, created_at, updated_at
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
  try {
    const body = await request.json();
    
    // If setting as main, unset other main stores first
    if (body.is_main) {
      await query(`UPDATE stores SET is_main = false WHERE is_main = true`);
    }
    
    const result = await query(
      `INSERT INTO stores (name, name_ar, address, lat, lng, phone, is_active, is_main)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
      ]
    );
    const id = result.rows[0]?.id;
    await logAdminAction(gate.admin, "store.create", {
      entityType: "store",
      entityId: id,
      details: body,
      request,
    });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    logError("stores POST:", error);
    return NextResponse.json({ success: false, error: "فشل الإنشاء" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const id = idCheck(url);
    if (id instanceof NextResponse) return id;
    const body = await request.json();
    
    // If setting as main, unset other main stores first
    if (body.is_main) {
      await query(`UPDATE stores SET is_main = false WHERE is_main = true AND id != $1`, [id]);
    }
    
    await query(
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
    await logAdminAction(gate.admin, "store.update", {
      entityType: "store",
      entityId: id,
      details: body,
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("stores PUT:", error);
    return NextResponse.json({ success: false, error: "فشل التحديث" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const id = idCheck(url);
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
