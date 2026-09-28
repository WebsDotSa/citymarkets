// Search-backed picker for the offer admin form. Returns lightweight
// { id, label, secondary } records so the form can render a typeahead
// without bringing back the full row. `type` selects the source table
// (product | category | vendor) and `q` is a case-insensitive prefix
// match on name_ar.

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-api-auth";
import { error as logError } from "@/lib/logger";

const MAX_RESULTS = 30;

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_offers");
  if (gate instanceof NextResponse) return gate;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "product";
    const q = searchParams.get("q")?.trim() ?? "";

    if (!["product", "category", "vendor"].includes(type)) {
      return NextResponse.json(
        { success: false, error: "نوع الهدف غير صالح" },
        { status: 400 },
      );
    }

    let sql: string;
    let params: (string | number)[] = [];
    if (type === "product") {
      // Source from products_unified so vendors + catalog rows both surface.
      sql = `
        SELECT id, name_ar AS label, name_en AS secondary, image_url
          FROM products_unified
         WHERE is_active = TRUE
           ${q ? "AND (LOWER(name_ar) LIKE LOWER($" + (params.length + 1) + ") OR LOWER(COALESCE(name_en, '')) LIKE LOWER($" + (params.length + 1) + "))" : ""}
         ORDER BY name_ar ASC
         LIMIT ${MAX_RESULTS}
      `;
      if (q) params.push(`%${q}%`);
    } else if (type === "category") {
      sql = `
        SELECT id::text AS id, name_ar AS label, slug AS secondary
          FROM categories
         WHERE is_active = TRUE
           ${q ? "AND LOWER(name_ar) LIKE LOWER($" + (params.length + 1) + ")" : ""}
         ORDER BY sort_order ASC, name_ar ASC
         LIMIT ${MAX_RESULTS}
      `;
      if (q) params.push(`%${q}%`);
    } else {
      sql = `
        SELECT id::text AS id, name_ar AS label, slug AS secondary
          FROM vendors
         WHERE is_active = TRUE
           ${q ? "AND LOWER(name_ar) LIKE LOWER($" + (params.length + 1) + ")" : ""}
         ORDER BY name_ar ASC
         LIMIT ${MAX_RESULTS}
      `;
      if (q) params.push(`%${q}%`);
    }

    const result = await pool.query(sql, params);
    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    logError("GET offer targets error:", error);
    return NextResponse.json(
      { success: false, error: "فشل تحميل الأهداف" },
      { status: 500 },
    );
  }
}
