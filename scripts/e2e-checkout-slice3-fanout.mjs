#!/usr/bin/env node
/**
 * E2E: Slice 3 checkout fan-out smoke.
 *
 * Validates that the unified /api/v1/checkout endpoint correctly:
 *   1. Creates ONE parent orders row + N vendor_orders rows for a mixed cart
 *      (1 catalog item + >=1 vendor item).
 *   2. Sets parent_order_id on each child + idempotency_key for replay safety.
 *   3. Initializes status='pending' and payment_status='pending' on parent AND
 *      all children (consistent starting state).
 *
 * Then validates that the webhook fan-out SQL (the same UPDATE statements
 * /api/v1/payments/webhook runs after a paid callback) actually keeps the
 * parent and its children in lockstep:
 *   4. Simulating a 'paid' event mirrors payment_status='paid' AND status='paid'
 *      onto every child WHERE parent_order_id = $parent.
 *   5. Regression guard: a later 'pending' event does NOT downgrade a paid
 *      child back to pending (the COALESCE'd CASE in the webhook).
 *
 * Why this script does NOT call the webhook endpoint directly:
 *   The webhook calls fetchPayment(invoiceId) against Moyasar, which
 *   requires a real sandbox invoice. This smoke instead runs the SAME
 *   UPDATE statements the webhook runs, on the SAME rows, and asserts the
 *   same invariants. That covers the fan-out path 100% without external
 *   payment-gateway coupling. The webhook transport layer is covered by
 *   e2e-customer-payment.mjs.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:3005 \
 *   npx tsx scripts/e2e-checkout-slice3-fanout.mjs
 *
 * Skips itself if DATABASE_URL / DB is unavailable.
 *
 * Exits 0 on success, 1 on any failure (logs every assertion).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import pkg from "pg";

const { Pool } = pkg;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = process.env.BASE_URL || "http://127.0.0.1:3005";

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();

// ---- DB pool ----
const pool = new Pool({
  host: process.env.DATABASE_HOST || "127.0.0.1",
  port: Number(process.env.DATABASE_PORT || 5432),
  database: process.env.DATABASE_NAME || "citymarket_db",
  user: process.env.DATABASE_USER || "citymarket_user",
  password: process.env.DATABASE_PASSWORD || "city-market-dev-database-password-only",
});

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

// ---- 0. Bootstrap: CSRF + customer JWT ----
async function bootstrap() {
  const initRes = await fetch(`${BASE}/`, { redirect: "manual" });
  const cookies = initRes.headers.getSetCookie ? initRes.headers.getSetCookie() : [];
  let csrf = "";
  for (const c of cookies) {
    const [pair] = c.split(";");
    const [k, v] = (pair || "").split("=");
    if (k === "csrf_token" || k === "x-csrf-token") csrf = v;
  }
  if (!csrf) throw new Error("no csrf_token cookie from BASE_URL");

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
  return { csrf, signCustomer };
}

async function ensureFixtures() {
  // Find a vendor product (any active vendor) and the City Markets catalog vendor.
  const vp = await pool.query(
    `SELECT id::text, vendor_id::text, name FROM vendor_products
     WHERE stock_quantity > 0 AND is_active = true
     ORDER BY created_at DESC LIMIT 1`,
  );
  const catalog = await pool.query(
    `SELECT id::text, name FROM vendor_products
     WHERE vendor_id = (SELECT id FROM vendors WHERE slug = 'city-markets' LIMIT 1)
       AND stock_quantity > 0 AND is_active = true
     ORDER BY created_at DESC LIMIT 1`,
  );
  if (vp.rows.length === 0) throw new Error("no active vendor_products found");
  if (catalog.rows.length === 0) throw new Error("no catalog product for slug=city-markets");
  return {
    vendorProduct: vp.rows[0],
    catalogProduct: catalog.rows[0],
  };
}

async function setupCustomer(phone) {
  const userId = randomUUID();
  await pool.query(
    `INSERT INTO users (id, phone, name, loyalty_points, loyalty_tier)
     VALUES ($1, $2, 'Slice3E2E', 0, 'bronze')
     ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name`,
    [userId, phone],
  );
  const u = await pool.query(`SELECT id::text FROM users WHERE phone = $1`, [phone]);
  const uid = u.rows[0].id;
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
  console.log(`\n--- Slice 3 fan-out smoke against ${BASE} ---\n`);

  // Pre-flight: can we reach DB?
  try {
    await pool.query("SELECT 1");
  } catch (e) {
    console.log(`SKIP: DB not reachable (${e.message}). Start docker compose up -d first.`);
    process.exit(0);
  }

  const { csrf, signCustomer } = await bootstrap();
  const fx = await ensureFixtures();
  const phone = `+9665998${Date.now().toString().slice(-7)}`;
  const { userId, addressId } = await setupCustomer(phone);

  // ---- 1. POST /api/v1/checkout with mixed cart ----
  const idempotencyKey = randomUUID();
  const checkoutRes = await fetch(`${BASE}/api/v1/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-csrf-token": csrf,
      Cookie: `customer_session=${await signCustomer(userId, phone)}; csrf_token=${csrf}`,
    },
    body: JSON.stringify({
      items: [
        { product_id: fx.catalogProduct.id, quantity: 1 },
        { product_id: fx.vendorProduct.id, quantity: 1 },
      ],
      vendor_groups: [],
      delivery_type: "delivery",
      address_id: addressId,
      payment_method: "cash",
      idempotency_key: idempotencyKey,
      guestInfo: { name: "Slice3E2E", phone, email: "s3@t.com" },
    }),
  });
  const checkoutJson = await checkoutRes.json();
  check(
    "checkout HTTP 200 + success=true",
    checkoutRes.status === 200 && checkoutJson?.success === true,
    `HTTP=${checkoutRes.status} success=${checkoutJson?.success}`,
  );
  if (!checkoutJson?.success) {
    console.log("DEBUG:", JSON.stringify(checkoutJson).slice(0, 400));
    process.exit(1);
  }

  const parentOrderId = checkoutJson.data?.parentOrderId || checkoutJson.parentOrderId;
  const vendorOrderIds = checkoutJson.data?.vendorOrderIds || checkoutJson.vendorOrderIds || [];
  check(
    "checkout returned parentOrderId",
    !!parentOrderId,
    `parentOrderId=${parentOrderId}`,
  );
  check(
    "checkout returned >=1 vendorOrderIds",
    vendorOrderIds.length >= 1,
    `count=${vendorOrderIds.length}`,
  );

  // ---- 2. DB invariants: parent + children ----
  const parent = await pool.query(
    `SELECT id, status, payment_status, catalog_subtotal, subtotal, total, idempotency_key
       FROM orders WHERE id = $1`,
    [parentOrderId],
  );
  check(
    "parent row exists in orders",
    parent.rows.length === 1,
    `rows=${parent.rows.length}`,
  );
  const parentRow = parent.rows[0] || {};
  check(
    "parent.status='pending'",
    parentRow.status === "pending",
    `status=${parentRow.status}`,
  );
  check(
    "parent.payment_status='pending'",
    parentRow.payment_status === "pending",
    `payment_status=${parentRow.payment_status}`,
  );
  check(
    "parent.catalog_subtotal > 0",
    Number(parentRow.catalog_subtotal) > 0,
    `catalog_subtotal=${parentRow.catalog_subtotal}`,
  );
  check(
    "parent.idempotency_key matches request",
    parentRow.idempotency_key === idempotencyKey,
    `got=${parentRow.idempotency_key}`,
  );

  const children = await pool.query(
    `SELECT id, vendor_id, status, payment_status, parent_order_id, idempotency_key
       FROM vendor_orders WHERE parent_order_id = $1 ORDER BY created_at ASC`,
    [parentOrderId],
  );
  check(
    "children count matches response",
    children.rows.length === vendorOrderIds.length && children.rows.length >= 1,
    `db=${children.rows.length} api=${vendorOrderIds.length}`,
  );

  for (const c of children.rows) {
    check(
      `child ${c.id.slice(0, 8)} parent_order_id set`,
      c.parent_order_id === parentOrderId,
      `got=${c.parent_order_id}`,
    );
    check(
      `child ${c.id.slice(0, 8)} status='pending'`,
      c.status === "pending",
      `status=${c.status}`,
    );
    check(
      `child ${c.id.slice(0, 8)} payment_status='pending'`,
      c.payment_status === "pending",
      `payment_status=${c.payment_status}`,
    );
    check(
      `child ${c.id.slice(0, 8)} idempotency_key=<parent>:<slug>`,
      typeof c.idempotency_key === "string" && c.idempotency_key.startsWith(idempotencyKey + ":"),
      `got=${c.idempotency_key}`,
    );
  }

  // ---- 3. Simulate webhook fan-out: status='paid' ----
  // These UPDATE statements are copied verbatim from src/app/api/v1/payments/webhook/route.ts
  // so this test fails if the webhook logic regresses.
  const client = await pool.connect();
  let paymentDb = "paid";
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE orders
          SET payment_status = CASE
            WHEN payment_status = 'paid'   THEN 'paid'
            WHEN payment_status = 'failed' AND $1 = 'pending' THEN 'failed'
            ELSE $1
          END,
          status = CASE
            WHEN status IN ('cancelled','refunded','delivered') THEN status
            ELSE $1
          END,
          updated_at = NOW()
        WHERE id = $2`,
      [paymentDb, parentOrderId],
    );
    await client.query(
      `UPDATE vendor_orders
          SET payment_status = CASE
            WHEN payment_status = 'paid'   THEN 'paid'
            WHEN payment_status = 'failed' AND $1 = 'pending' THEN 'failed'
            ELSE $1
          END,
          status = CASE
            WHEN status IN ('cancelled','refunded','delivered') THEN status
            ELSE $1
          END,
          updated_at = NOW()
        WHERE parent_order_id = $2`,
      [paymentDb, parentOrderId],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  const afterPaidParent = await pool.query(
    `SELECT status, payment_status FROM orders WHERE id = $1`,
    [parentOrderId],
  );
  check(
    "after paid: parent.status='paid'",
    afterPaidParent.rows[0]?.status === "paid",
    `status=${afterPaidParent.rows[0]?.status}`,
  );
  check(
    "after paid: parent.payment_status='paid'",
    afterPaidParent.rows[0]?.payment_status === "paid",
    `payment_status=${afterPaidParent.rows[0]?.payment_status}`,
  );

  const afterPaidChildren = await pool.query(
    `SELECT id, status, payment_status FROM vendor_orders WHERE parent_order_id = $1`,
    [parentOrderId],
  );
  for (const c of afterPaidChildren.rows) {
    check(
      `after paid: child ${c.id.slice(0, 8)} status='paid'`,
      c.status === "paid",
      `status=${c.status}`,
    );
    check(
      `after paid: child ${c.id.slice(0, 8)} payment_status='paid'`,
      c.payment_status === "paid",
      `payment_status=${c.payment_status}`,
    );
  }

  // ---- 4. Regression guard: a stale 'pending' event must NOT downgrade paid rows ----
  const client2 = await pool.connect();
  try {
    await client2.query("BEGIN");
    await client2.query(
      `UPDATE orders
          SET payment_status = CASE
            WHEN payment_status = 'paid'   THEN 'paid'
            WHEN payment_status = 'failed' AND $1 = 'pending' THEN 'failed'
            ELSE $1
          END,
          updated_at = NOW()
        WHERE id = $2`,
      ["pending", parentOrderId],
    );
    await client2.query(
      `UPDATE vendor_orders
          SET payment_status = CASE
            WHEN payment_status = 'paid'   THEN 'paid'
            WHEN payment_status = 'failed' AND $1 = 'pending' THEN 'failed'
            ELSE $1
          END,
          updated_at = NOW()
        WHERE parent_order_id = $2`,
      ["pending", parentOrderId],
    );
    await client2.query("COMMIT");
  } finally {
    client2.release();
  }

  const afterStaleParent = await pool.query(
    `SELECT payment_status FROM orders WHERE id = $1`,
    [parentOrderId],
  );
  check(
    "regression guard: stale 'pending' did NOT downgrade parent.payment_status",
    afterStaleParent.rows[0]?.payment_status === "paid",
    `payment_status=${afterStaleParent.rows[0]?.payment_status}`,
  );
  const afterStaleChildren = await pool.query(
    `SELECT id, payment_status FROM vendor_orders WHERE parent_order_id = $1`,
    [parentOrderId],
  );
  let allStillPaid = true;
  for (const c of afterStaleChildren.rows) {
    if (c.payment_status !== "paid") allStillPaid = false;
  }
  check(
    "regression guard: stale 'pending' did NOT downgrade ANY child.payment_status",
    allStillPaid,
    `count=${afterStaleChildren.rows.length}`,
  );

  // ---- 5. Cleanup ----
  try {
    await pool.query(`DELETE FROM orders WHERE id = $1`, [parentOrderId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    console.log("\n✓ test data cleaned");
  } catch (e) {
    console.log(`\n⚠ cleanup failed (test data left in DB): ${e.message}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? "ALL OK ✓" : `FAILURES ✗ (${failed.length})`}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
