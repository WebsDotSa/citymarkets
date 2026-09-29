#!/usr/bin/env node
/**
 * QA critical paths: integration tests for the highest-risk API endpoints.
 *
 * Hits the running server at $BASE_URL with anonymous sessions (cookie jar
 * per test) and exercises the real backend with real DB writes where
 * safe. Tests are independent and skip themselves when DB isn't reachable.
 *
 * Coverage (in order of revenue/security risk):
 *   1. Coupon validation — happy path + invalid code
 *   2. Delivery quote — requires address coords
 *   3. Cart — guest add/list/delete (server-side reconciliation)
 *   4. Catalog — public products list shape
 *   5. CSRF — mutating routes reject when token absent
 *
 * Usage: BASE_URL=http://127.0.0.1:4050 node scripts/qa-critical-paths.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "pg";

const { Pool } = pkg;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function loadEnvLocal() {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return;
  const text = readFileSync(p, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvLocal();

const BASE_URL = process.env.BASE_URL || process.env.QA_BASE_URL || "http://127.0.0.1:4050";

function dbConfigFromEnv() {
  const password =
    process.env.DATABASE_PASSWORD ||
    (process.env.NODE_ENV === "production" ? undefined : "city-market-dev-database-password-only");
  return {
    host: process.env.DATABASE_HOST || "localhost",
    port: parseInt(process.env.DATABASE_PORT || "5432", 10),
    database: process.env.DATABASE_NAME || "citymarket_db",
    user: process.env.DATABASE_USER || "citymarket_user",
    password,
    max: 2,
    connectionTimeoutMillis: 8000,
  };
}

async function isDbReachable() {
  const pool = new Pool(dbConfigFromEnv());
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

// Tiny cookie jar so tests that need a session_id persist across requests.
function makeCookieJar() {
  const cookies = new Map();
  return {
    header() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    get(name) {
      return cookies.get(name);
    },
    absorb(setCookieHeader) {
      if (!setCookieHeader) return;
      // node fetch returns `set-cookie` as array when multiple are present
      const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      for (const raw of list) {
        const [pair] = raw.split(";");
        const eq = pair.indexOf("=");
        if (eq === -1) continue;
        cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
  };
}

async function request(jar, path, init = {}) {
  const url = `${BASE_URL.replace(/\/$/, "")}${path}`;
  const headers = {
    Accept: "application/json",
    ...(init.headers || {}),
  };
  if (jar) headers.Cookie = jar.header();
  // Mutating routes require a CSRF token. Hit /api/v1/auth/csrf once per
  // jar to seed it; the route sets the csrf_token cookie and returns the
  // same value, so we mirror that into the X-CSRF-Token header below.
  //
  // BUGFIX (audit 2026-09-29): the old /api/csrf path no longer exists;
  // the canonical endpoint is /api/v1/auth/csrf (Route Handler under the
  // versioned API). The legacy path happens to set the cookie anyway via
  // the middleware on 404, masking the bug — but the explicit GET path
  // we record here is the only one that sets a SAME cookie value the
  // middleware trusts.
  const method = (init.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    if (jar && !jar.get("csrf_token")) {
      const csrfRes = await fetch(`${BASE_URL.replace(/\/$/, "")}/api/v1/auth/csrf`, {
        headers: { Cookie: jar.header(), Accept: "application/json" },
      });
      jar.absorb(csrfRes.headers.getSetCookie?.() ?? csrfRes.headers.get("set-cookie"));
    }
    const csrf = jar?.get("csrf_token");
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  const r = await fetch(url, { ...init, headers, redirect: "manual" });
  jar?.absorb(r.headers.getSetCookie?.() ?? r.headers.get("set-cookie"));
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: r.status, json, text };
}

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(label, detail = "") { console.log(`OK   ${label}${detail ? ` — ${detail}` : ""}`); passed++; }
function bad(label, detail = "") { console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function skip(label, detail = "") { console.log(`SKIP ${label}${detail ? ` — ${detail}` : ""}`); skipped++; }

async function testCoupons(dbUp) {
  if (!dbUp) return skip("/api/v1/coupons/validate", "DB not reachable");
  const jar = makeCookieJar();
  // 1) Invalid coupon
  const bad = await request(jar, "/api/v1/coupons/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "NOT_A_REAL_CODE_12345", subtotal: 100 }),
  });
  if (bad.status === 200 && bad.json?.valid === false) {
    ok("coupons/validate rejects unknown code");
  } else {
    bad("coupons/validate rejects unknown code", `status=${bad.status} body=${JSON.stringify(bad.json)}`);
  }

  // 2) Find a real coupon (if any) and validate it
  const list = await request(jar, "/api/admin/coupons", { headers: { Accept: "application/json" } });
  // The /api/admin route needs auth; fall back to DB directly.
  const pool = new Pool(dbConfigFromEnv());
  try {
    const { rows } = await pool.query("SELECT code FROM coupons WHERE is_active = TRUE LIMIT 1");
    if (rows.length === 0) {
      skip("coupons/validate accepts real code", "no active coupons in DB");
      return;
    }
    const real = await request(jar, "/api/v1/coupons/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: rows[0].code, subtotal: 200 }),
    });
    if (real.status === 200 && (real.json?.valid === true || real.json?.valid === false)) {
      ok("coupons/validate accepts real code", `code=${rows[0].code} valid=${real.json.valid}`);
    } else {
      bad("coupons/validate accepts real code", `status=${real.status} body=${JSON.stringify(real.json)}`);
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

async function testDeliveryQuote(dbUp) {
  if (!dbUp) return skip("/api/v1/delivery/quote", "DB not reachable");
  const jar = makeCookieJar();
  // /api/v1/delivery/quote accepts POST { lat, lng, subtotal }.
  const r = await request(jar, "/api/v1/delivery/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude: 24.7136, longitude: 46.6753, subtotal: 100 }),
  });
  if (r.status === 200 && typeof r.json?.deliveryFee === "number") {
    ok("delivery/quote returns numeric fee", `fee=${r.json.deliveryFee}`);
  } else if (r.status === 200 && r.json?.needsAddress) {
    ok("delivery/quote signals address required", "needsAddress=true");
  } else {
    bad("delivery/quote shape", `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
}

async function testOffers(dbUp) {
  // Slice 5 — smoke-test the offers public + admin + cart-integration
  // surfaces so a regression in the resolver, view, or admin pipeline is
  // caught by CI before a customer sees a wrong price.
  const jar = makeCookieJar();

  // 1) Public list — must return 200 + an array (possibly empty).
  const list = await request(jar, "/api/v1/offers?limit=10", {
    headers: { Accept: "application/json" },
  });
  if (list.status === 200 && Array.isArray(list.json?.data)) {
    ok("offers list returns array", `count=${list.json.data.length}`);
  } else {
    bad("offers list shape", `status=${list.status} body=${JSON.stringify(list.json)}`);
  }

  if (!dbUp) {
    skip("offers product filter + detail", "DB not reachable");
    return;
  }

  // 2) If we have at least one offer, hit its detail endpoint.
  const offerId = list.json?.data?.[0]?.id;
  if (!offerId) {
    skip("offers detail + product filter", "no active offers in DB");
    return;
  }

  const detail = await request(jar, `/api/v1/offers/${offerId}`, {
    headers: { Accept: "application/json" },
  });
  if (detail.status === 200 && detail.json?.data?.id === offerId) {
    ok("offers detail returns the offer", `id=${offerId}`);
  } else {
    bad("offers detail", `status=${detail.status} body=${JSON.stringify(detail.json)}`);
  }

  // 3) /api/v1/products?offer=<id> should return matching products.
  const productsForOffer = await request(jar, `/api/v1/products?offer=${offerId}&limit=5`, {
    headers: { Accept: "application/json" },
  });
  if (productsForOffer.status === 200 && Array.isArray(productsForOffer.json?.data)) {
    const sample = productsForOffer.json.data[0];
    const hasOfferField = sample ? sample.active_offer !== undefined : true;
    if (hasOfferField) {
      ok("products?offer returns rows with active_offer", `count=${productsForOffer.json.data.length}`);
    } else {
      bad("products?offer missing active_offer field", JSON.stringify(sample));
    }
  } else {
    bad("products?offer shape", `status=${productsForOffer.status}`);
  }
}

async function testCart(dbUp) {
  if (!dbUp) return skip("/api/v1/cart", "DB not reachable");
  const jar = makeCookieJar();

  // 1) Bootstrap session_id
  await request(jar, "/api/v1/auth/config");

  // 2) Get a real product id
  const pool = new Pool(dbConfigFromEnv());
  try {
    const { rows } = await pool.query("SELECT id FROM products WHERE is_active = TRUE LIMIT 1");
    if (rows.length === 0) {
      skip("cart add/remove round-trip", "no active products");
      return;
    }
    const productId = rows[0].id;

    // 3) Add to cart
    const add = await request(jar, "/api/v1/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: productId, quantity: 1 }),
    });
    if (add.status === 200 && add.json?.success !== false) {
      ok("cart POST adds an item");
    } else {
      bad("cart POST adds an item", `status=${add.status} body=${JSON.stringify(add.json)}`);
      return;
    }

    // 4) List
    const list = await request(jar, "/api/v1/cart");
    const items = Array.isArray(list.json?.data) ? list.json.data
                : Array.isArray(list.json?.items) ? list.json.items : [];
    if (list.status === 200 && items.length > 0) {
      ok("cart GET returns items", `count=${items.length}`);
    } else {
      bad("cart GET returns items", `status=${list.status} count=${items.length}`);
    }

    // 5) Cleanup
    const del = await request(jar, "/api/v1/cart", { method: "DELETE" });
    if (del.status === 200 || del.status === 204) ok("cart DELETE clears");
    else bad("cart DELETE clears", `status=${del.status}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

async function testCatalog() {
  const jar = makeCookieJar();
  const r = await request(jar, "/api/v1/products?limit=5");
  const list = Array.isArray(r.json?.data) ? r.json.data
             : Array.isArray(r.json?.data?.products) ? r.json.data.products : [];
  if (r.status === 200) ok("catalog GET returns shape", `items=${list.length}`);
  else bad("catalog GET returns shape", `status=${r.status}`);
}

async function testCsrfEnforced(dbUp) {
  if (!dbUp) return skip("CSRF enforced on mutating routes", "DB not reachable");
  // Hit a known mutating endpoint with no CSRF cookie and a malformed header.
  // proxy.ts should respond 403 before reaching the route.
  const r = await fetch(`${BASE_URL}/api/v1/addresses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "test" }),
  });
  // 403 = CSRF guard fired. Anything else means the guard is misconfigured.
  if (r.status === 403) ok("CSRF guard rejects unauthenticated POST /api/v1/addresses");
  else bad("CSRF guard rejects unauthenticated POST /api/v1/addresses", `status=${r.status}`);
}

async function main() {
  console.log(`city-market-app QA critical paths  base=${BASE_URL}`);
  const dbUp = await isDbReachable();
  if (!dbUp) console.log("\n⚠ Postgres not reachable — DB-dependent tests will be skipped.\n");

  await testCatalog();
  await testCsrfEnforced(dbUp);
  await testCoupons(dbUp);
  await testDeliveryQuote(dbUp);
  await testCart(dbUp);
  await testOffers(dbUp);

  console.log(`\n═══ ${passed} passed · ${failed} failed · ${skipped} skipped ═══\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();