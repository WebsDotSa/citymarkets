#!/usr/bin/env node
/**
 * Smoke test for ALL admin dashboard pages + their underlying APIs.
 * Run after `docker compose up -d` is healthy.
 *
 * Usage: ADMIN_PASSWORD=xxx node scripts/smoke-admin-pages.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3005";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@citymarkets.sa";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error("Set ADMIN_PASSWORD env var");
  process.exit(1);
}

// Load .env.local
if (existsSync(join(ROOT, ".env.local"))) {
  for (const raw of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

const cookieJar = new Map();
function cookieHeader() { return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
function captureSetCookie(res) {
  const all = res.headers.getSetCookie?.() || [];
  for (const sc of all) {
    const [pair] = sc.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookieJar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function http(method, path, { body, headers = {} } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { ...headers, cookie: cookieHeader() },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  captureSetCookie(res);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json, text };
}

const results = [];
function pass(n) { results.push({ ok: true, n }); console.log(`  ✓ ${n}`); }
function fail(n, e) { results.push({ ok: false, n, e }); console.error(`  ✗ ${n}\n      ${e}`); }

async function main() {
  console.log(`Smoke testing admin pages against ${BASE_URL} as ${ADMIN_EMAIL}\n`);

  // Bootstrap CSRF
  const csrfInit = await http("GET", "/api/v1/products?limit=1");
  const csrfToken = cookieJar.get("csrf_token") || cookieJar.get("csrf-token");
  if (!csrfToken) { fail("CSRF bootstrap", "no token"); process.exit(1); }
  pass("CSRF token");

  // Login
  const login = await http("POST", "/api/admin/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    headers: { "x-csrf-token": csrfToken },
  });
  if (login.status !== 200) { fail("admin login", `${login.status} ${login.text.slice(0, 200)}`); process.exit(1); }
  pass("admin login");

  // Pages to test
  const pages = [
    "/admin",
    "/admin/activity",
    "/admin/analytics",
    "/admin/banners",
    "/admin/categories",
    "/admin/coupons",
    "/admin/delivery-settings",
    "/admin/employment",
    "/admin/inventory",
    "/admin/loyalty",
    "/admin/notifications",
    "/admin/offers",
    "/admin/orders",
    "/admin/orders/direct",
    "/admin/payments",
    "/admin/products",
    "/admin/reviews",
    "/admin/settings",
    "/admin/settings/admins",
    "/admin/settings/notifications",
    "/admin/settings/payments",
    "/admin/settings/profile",
    "/admin/settings/store-status",
    "/admin/stores",
    "/admin/users",
    "/admin/vendor-applications",
    "/admin/vendors",
    "/admin/vendors/analytics",
  ];

  console.log("\n[Admin pages]");
  for (const path of pages) {
    const r = await http("GET", path);
    // /admin redirects to /admin/dashboard, so accept 200/307
    if (r.status === 200) pass(path);
    else if (r.status === 307 || r.status === 308) pass(`${path} (redirect)`);
    else fail(path, `HTTP ${r.status} — ${r.text.slice(0, 150)}`);
  }

  console.log("\n[Admin APIs]");
  const apis = [
    "/api/admin/analytics",
    "/api/admin/banners",
    "/api/admin/categories",
    "/api/admin/coupons",
    "/api/admin/delivery-settings",
    "/api/admin/employment",
    "/api/admin/inventory",
    "/api/admin/loyalty",
    "/api/admin/notifications",
    "/api/admin/offers",
    "/api/admin/offers/targets",
    "/api/admin/orders",
    "/api/admin/orders/direct",
    "/api/admin/payments",
    "/api/admin/products",
    "/api/admin/reviews",
    "/api/admin/settings/notifications",
    "/api/admin/settings/payments",
    "/api/admin/settings/store-status",
    "/api/admin/stores",
    "/api/admin/users",
    "/api/admin/vendor-applications",
    "/api/admin/vendors",
    "/api/admin/abandoned-carts",
    "/api/admin/admin-users",
    "/api/admin/auth/me",
    "/api/admin/activity",
  ];
  for (const path of apis) {
    const r = await http("GET", path);
    if (r.status === 200) pass(path);
    else fail(path, `HTTP ${r.status} — ${r.text.slice(0, 200)}`);
  }

  console.log(`\n══════ ${results.filter(r => r.ok).length} passed, ${results.filter(r => !r.ok).length} failed ══════`);
  process.exit(results.some(r => !r.ok) ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
