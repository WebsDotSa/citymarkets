import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { logAdminAction } from "@/lib/admin-audit";
import { DEFAULT_LOYALTY_SETTINGS, getLoyaltySettings, type LoyaltySettings } from '@/lib/orders/loyalty';
import { error as logError } from "@/lib/logger";

/**
 * GET /api/admin/loyalty
 *
 * Returns the live loyalty settings (from app_settings['loyalty'])
 * plus a few aggregates so the admin page can render without a second
 * round-trip:
 *   - total customers with a balance row
 *   - sum of outstanding balances
 *   - last 7 days of earn / redeem volume (so the admin sees traffic
 *     without leaving the page)
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_loyalty");
  if (gate instanceof NextResponse) return gate;

  const settings = await getLoyaltySettings();
  const client = await pool.connect();
  try {
    const stats = await client.query(
      `SELECT
         COUNT(*)::int AS members,
         COALESCE(SUM(balance), 0)::bigint AS total_balance,
         COALESCE(SUM(lifetime_earned), 0)::bigint AS total_earned,
         COALESCE(SUM(lifetime_redeemed), 0)::bigint AS total_redeemed
       FROM loyalty_points`,
    );
    const recent = await client.query(
      `SELECT type::text AS type,
              COUNT(*)::int AS count,
              COALESCE(SUM(ABS(points)), 0)::bigint AS volume
         FROM loyalty_transactions
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY type`,
    );
    const recentMap: Record<string, { count: number; volume: number }> = {};
    for (const row of recent.rows) {
      recentMap[row.type] = {
        count: row.count,
        volume: Number(row.volume),
      };
    }

    return NextResponse.json({
      success: true,
      settings,
      defaults: DEFAULT_LOYALTY_SETTINGS,
      stats: {
        members: stats.rows[0].members,
        total_balance: Number(stats.rows[0].total_balance),
        total_earned: Number(stats.rows[0].total_earned),
        total_redeemed: Number(stats.rows[0].total_redeemed),
        last_7_days: recentMap,
      },
    });
  } catch (err) {
    logError("[admin/loyalty] GET failed:", err);
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * PUT /api/admin/loyalty
 *
 * Persists updated loyalty settings to app_settings['loyalty']. The
 * webhook + admin COD grant paths read this on every order, so changes
 * take effect on the next transaction — no redeploy required.
 */
export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_loyalty");
  if (gate instanceof NextResponse) return gate;

  let body: Partial<LoyaltySettings> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON غير صالح" }, { status: 400 });
  }

  // Validate and clamp the inputs. The frontend also has UI clamps,
  // but never trust the wire.
  const next: LoyaltySettings = { ...DEFAULT_LOYALTY_SETTINGS };
  if (typeof body.enabled === "boolean") next.enabled = body.enabled;
  if (typeof body.earn_points_per_sar === "number" && body.earn_points_per_sar >= 0) {
    next.earn_points_per_sar = body.earn_points_per_sar;
  }
  if (typeof body.redeem_value_per_point === "number" && body.redeem_value_per_point > 0) {
    next.redeem_value_per_point = body.redeem_value_per_point;
  }
  if (typeof body.min_redeem_points === "number" && body.min_redeem_points >= 0) {
    next.min_redeem_points = Math.floor(body.min_redeem_points);
  }
  if (
    typeof body.max_redeem_percent === "number" &&
    body.max_redeem_percent >= 0 &&
    body.max_redeem_percent <= 1
  ) {
    next.max_redeem_percent = body.max_redeem_percent;
  }

  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('loyalty', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(next)],
    );
    await logAdminAction(gate.admin, "loyalty.settings.update", {
      entityType: "app_settings",
      entityId: "loyalty",
      details: { ...next },
      request,
    });
    return NextResponse.json({ success: true, settings: next });
  } catch (err) {
    logError("[admin/loyalty] PUT failed:", err);
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  } finally {
    client.release();
  }
}
