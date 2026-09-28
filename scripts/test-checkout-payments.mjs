import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SignJWT } from "jose";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const ROOT = "/var/www/citymarkets.sa/city-market-app";
function loadEnv() {
  const p = join(ROOT, ".env.local");
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
const DB_PASS = process.env.DATABASE_PASSWORD || "city-market-dev-database-password-only";
function psql(sql) {
  const safe = sql.replace(/"/g, '\\"');
  return execSync(`PGPASSWORD='${DB_PASS}' psql -h 127.0.0.1 -U citymarket_user -d citymarket_db -t -A -c "${safe}"`, { encoding: "utf8" }).trim();
}

const initRes = await fetch("http://127.0.0.1:3005/", { redirect: "manual" });
const cookies = initRes.headers.getSetCookie ? initRes.headers.getSetCookie() : [];
let csrf = "";
for (const c of cookies) {
  const [pair] = c.split(";");
  const [k, v] = pair.split("=");
  if (k === "csrf_token" || k === "x-csrf-token") csrf = v;
}

async function signCustomer(userId, phone) {
  return await new SignJWT({ userId, phone })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("citymarket-customer")
    .setAudience("citymarket-customer-api")
    .setSubject(userId)
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
}

const productRow = psql(`SELECT id::text, vendor_id::text FROM vendor_products WHERE stock_quantity > 0 AND is_active = true LIMIT 1;`);
const [productId, vendorId] = productRow.split("|");
const CITY_VENDOR = psql(`SELECT id::text FROM vendors WHERE slug = 'city-markets' LIMIT 1;`);
const vId = vendorId || CITY_VENDOR;
console.log(`Product: ${productId}, Vendor: ${vId}\n`);

const METHODS = ["mada", "cash", "tamara"];
let allOk = true;
let i = 0;
for (const method of METHODS) {
  i++;
  const phone = `+96659988800${i}`;
  psql(`INSERT INTO users (id, phone, name, loyalty_points, loyalty_tier) VALUES (gen_random_uuid(), '${phone}', 'Test${i}', 0, 'bronze') ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name;`);
  const userId = psql(`SELECT id FROM users WHERE phone = '${phone}' LIMIT 1;`);
  psql(`INSERT INTO addresses (user_id, label, address_text, lat, lng, is_default) VALUES ('${userId}', 'Home', 'Riyadh', 24.7136, 46.6753, true) ON CONFLICT DO NOTHING;`);
  const addressId = psql(`SELECT id::text FROM addresses WHERE user_id = '${userId}' ORDER BY is_default DESC LIMIT 1;`);
  psql(`DELETE FROM cart WHERE user_id = '${userId}';`);
  psql(`INSERT INTO cart (user_id, product_id, vendor_id, quantity) VALUES ('${userId}', '${productId}', '${vId}', 1);`);

  const token = await signCustomer(userId, phone);
  const orderRes = await fetch("http://127.0.0.1:3005/api/v1/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-csrf-token": csrf,
      Cookie: `customer_session=${token}; csrf_token=${csrf}`,
    },
    body: JSON.stringify({
      items: [{ product_id: productId, quantity: 1 }],
      vendor_groups: [],
      delivery_type: "delivery",
      address_id: addressId,
      payment_method: method,
      idempotency_key: randomUUID(),
      guestInfo: { name: `Test${i}`, phone, email: `t${i}@t.com` },
    }),
  });

  const json = await orderRes.json();
  const success = orderRes.status === 200 && json?.success === true;
  const dbErr = json?.debug?.includes("violates") || json?.debug?.includes("queryOne");
  const mark = success && !dbErr ? "✓" : "✗";
  if (!success || dbErr) allOk = false;
  const url = json?.payment_url ? ` url=${json.payment_url.slice(0, 60)}` : "";
  const dbg = json?.debug ? ` [DBG: ${json.debug.slice(0, 80)}]` : "";
  console.log(`${mark} [${method.padEnd(11)}] HTTP=${orderRes.status} success=${json?.success}${url}${dbg} err="${(json?.error || "").slice(0, 60)}"`);
}

console.log(`\n${allOk ? "ALL OK ✓" : "FAILURES ✗"}\n`);
process.exit(allOk ? 0 : 1);
