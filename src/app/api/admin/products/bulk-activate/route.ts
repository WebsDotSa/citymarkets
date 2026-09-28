import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-api-auth";
import { logAdminAction } from "@/lib/admin-audit";
import { CITY_MARKETS_VENDOR_ID } from "@/lib/types";
import { error as logError } from "@/lib/logger";

/**
 * POST /api/admin/products/bulk-activate
 *
 * Flips every inactive City Markets product (`vendor_products` where
 * `vendor_id = CITY_MARKETS_VENDOR_ID`) to `is_active = true`. Used by
 * the products admin page when the operator wants to recover after a
 * bulk hide / import glitch.
 *
 * - Idempotent: running it twice is a no-op the second time.
 * - Authoritative: only admin users with `manage_products` can call.
 * - Audited: writes an `admin.products.bulk_activate` row so we can
 *   trace who reactivated the catalog.
 *
 * Returns the count of rows touched so the UI can render "تم تفعيل N منتج".
 */
export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_products");
  if (gate instanceof NextResponse) return gate;

  try {
    const result = await query(
      `UPDATE vendor_products
          SET is_active = true,
              updated_at = NOW()
        WHERE vendor_id = $1
          AND is_active = false
        RETURNING id`,
      [CITY_MARKETS_VENDOR_ID],
    );

    const activatedCount = result.rowCount ?? result.rows.length;

    await logAdminAction(gate.admin, "products.bulk_activate", {
      entityType: "products",
      entityId: "bulk",
      details: { activated_count: activatedCount },
      request,
    });

    return NextResponse.json({
      success: true,
      data: { activated_count: activatedCount },
    });
  } catch (error) {
    logError("products bulk-activate error:", error);
    return NextResponse.json(
      { success: false, error: "فشل التفعيل الجماعي" },
      { status: 500 },
    );
  }
}
