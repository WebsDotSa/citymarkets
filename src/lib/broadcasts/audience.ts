// Audience expansion — turns an audience filter into broadcast_deliveries rows.
//
// Each (user, channel) gets one row. Channels without a meaningful target
// (e.g. SMS without a phone) are NOT pre-filtered here — that's the
// dispatcher's job (it marks them `skipped` so the metrics reflect the
// true reach).

import type { PoolClient } from "pg";
import type { BroadcastChannel } from "@/lib/validation";

export interface AudienceFilter {
  type: "all" | "segment";
  segment?:
    | "all"
    | "with_push"
    | "with_native_push"
    | "with_phone"
    | "with_email"
    | "top_loyalty"
    | "ordered_last_30d"
    | "inactive_30d";
  loyalty_min?: number;
  loyalty_tier?: "bronze" | "silver" | "gold" | "platinum";
  city?: string;
  exclude_user_ids?: string[];
}

export interface ExpansionResult {
  inserted: number;
  byChannel: Record<BroadcastChannel, number>;
}

/** Returns the user SELECT for the given audience. Placeholder $1..$N. */
function audienceUserIdsSQL(audience: AudienceFilter): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  switch (audience.segment) {
    case "with_push":
      clauses.push(
        `id IN (SELECT DISTINCT user_id FROM push_subscriptions WHERE user_id IS NOT NULL)`,
      );
      break;
    case "with_native_push":
      clauses.push(
        `id IN (SELECT DISTINCT user_id FROM native_push_tokens WHERE user_id IS NOT NULL)`,
      );
      break;
    case "with_phone":
      clauses.push(`phone IS NOT NULL AND phone <> ''`);
      break;
    case "with_email":
      clauses.push(
        `email IS NOT NULL AND email ~ '^[^@]+@[^@]+\\.[^@]+$'`,
      );
      break;
    case "top_loyalty":
      // P1-3 (full-system audit 2026-09-30): the live loyalty balance
      // lives in `loyalty_points.balance` (added in 021). The legacy
      // `users.loyalty_points` column is no longer written, so the
      // audience "top 10%" filter was always returning 0 rows. Join
      // the live table instead.
      clauses.push(
        `EXISTS (SELECT 1 FROM loyalty_points lp
                  WHERE lp.user_id = users.id
                    AND lp.balance > 0
                    AND lp.balance >= COALESCE((
                      SELECT PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY balance)
                        FROM loyalty_points WHERE balance > 0
                    ), 0))`,
      );
      break;
    case "ordered_last_30d":
      clauses.push(
        `id IN (SELECT user_id FROM orders WHERE created_at > NOW() - INTERVAL '30 days' AND user_id IS NOT NULL)`,
      );
      break;
    case "inactive_30d":
      clauses.push(
        `id NOT IN (SELECT user_id FROM orders WHERE created_at > NOW() - INTERVAL '30 days' AND user_id IS NOT NULL)`,
      );
      break;
    default:
      // 'all' or undefined — no clause.
      break;
  }

  if (audience.loyalty_min != null) {
    // P1-3 (full-system audit 2026-09-30): read the live balance
    // from the `loyalty_points` table. The legacy
    // `users.loyalty_points` column is no longer written by the
    // loyalty pipeline, so a `>= N` filter on it would never match
    // anyone whose points were credited after 021.
    clauses.push(
      `EXISTS (SELECT 1 FROM loyalty_points lp
                WHERE lp.user_id = users.id
                  AND lp.balance >= $${i++})`,
    );
    params.push(audience.loyalty_min);
  }
  if (audience.loyalty_tier) {
    clauses.push(`loyalty_tier = $${i++}::loyalty_tier_enum`);
    params.push(audience.loyalty_tier);
  }
  if (audience.city) {
    clauses.push(
      `id IN (SELECT user_id FROM addresses WHERE city = $${i++} AND user_id IS NOT NULL)`,
    );
    params.push(audience.city);
  }
  if (audience.exclude_user_ids?.length) {
    clauses.push(`id <> ALL($${i++}::uuid[])`);
    params.push(audience.exclude_user_ids);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { sql: `SELECT id FROM users ${where}`, params };
}

/**
 * Expand the audience for a broadcast into `broadcast_deliveries` rows.
 * One row per (user, channel). Idempotent — safe to re-run on the same
 * broadcast (ON CONFLICT DO NOTHING).
 */
export async function expandBroadcastAudience(
  client: PoolClient,
  broadcastId: string,
  audience: AudienceFilter,
  channels: BroadcastChannel[],
): Promise<ExpansionResult> {
  const { sql: userSQL, params } = audienceUserIdsSQL(audience);
  const counts: Record<BroadcastChannel, number> = {
    web_push: 0,
    native_push: 0,
    sms: 0,
    email: 0,
    in_app: 0,
  };

  // Cross join (user_ids × channels). Single INSERT, no extra round-trips.
  const insertSQL = `
    WITH user_ids AS (${userSQL})
    INSERT INTO broadcast_deliveries (broadcast_id, user_id, channel)
    SELECT $${params.length + 1}::uuid, user_ids.id, chan::text
      FROM user_ids
      CROSS JOIN UNNEST($${params.length + 2}::text[]) AS chan
    ON CONFLICT DO NOTHING
    RETURNING channel
  `;
  const res = await client.query(insertSQL, [
    ...params,
    broadcastId,
    channels,
  ]);
  for (const row of res.rows as { channel: string }[]) {
    if (row.channel in counts) {
      counts[row.channel as BroadcastChannel] += 1;
    }
  }
  const inserted = res.rowCount ?? 0;

  return { inserted, byChannel: counts };
}