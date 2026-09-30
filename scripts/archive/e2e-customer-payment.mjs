#!/usr/bin/env node
/**
 * E2E: test user + cart + order (mada) + payment_url + orders list
 * Usage: node scripts/e2e-customer-payment.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = process.env.BASE_URL || "http://127.0.0.1:4041";
const COOKIE = "customer_session";

function loadEnv() {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) throw new Error("Missing .env.local");
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnv();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET missing");

const TEST_PHONE = process.env.E2E_TEST_PHONE || "0599888777";
const TEST_NAME = "عضو تجريبي QA";

function signToken(userId, phone) {
  return jwt.sign({ userId, phone }, JWT_SECRET, { expiresIn: "1h" });
}

async function api(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  const init = { method, headers, credentials: "include" };
  if (token) headers.Cookie = `${COOKIE}=${token}`;
  if (body) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

function ok(label, cond, detail = "") {
  const mark = cond ? "✓" : "✗";
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) process.exitCode = 1;
  return cond;
}

async function main() {
  console.log(`\nE2E customer payment @ ${BASE}\n`);

  const userId = randomUUID();
  const token = signToken(userId, TEST_PHONE);

  // DB setup via docker exec
  const { execSync } = await import("node:child_process");
  const upsertSql = `
    INSERT INTO users (id, phone, name, loyalty_points, loyalty_tier)
    VALUES ('${userId}', '${TEST_PHONE}', '${TEST_NAME}', 0, 'bronze')
    ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name;
  `;
  let dbUserId = userId;
  try {
    execSync(
      `docker exec citymarket-db psql -U citymarket_user -d citymarket_db -c "${upsertSql.replace(/\n/g, " ")}"`,
      { encoding: "utf8" }
    );
    const idOut = execSync(
      `docker exec citymarket-db psql -U citymarket_user -d citymarket_db -t -A -c "SELECT id FROM users WHERE phone = '${TEST_PHONE}' LIMIT 1;"`,
      { encoding: "utf8" }
    ).trim();
    if (idOut && /^[0-9a-f-]{36}$/i.test(idOut)) dbUserId = idOut;
  } catch (e) {
    console.warn("DB insert warn:", e.message);
  }

  const dbToken = signToken(dbUserId, TEST_PHONE);

  const productRes = execSync(
    `docker exec citymarket-db psql -U citymarket_user -d citymarket_db -t -A -c "SELECT id FROM products WHERE stock_qty > 0 AND is_active = true ORDER BY id LIMIT 1;"`,
    { encoding: "utf8" }
  ).trim();
  const productId = parseInt(productRes, 10);
  ok("product in stock", Number.isFinite(productId), `id=${productId}`);

  execSync(
    `docker exec citymarket-db psql -U citymarket_user -d citymarket_db -c "DELETE FROM cart WHERE user_id = '${dbUserId}';"`,
    { encoding: "utf8" }
  );

  const cartAdd = await api("/api/v1/cart", {
    method: "POST",
    token: dbToken,
    body: { productId, quantity: 1 },
  });
  ok("add to cart", cartAdd.status === 200 && cartAdd.json?.success !== false, String(cartAdd.status));

  const addrSql = `
    INSERT INTO addresses (user_id, label, address_text, lat, lng, is_default)
    VALUES ('${dbUserId}', 'منزل', 'الرياض - حي تجريبي - شارع الاختبار', 24.7136, 46.6753, true)
    ON CONFLICT DO NOTHING
    RETURNING id;
  `;
  let addressId;
  try {
    const addrOut = execSync(
      `docker exec citymarket-db psql -U citymarket_user -d citymarket_db -t -A -c "SELECT id FROM addresses WHERE user_id = '${dbUserId}' ORDER BY is_default DESC, id ASC LIMIT 1;"`,
      { encoding: "utf8" }
    ).trim();
    addressId = parseInt(addrOut, 10);
  } catch {
    /* */
  }
  if (!addressId) {
    execSync(
      `docker exec citymarket-db psql -U citymarket_user -d citymarket_db -c "INSERT INTO addresses (user_id, label, address_text, lat, lng, is_default) VALUES ('${dbUserId}', 'منزل', 'الرياض تجريبي', 24.7136, 46.6753, true);"`,
      { encoding: "utf8" }
    );
    addressId = parseInt(
      execSync(
        `docker exec citymarket-db psql -U citymarket_user -d citymarket_db -t -A -c "SELECT id FROM addresses WHERE user_id = '${dbUserId}' LIMIT 1;"`,
        { encoding: "utf8" }
      ).trim(),
      10
    );
  }
  ok("address ready", Number.isFinite(addressId), `id=${addressId}`);

  const orderRes = await api("/api/v1/orders", {
    method: "POST",
    token: dbToken,
    body: {
      address_id: addressId,
      payment_method: "mada",
      delivery_type: "delivery",
      notes: "اختبار QA آلي",
    },
  });

  const paymentUrl = orderRes.json?.payment_url;
  ok("create order 200", orderRes.status === 200, JSON.stringify(orderRes.json).slice(0, 200));
  ok("order success", orderRes.json?.success === true);
  ok(
    "payment_url present",
    typeof paymentUrl === "string" && paymentUrl.includes("moyasar"),
    paymentUrl || "missing"
  );

  const ordersList = await api("/api/v1/orders", { token: dbToken });
  ok("orders list 200", ordersList.status === 200);
  const list = ordersList.json?.data || ordersList.json?.orders || [];
  ok("orders array", Array.isArray(list) && list.length > 0, `count=${list.length}`);

  console.log("\nDone.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
