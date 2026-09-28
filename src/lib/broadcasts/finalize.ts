// Finalize broadcasts whose deliveries are all in a terminal state.
//
// Called by the worker tick after every batch of dispatch. Flips the
// broadcast row to `sent` (with finished_at) once every delivery is
// one of: sent, delivered, opened, clicked, failed, skipped.
//
// Status `cancelled` is set by the cancel route — never touched here.

import { pool } from "@/lib/db";

type Terminal = "sent" | "delivered" | "opened" | "clicked" | "failed" | "skipped";

export async function finalizeCompletedBroadcasts(): Promise<number> {
  const r = await pool.query(
    `UPDATE broadcasts b
        SET status='sent', finished_at=NOW(), updated_at=NOW()
      WHERE status='sending'
        AND NOT EXISTS (
          SELECT 1 FROM broadcast_deliveries d
           WHERE d.broadcast_id = b.id AND d.status = 'pending'
        )
      RETURNING id`,
  );
  return r.rowCount ?? 0;
}

/** Detect broadcasts stuck in `sending` for too long and mark them failed. */
export async function timeoutStuckBroadcasts(maxAgeMinutes = 60): Promise<number> {
  const r = await pool.query(
    `UPDATE broadcasts
        SET status='failed', finished_at=NOW(), updated_at=NOW()
      WHERE status='sending'
        AND started_at < NOW() - ($1::int * INTERVAL '1 minute')
      RETURNING id`,
    [maxAgeMinutes],
  );
  return r.rowCount ?? 0;
}

export const TERMINAL_STATUSES: ReadonlyArray<Terminal> = [
  "sent",
  "delivered",
  "opened",
  "clicked",
  "failed",
  "skipped",
];