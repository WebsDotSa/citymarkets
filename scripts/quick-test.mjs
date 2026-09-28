import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SignJWT } from "jose";
import { execSync } from "node:child_process";

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

const phone = "+966599999991";
psql(`INSERT INTO users (id, phone, name, loyalty_points, loyalty_tier) VALUES (gen_random_uuid(), '${phone}', 'Test', 0, 'bronze') ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name;`);
const userId = psql(`SELECT id FROM users WHERE phone = '${phone}' LIMIT 1;`);
psql(`INSERT INTO addresses (user_id, label, address_text, lat, lng, is_default) VALUES ('${userId}', 'Home', 'Riyadh', 24.7136, 46.6753, true) ON CONFLICT DO NOTHING;`);
const addressId = psql(`SELECT id::text FROM addresses WHERE user_id = '${userId}' ORDER BY is_default DESC LIMIT 1;`);
const productId = psql(`SELECT id::text FROM vendor_products WHERE stock_quantity > 0 AND is_active = true LIMIT 1;`);

const secretBytes = new TextEncoder().encode(process.env.JWT_SECRET);
const token = await new SignJWT({ userId, phone })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setIssuer("citymarket-customer")
  .setAudience("citymarket-customer-api")
  .setSubject(userId)
  .setExpirationTime("1h")
  .sign(secretBytes);

const cookieH = `customer_session=${token}; csrf_token=${csrf}`;
const headers = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "x-csrf-token": csrf,
  Cookie: cookieH,
};

console.log("userId:", userId);
console.log("productId:", productId);
console.log("addressId:", addressId);

const meRes = await fetch("http://127.0.0.1:3005/api/v1/auth/me", { headers });
console.log("\n=== /api/v1/auth/me ===");
console.log("HTTP:", meRes.status);
console.log("body:", (await meRes.text()).slice(0, 200));

const cartRes = await fetch("http://127.0.0.1:3005/api/v1/cart", {
  method: "POST", headers,
  body: JSON.stringify({ productId: productId.replace(/-/g, "").slice(0, 12), quantity: 1 }),
});
console.log("\n=== /api/v1/cart POST ===");
console.log("HTTP:", cartRes.status);
console.log("body:", (await cartRes.text()).slice(0, 200));

const orderRes = await fetch("http://127.0.0.1:3005/api/v1/checkout", {
  method: "POST", headers,
  body: JSON.stringify({
    items: [{ product_id: productId, quantity: 1 }],
    vendor_groups: [],
    delivery_type: "delivery",
    address_id: addressId,
    payment_method: "cash",
    idempotency_key: crypto.randomUUID(),
    guestInfo: { name: "Test", phone, email: "t@t.com" },
  }),
});
console.log("\n=== /api/v1/checkout (cash) ===");
console.log("HTTP:", orderRes.status);
console.log("body:", (await orderRes.text()).slice(0, 400));
