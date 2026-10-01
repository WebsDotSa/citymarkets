// PCP-79 live verification — exercises the new INSERT INTO
// order_status_logs statement against the running `citymarket-db`
// Postgres, in a single transaction we roll back at the end. This
// proves that the SQL fragment the production code emits is valid
// against the real schema (FK + nullable + enum + check constraints).
//
// Usage:  npx tsx scripts/pcp79-live-check.ts
// Env:    DATABASE_HOST=127.0.0.1 (default), DATABASE_PORT=5432,
//         DATABASE_NAME=citymarket_db, DATABASE_USER=citymarket_user,
//         DATABASE_PASSWORD=citymarket_user (matches .env.local)

import { Client } from "pg";

const cfg = {
  host: process.env.DATABASE_HOST ?? "127.0.0.1",
  port: Number(process.env.DATABASE_PORT ?? 5432),
  database: process.env.DATABASE_NAME ?? "citymarket_db",
  user: process.env.DATABASE_USER ?? "citymarket_user",
  password: process.env.DATABASE_PASSWORD ?? "citymarket_user",
};

async function main() {
  const c = new Client(cfg);
  await c.connect();

  let exitCode = 0;
  try {
    await c.query("BEGIN");

    // Mirror the create-checkout transaction: insert a stub parent
    // orders row + the new initial order_status_logs row.
    // guest_phone satisfies orders_has_contact CHECK
    // (user_id IS NOT NULL OR guest_phone IS NOT NULL);
    // `total` is NOT NULL on the real table.
    const { rows: ordRows } = await c.query<{ id: string }>(
      `INSERT INTO orders
         (user_id, guest_phone, status, type, subtotal, delivery_fee,
          service_fee, total, payment_method)
       VALUES (NULL, '+966500000079', 'pending', 'catalog', 100.00, 0, 0, 100.00, 'cod')
       RETURNING id`,
    );
    const parentOrderId = ordRows[0].id;
    console.log("✓ parent orders row inserted: id =", parentOrderId);

    // ---- The exact INSERT create-checkout now emits (PCP-79) ----
    await c.query(
      `INSERT INTO order_status_logs
         (order_id, old_status, new_status, changed_by, notes)
       VALUES ($1, NULL, 'pending', 'system:checkout', 'order created')`,
      [parentOrderId],
    );
    console.log("✓ initial order_status_logs row inserted");

    // SELECT and assert — same query shape the customer timeline uses.
    const { rows } = await c.query(
      `SELECT id, order_id, old_status, new_status, changed_by, notes
       FROM order_status_logs
       WHERE order_id = $1`,
      [parentOrderId],
    );
    if (rows.length !== 1) {
      throw new Error(`expected 1 row, got ${rows.length}`);
    }
    const r = rows[0] as {
      order_id: string;
      old_status: string | null;
      new_status: string;
      changed_by: string;
      notes: string;
    };
    if (r.order_id !== parentOrderId) throw new Error("order_id mismatch");
    if (r.old_status !== null) throw new Error(`old_status must be NULL, got ${r.old_status}`);
    if (r.new_status !== "pending") throw new Error(`new_status must be 'pending', got ${r.new_status}`);
    if (r.changed_by !== "system:checkout") throw new Error(`changed_by mismatch: ${r.changed_by}`);
    if (r.notes !== "order created") throw new Error(`notes mismatch: ${r.notes}`);
    console.log("✓ SELECT returned the audit row with correct bindings:");
    console.log("    order_id    =", r.order_id);
    console.log("    old_status  =", r.old_status);
    console.log("    new_status  =", r.new_status);
    console.log("    changed_by  =", r.changed_by);
    console.log("    notes       =", r.notes);

    // Verify the timeline query path that /orders/[id] uses sees
    // the row as the first event.
    const { rows: timeline } = await c.query(
      `SELECT new_status, changed_by, notes, created_at
       FROM order_status_logs
       WHERE order_id = $1
       ORDER BY created_at ASC, id ASC`,
      [parentOrderId],
    );
    if (timeline.length !== 1) throw new Error("timeline must show 1 event");
    console.log("✓ /orders/[id] timeline query sees the new event as the first row");

    await c.query("ROLLBACK");
    console.log("✓ transaction rolled back — no test pollution");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("✗ FAILED:", err);
    exitCode = 1;
  } finally {
    await c.end();
  }
  process.exit(exitCode);
}

main();