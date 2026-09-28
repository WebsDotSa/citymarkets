// Admin: count + sample users for an audience filter.
// Useful for the composer "audience preview" before sending.

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-api-auth";
import { audienceFilterSchema } from "@/lib/validation";
import { error as logError } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_broadcasts");
  if (gate instanceof NextResponse) return gate;

  try {
    const body = await request.json();
    const parsed = audienceFilterSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || "جمهور غير صالح" },
        { status: 400 },
      );
    }
    const audience = parsed.data;
    const where = audienceWhere(audience);
    const params: unknown[] = [];
    if (audience.loyalty_tier) {
      params.push(audience.loyalty_tier);
    }
    if (audience.city) {
      params.push(audience.city);
    }
    if (audience.exclude_user_ids?.length) {
      params.push(audience.exclude_user_ids);
    }

    const countSQL = `SELECT COUNT(*)::int AS total FROM users ${where}`;
    const sampleSQL = `SELECT id, name, phone, email FROM users ${where} LIMIT 10`;

    const [countRes, sampleRes] = await Promise.all([
      pool.query(countSQL, params),
      pool.query(sampleSQL, params),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        count: countRes.rows[0]?.total ?? 0,
        sample: sampleRes.rows,
      },
    });
  } catch (error) {
    logError("audience preview", error);
    return NextResponse.json({ success: false, error: "فشل المعاينة" }, { status: 500 });
  }
}

export function audienceWhere(audience: {
  type: "all" | "segment";
  segment?: string;
  loyalty_min?: number;
  loyalty_tier?: string;
  city?: string;
  exclude_user_ids?: string[];
}): string {
  const clauses: string[] = [];
  let i = 1;
  switch (audience.segment) {
    case "with_phone":
      clauses.push("phone IS NOT NULL AND phone <> ''");
      break;
    case "with_email":
      clauses.push("email IS NOT NULL AND email ~ '^[^@]+@[^@]+\\.[^@]+$'");
      break;
    case "top_loyalty":
      clauses.push(
        `loyalty_points > 0 AND loyalty_points >= (
          SELECT COALESCE(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY loyalty_points), 0)
          FROM users WHERE loyalty_points > 0
        )`,
      );
      break;
    case "ordered_last_30d":
      clauses.push(
        `id IN (SELECT DISTINCT user_id FROM orders WHERE created_at > NOW() - INTERVAL '30 days' AND user_id IS NOT NULL)`,
      );
      break;
    case "inactive_30d":
      clauses.push(
        `id NOT IN (SELECT user_id FROM orders WHERE created_at > NOW() - INTERVAL '30 days' AND user_id IS NOT NULL)`,
      );
      break;
    case "with_push":
    case "with_native_push":
    case "all":
    case undefined:
    default:
      break;
  }
  if (audience.loyalty_min != null) {
    clauses.push(`loyalty_points >= $${i++}`);
  }
  if (audience.loyalty_tier) {
    clauses.push(`loyalty_tier = $${i++}::loyalty_tier_enum`);
  }
  if (audience.city) {
    clauses.push(
      `id IN (SELECT DISTINCT user_id FROM addresses WHERE city = $${i++} AND user_id IS NOT NULL)`,
    );
  }
  if (audience.exclude_user_ids?.length) {
    clauses.push(`id <> ALL($${i++}::uuid[])`);
  }
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}