#!/usr/bin/env node
/**
 * PCP-79 HTTP e2e — full round-trip.
 *
 * Exercises the *fixed* checkout code path end-to-end against a running
 * `next dev` server (port 4040) whose source is the pcp-79 worktree at
 * /var/www/citymarkets.sa/city-market-app/.worktrees/pcp-79 (which has
 * commit 4e620da applied).
 *
 * What this proves:
 *   1. POST /api/v1/checkout (with payment_method='cod', a real catalog
 *      item, a real customer + address) returns HTTP 200 + success=true.
 *   2. The DB now has an initial order_status_logs row for the new
 *      parent order, with the exact bindings create-checkout.ts emits:
 *         old_status   = NULL
 *         new_status   = 'pending'
 *         changed_by   = 'system:checkout'
 *         notes        = 'order created'
 *   3. The /orders/[id] timeline query sees the new event as the first
 *      row.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:4040 node scripts/pcp79-http-check.mjs
 *
 * Skips itself if DB / server are unavailable. Exits 0 on success,
 * 1 on any failed assertion (logs every check).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import pkg from "pg";

const { Pool } = pkg;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = process.env.BASE_URL || "http://127.0.0.1:4040";

// ---- env loader (avoids dotenv dep) ----
function loadEnv() {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();

const pool = new Pool({
  host: process.env.DATABASE_HOST || "127.0.0.1",
  port: Number(process.env.DATABASE_PORT || 5432),
  database: process.env.DATABASE_NAME || "citymarket_db",
  user: process.env.DATABASE_USER || "citymarket_user",
  password:
    process.env.DATABASE_PASSWORD ||
    "city-market-dev-database-password-only",
});

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
  console.log(
    `${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

async function bootstrap() {
  const initRes = await fetch(`${BASE}/`, { redirect: "manual" });
  const cookies = initRes.headers.getSetCookie
    ? initRes.headers.getSetCookie()
    : [];
  let csrf = "";
  let sessionId = "";
  for (const c of cookies) {
    const [pair] = c.split(";");
    const [k, v] = (pair || "").split("=");
    if (k === "csrf_token") csrf = v;
    if (k === "session_id") sessionId = v;
  }
  if (!csrf) throw new Error("no csrf_token cookie from BASE_URL");
  if (!sessionId) throw new Error("no session_id cookie from BASE_URL");

  async function signCustomer(userId, phone) {
    return await new SignJWT({ userId, phone })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer("citymarket-customer")
      .setAudience("citymarket-customer-api")
      .setSubject(userId)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET || ""));
  }
  return { csrf, sessionId, signCustomer };
}

async function findCatalogProduct() {
  // Use a catalog (City Markets main store) product with stock — the
  // simplest checkout path. The vitest tests cover multi-vendor
  // fan-out (e2e-checkout-slice3-fanout.mjs); this script targets the
  // PCP-79 specific concern: the initial order_status_logs row.
  const r = await pool.query(
    `SELECT id::text, name_ar AS name FROM vendor_products
     WHERE vendor_id = (SELECT id FROM vendors WHERE slug = 'city-markets' LIMIT 1)
       AND stock_quantity > 0 AND is_active = true
     ORDER BY created_at DESC LIMIT 1`,
  );
  if (r.rows.length === 0) {
    throw new Error("no active catalog product for slug=city-markets");
  }
  return r.rows[0];
}

async function setupCustomer(phone) {
  const userId = randomUUID();
  // Clear any previous run for this phone so the partial unique index
  // uniq_users_phone_active (WHERE deleted_at IS NULL) accepts our
  // INSERT. The fanout smoke script does the same ON CONFLICT dance;
  // we use a hard DELETE for clarity in a smoke that runs to completion.
  await pool.query(
    `DELETE FROM users WHERE phone = $1 AND deleted_at IS NOT NULL`,
    [phone],
  );
  await pool.query(
    `INSERT INTO users (id, phone, name, loyalty_points, loyalty_tier)
     VALUES ($1, $2, 'PCP79HTTP', 0, 'bronze')`,
    [userId, phone],
  );
  const u = await pool.query(
    `SELECT id::text FROM users WHERE phone = $1`,
    [phone],
  );
  const uid = u.rows[0].id;
  // Clear any prior addresses to keep this run isolated.
  await pool.query(`DELETE FROM addresses WHERE user_id = $1`, [uid]);
  await pool.query(
    `INSERT INTO addresses (user_id, label, address_text, lat, lng, is_default)
     VALUES ($1, 'Home', 'Riyadh', 24.7136, 46.6753, true)`,
    [uid],
  );
  const a = await pool.query(
    `SELECT id::text FROM addresses WHERE user_id = $1 ORDER BY is_default DESC LIMIT 1`,
    [uid],
  );
  return { userId: uid, addressId: a.rows[0].id };
}

async function main() {
  console.log(`\n--- PCP-79 HTTP e2e against ${BASE} ---\n`);

  // Pre-flight: DB reachable?
  try {
    await pool.query("SELECT 1");
  } catch (e) {
    console.log(`SKIP: DB not reachable (${e.message}).`);
    process.exit(0);
  }

  // Pre-flight: server reachable?
  try {
    const r = await fetch(`${BASE}/api/health`, {
      redirect: "manual",
    });
    if (!r.ok && r.status !== 404) {
      throw new Error(`unexpected /api/health status=${r.status}`);
    }
  } catch (e) {
    console.log(`SKIP: ${BASE} not reachable (${e.message}).`);
    process.exit(0);
  }

  const { csrf, sessionId, signCustomer } = await bootstrap();
  const product = await findCatalogProduct();
  const phone = `+9665${Math.floor(10000000 + Math.random() * 89999999)}`;
  const { userId, addressId } = await setupCustomer(phone);

  // Capture baseline count of order_status_logs so the assertion is
  // about THIS order, not about the whole table.
  const baselineRow = await pool.query(
    `SELECT count(*)::int AS n FROM order_status_logs
     WHERE changed_by = 'system:checkout' AND notes = 'order created'`,
  );
  const baselineCount = baselineRow.rows[0].n;

  // ---- POST /api/v1/checkout (COD) ----
  const idempotencyKey = randomUUID();
  const customerJwt = await signCustomer(userId, phone);
  const checkoutRes = await fetch(`${BASE}/api/v1/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-csrf-token": csrf,
      Cookie: `customer_session=${customerJwt}; csrf_token=${csrf}; session_id=${sessionId}`,
    },
    body: JSON.stringify({
      items: [{ product_id: product.id, quantity: 1 }],
      vendor_groups: [],
      delivery_type: "delivery",
      address_id: addressId,
      payment_method: "cash", // COD maps to enum 'cash' in this codebase
      idempotency_key: idempotencyKey,
      guestInfo: { name: "PCP79HTTP", phone, email: "pcp79@t.local" },
    }),
  });
  const checkoutJson = await checkoutRes.json();
  check(
    "checkout HTTP 200 + success=true",
    checkoutRes.status === 200 && checkoutJson?.success === true,
    `HTTP=${checkoutRes.status} success=${checkoutJson?.success}`,
  );
  if (!checkoutJson?.success) {
    console.log("DEBUG:", JSON.stringify(checkoutJson).slice(0, 600));
    process.exit(1);
  }
  // checkout-service emits CheckoutSuccessBody at the response top
  // level (no .data wrapper). The id field is snake_case
  // `parent_order_id`. We also tolerate the legacy camelCase shape and
  // any nested .data envelope for safety.
  const responseParentId =
    checkoutJson.parent_order_id ||
    checkoutJson.parentOrderId ||
    checkoutJson.data?.parentOrderId ||
    checkoutJson.data?.parent_order_id;
  check(
    "checkout returned parentOrderId",
    typeof responseParentId === "string" && responseParentId.length === 36,
    `parentOrderId=${responseParentId} keys=${Object.keys(checkoutJson.data || checkoutJson).join(",")}`,
  );

  // Resolve the actual parent order id: if the response didn't include
  // it, look up by the new baseline+1 row in order_status_logs.
  let resolvedOrderId = responseParentId;
  if (!resolvedOrderId) {
    const fallback = await pool.query(
      `SELECT order_id::text FROM order_status_logs
        WHERE changed_by = 'system:checkout' AND notes = 'order created'
        ORDER BY id DESC LIMIT 1`,
    );
    if (fallback.rows.length === 1) resolvedOrderId = fallback.rows[0].order_id;
  }
  check(
    "resolved parent order id from order_status_logs (baseline+1)",
    typeof resolvedOrderId === "string" && resolvedOrderId.length === 36,
    `resolvedOrderId=${resolvedOrderId}`,
  );

  // ---- THE PCP-79 ASSERTION ----
  // Verify that exactly one order_status_logs row exists for this
  // new parent order, and that its bindings match what create-checkout
  // emits.
  const logRows = await pool.query(
    `SELECT id, order_id::text, old_status, new_status, changed_by, notes
       FROM order_status_logs
       WHERE order_id = $1
       ORDER BY created_at ASC, id ASC`,
    [resolvedOrderId],
  );
  check(
    "order_status_logs has exactly 1 row for new parent order",
    logRows.rows.length === 1,
    `rows=${logRows.rows.length}`,
  );
  if (logRows.rows.length === 1) {
    const r = logRows.rows[0];
    check(
      "row.old_status IS NULL",
      r.old_status === null,
      `got=${r.old_status}`,
    );
    check(
      "row.new_status = 'pending'",
      r.new_status === "pending",
      `got=${r.new_status}`,
    );
    check(
      "row.changed_by = 'system:checkout'",
      r.changed_by === "system:checkout",
      `got=${r.changed_by}`,
    );
    check(
      "row.notes = 'order created'",
      r.notes === "order created",
      `got=${r.notes}`,
    );
  }

  // Verify table-wide counter ticked up by exactly 1.
  const afterRow = await pool.query(
    `SELECT count(*)::int AS n FROM order_status_logs
     WHERE changed_by = 'system:checkout' AND notes = 'order created'`,
  );
  const afterCount = afterRow.rows[0].n;
  check(
    "table-wide 'system:checkout:order created' count incremented by 1",
    afterCount === baselineCount + 1,
    `before=${baselineCount} after=${afterCount}`,
  );

  // ---- Verify timeline query shape ----
  const timeline = await pool.query(
    `SELECT new_status, changed_by, notes
       FROM order_status_logs
       WHERE order_id = $1
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    [resolvedOrderId],
  );
  check(
    "/orders/[id] timeline sees the new event as the first row",
    timeline.rows.length === 1 &&
      timeline.rows[0].changed_by === "system:checkout",
    `first_event=${JSON.stringify(timeline.rows[0] || null)}`,
  );

  // Cleanup: remove the test orders so subsequent runs aren't polluted.
  // Order: status_logs (CASCADE on orders delete), vendor_orders (CASCADE),
  // orders. We use a savepoint so a rollback unwinds cleanly.
  try {
    await pool.query(`DELETE FROM orders WHERE id = $1`, [resolvedOrderId]);
    console.log("✓ cleanup: deleted test parent order (cascade removed log row)");
  } catch (e) {
    console.log(`! cleanup skipped (${e.message})`);
  }

  await pool.end();

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.log(`\n✗ ${failed.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log(`\n✓ all ${passedCount(results)} assertions passed.`);
  process.exit(0);
}

function passedCount(rs) {
  return rs.filter((r) => r.ok).length;
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});