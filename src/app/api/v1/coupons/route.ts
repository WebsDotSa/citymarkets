import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { error as logError } from "@/lib/logger";

/**
 * GET /api/v1/coupons
 *
 * Lists the currently-active coupons so /profile/coupons can show the
 * user which codes are available. Public — no auth required, since the
 * rows only contain marketing copy + thresholds, nothing sensitive.
 *
 * Filters:
 *   - is_active = true
 *   - expires_at IS NULL OR expires_at > now()
 *   - max_uses IS NULL OR used_count < max_uses
 *
 * Sorted so non-expiring codes appear after expiring ones (which helps
 * the UI show "قريباً ينتهي" badges for the time-limited ones first).
 */
export async function GET(_request: NextRequest) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT code,
              type::text AS type,
              value,
              min_order,
              max_discount,
              max_uses,
              used_count,
              expires_at,
              is_active
         FROM coupons
        WHERE is_active = true
          AND (expires_at IS NULL OR expires_at > now())
          AND (max_uses IS NULL OR used_count < max_uses)
        ORDER BY expires_at ASC NULLS LAST`,
    );
    return NextResponse.json({ success: true, coupons: result.rows });
  } catch (err) {
    logError("[coupons] list failed:", err);
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  } finally {
    client.release();
  }
}
