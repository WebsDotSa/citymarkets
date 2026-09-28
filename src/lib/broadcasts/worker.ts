// Broadcast fan-out tick. Runs once a minute from `scripts/worker.ts`.
//
// Three phases per tick:
//   1. Promote `scheduled` broadcasts whose time has come → `sending`,
//      expanding their audience into `broadcast_deliveries` rows.
//   2. Claim a batch of pending deliveries and dispatch them.
//   3. Finalize broadcasts whose deliveries are all terminal.
//
// The worker is single-instance (one Docker service), so an in-process
// guard is enough to stop a slow tick overlapping the next one. The
// claim itself still uses FOR UPDATE SKIP LOCKED so a second instance
// would degrade to duplicate sends, never to a deadlock.

import { pool } from "@/lib/db";
import { error as logError, info as logInfo } from "@/lib/logger";
import { expandBroadcastAudience, type AudienceFilter } from "./audience";
import { dispatchOne, type DeliveryRow } from "./dispatcher";
import { finalizeCompletedBroadcasts, timeoutStuckBroadcasts } from "./finalize";
import type { BroadcastChannel } from "@/lib/validation";

/** Max deliveries handled per tick. Keeps one tick well under the interval. */
export const BATCH_SIZE = 500;

let running = false;

/** Promote due `scheduled` broadcasts and expand their audiences. */
async function startDueBroadcasts(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const due = await client.query(
      `UPDATE broadcasts
          SET status='sending', started_at=NOW(), updated_at=NOW()
        WHERE status='scheduled' AND scheduled_at <= NOW()
        RETURNING id, audience, channels`,
    );
    for (const row of due.rows as {
      id: string;
      audience: AudienceFilter;
      channels: BroadcastChannel[];
    }[]) {
      await expandBroadcastAudience(client, row.id, row.audience, row.channels);
    }
    await client.query("COMMIT");
    return due.rowCount ?? 0;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Claim up to BATCH_SIZE pending deliveries for broadcasts that are sending. */
async function claimPendingDeliveries(): Promise<DeliveryRow[]> {
  const r = await pool.query(
    `SELECT d.id, d.broadcast_id, d.user_id, d.channel
       FROM broadcast_deliveries d
       JOIN broadcasts b ON b.id = d.broadcast_id
      WHERE d.status = 'pending' AND b.status = 'sending'
      ORDER BY d.created_at
      LIMIT $1
        FOR UPDATE OF d SKIP LOCKED`,
    [BATCH_SIZE],
  );
  return r.rows as DeliveryRow[];
}

/** One full tick. Safe to call repeatedly; overlapping calls are skipped. */
export async function processBroadcasts(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const started = await startDueBroadcasts();
    if (started > 0) logInfo("[broadcast] started scheduled broadcasts", { count: started });

    const claimed = await claimPendingDeliveries();
    for (const d of claimed) {
      try {
        await dispatchOne(d);
      } catch (err) {
        // dispatchOne swallows its own errors; this catches DB failures
        // while recording the outcome so one bad row never stops the batch.
        logError("[broadcast] dispatch failed", err, { deliveryId: d.id });
      }
    }
    if (claimed.length > 0) {
      logInfo("[broadcast] dispatched deliveries", { count: claimed.length });
    }

    const finalized = await finalizeCompletedBroadcasts();
    if (finalized > 0) logInfo("[broadcast] finalized broadcasts", { count: finalized });

    const timedOut = await timeoutStuckBroadcasts();
    if (timedOut > 0) logInfo("[broadcast] timed out stuck broadcasts", { count: timedOut });
  } finally {
    running = false;
  }
}
