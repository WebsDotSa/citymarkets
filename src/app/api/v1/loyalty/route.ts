import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { getLoyaltySettings } from '@/lib/orders';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

// Legacy aliases kept so any imports of the constants from elsewhere
// (e.g. third-party scripts) still resolve. New code should read the
// live values via `getLoyaltySettings()` instead.
export const POINTS_PER_SAR_DEPRECATED = 1;
export const POINTS_REDEEM_VALUE = 0.05; // 1 point = 0.05 SAR (100pts = 5 SAR)
export const MIN_REDEEM_POINTS = 100;
export const MAX_REDEEM_PERCENT = 0.5; // can use points for up to 50% of order

export async function GET(req: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const client = await pool.connect();
  try {
    const balanceRes = await client.query(
      `SELECT balance, lifetime_earned, lifetime_redeemed
       FROM loyalty_points WHERE user_id = $1`,
      [userId],
    );
    const balance = balanceRes.rows[0]?.balance ?? 0;
    const lifetime_earned = balanceRes.rows[0]?.lifetime_earned ?? 0;
    const lifetime_redeemed = balanceRes.rows[0]?.lifetime_redeemed ?? 0;

    // Schema: loyalty_transactions (id, user_id, points, type, ref_order_id, created_at)
    const historyRes = await client.query(
      `SELECT id, points, type, ref_order_id, created_at
       FROM loyalty_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId],
    );

    const settings = await getLoyaltySettings();

    return NextResponse.json({
      success: true,
      data: {
        balance,
        lifetime_earned,
        lifetime_redeemed,
        enabled: settings.enabled,
        // Frontend marketing copy uses "كل 100 نقطة = 5 ر.س" — keep
        // both the per-point rate (so a future pricing change is
        // reflected without touching copy) and the friendly figure.
        redeem_value: settings.redeem_value_per_point,
        min_redeem: settings.min_redeem_points,
        max_redeem_percent: settings.max_redeem_percent,
        earn_points_per_sar: settings.earn_points_per_sar,
        transactions: historyRes.rows.map((r) => ({
          id: r.id,
          points: Number(r.points),
          type: r.type,
          ref_order_id: r.ref_order_id,
          created_at: r.created_at,
        })),
      },
    });
  } catch (err) {
    logError("[loyalty] fetch failed:", err);
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * Preview points redemption (no DB write). Body: { points, order_total }.
 * Returns the discount to apply.
 */
export async function POST(req: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { points?: number; order_total?: number; preview?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const points = Math.floor(Number(body.points || 0));
  const orderTotal = Number(body.order_total || 0);

  if (points < 0 || orderTotal <= 0) {
    return NextResponse.json({ error: "Invalid amounts" }, { status: 400 });
  }

  if (points < MIN_REDEEM_POINTS && points !== 0) {
    return NextResponse.json(
      { error: `الحد الأدنى للاستبدال ${MIN_REDEEM_POINTS} نقطة` },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    const balRes = await client.query(
      `SELECT balance FROM loyalty_points WHERE user_id = $1`,
      [userId],
    );
    const balance = balRes.rows[0]?.balance ?? 0;

    if (points > balance) {
      return NextResponse.json(
        { error: "ما عندك نقاط كافية" },
        { status: 400 },
      );
    }

    const settings = await getLoyaltySettings();
    const redeemValue = settings.redeem_value_per_point;
    const maxDiscount = orderTotal * settings.max_redeem_percent;
    const requestedDiscount = points * redeemValue;
    const actualDiscount = Math.min(requestedDiscount, maxDiscount);
    const actualPoints = Math.ceil(actualDiscount / redeemValue);

    return NextResponse.json({
      success: true,
      points_used: actualPoints,
      discount: Number(actualDiscount.toFixed(2)),
      new_balance: balance,
    });
  } catch (err) {
    logError("[loyalty] preview failed:", err);
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  } finally {
    client.release();
  }
}
