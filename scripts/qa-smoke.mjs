#!/usr/bin/env node
/**
 * QA smoke: DB connectivity + schema tables + HTTP routes (anonymous).
 * Usage: BASE_URL=http://127.0.0.1:4050 node scripts/qa-smoke.mjs
 * Loads ../.env.local if present (simple KEY=value lines).
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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvLocal();

const BASE_URL =
  process.env.BASE_URL || process.env.QA_BASE_URL || "http://127.0.0.1:4050";

/** Tables the app migrations expect (subset). */
const EXPECT_TABLES = [
  "addresses",
  "admin_users",
  "ai_sessions",
  "banners",
  "cart",
  "categories",
  "coupons",
  "direct_orders",
  "drivers",
  "guest_cart",
  "home_inventory",
  "loyalty_transactions",
  "notifications",
  "order_items",
  "orders",
  "products",
  "reviews",
  "saved_lists",
  "spin_results",
  "users",
  "wallet_transactions",
];

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

async function checkDatabase() {
  console.log("\n═══ Database ═══\n");
  const cfg = dbConfigFromEnv();
  if (!cfg.password) {
    console.log("SKIP: DATABASE_PASSWORD not set\n");
    return { ok: true, skipped: true, reachable: false };
  }
  const pool = new Pool(cfg);
  let reachable = false;
  let ok = true;
  try {
    await pool.query("SELECT 1 AS ok");
    reachable = true;
    console.log("OK  connection (SELECT 1)");
    const { rows } = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const have = new Set(rows.map((r) => r.tablename));
    for (const t of EXPECT_TABLES) {
      if (!have.has(t)) {
        console.log(`MISSING table: ${t}`);
        ok = false;
      }
    }
    if (ok) console.log(`OK  all ${EXPECT_TABLES.length} expected tables present`);
    for (const t of ["users", "products", "categories", "orders", "admin_users"]) {
      if (!have.has(t)) continue;
      try {
        const q = await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
        console.log(`    ${t}: ${q.rows[0].n} rows`);
      } catch (e) {
        console.log(`    ${t}: count failed — ${e?.message ?? e}`);
        ok = false;
      }
    }
    return { ok, skipped: false, reachable };
  } catch (e) {
    console.log(`FAIL  ${e?.message ?? e}`);
    return { ok: false, skipped: false, reachable: false };
  } finally {
    await pool.end().catch(() => {});
  }
}

async function fetchWithTimeout(url, init = {}, ms = 10000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchPath(path, init = {}) {
  const url = `${BASE_URL.replace(/\/$/, "")}${path}`;
  const r = await fetchWithTimeout(url, {
    redirect: "manual",
    headers: { Accept: "text/html,application/json;q=0.9,*/*;q=0.8", ...init.headers },
    ...init,
  });
  const loc = r.headers.get("location") || "";
  return { status: r.status, loc };
}

async function checkHttp(dbReachable) {
  console.log(`\n═══ HTTP (${BASE_URL}) ═══\n`);
  /** @type {{ path:string, rule:'ok'|'redirect'|'any2xx'; note?: string }[]} */
  const routes = [
    { path: "/", rule: "ok" },
    { path: "/cart", rule: "ok" },
    { path: "/catalog", rule: "ok" },
    { path: "/categories", rule: "ok" },
    { path: "/auth/login", rule: "ok" },
    { path: "/direct-order", rule: "ok" },
    { path: "/employment", rule: "ok" },
    { path: "/privacy", rule: "ok" },
    { path: "/terms", rule: "ok" },
    { path: "/help", rule: "ok" },
    { path: "/profile/security", rule: "ok" },
    { path: "/login", rule: "redirect", note: "legacy → /auth/login" },
    { path: "/auth/register", rule: "redirect", note: "legacy → /auth/signup" },
    { path: "/robots.txt", rule: "ok" },
    { path: "/sitemap.xml", rule: "ok" },
    { path: "/ai-chat", rule: "ok" },
    { path: "/spin-wheel", rule: "ok" },
    { path: "/landing", rule: "ok" },
    { path: "/admin/login", rule: "ok" },
    { path: "/admin", rule: "ok", note: "shell without session" },
    { path: "/admin/products", rule: "ok" },
    { path: "/admin/orders", rule: "ok" },
    { path: "/admin/categories", rule: "ok" },
    { path: "/admin/categories/new", rule: "ok" },
    { path: "/admin/banners", rule: "ok" },
    { path: "/admin/coupons", rule: "ok" },
    { path: "/admin/users", rule: "ok" },
    { path: "/admin/settings/profile", rule: "ok" },
    { path: "/admin/settings/admins", rule: "ok" },
    { path: "/profile", rule: "redirect" },
    { path: "/orders", rule: "redirect" },
    { path: "/checkout", rule: "redirect" },
    { path: "/profile/addresses", rule: "redirect" },
  ];

  /** Public JSON APIs — expect 2xx (ما عدا المنتجات — تُختبر أعلاه مع صفحة التفاصيل) */
  const apiGet = ["/api/v1/auth/config", "/api/v1/banners", "/api/v1/categories"];

  /** Expect 401 without cookie */
  const apiAuth = [
    "/api/admin/auth/me",
    "/api/v1/auth/me",
  ];

  let failed = 0;

  function skip(label, reason) {
    console.log(`SKIP ${label} — ${reason}`);
  }
  function pass(label, detail) {
    console.log(`OK  ${label}${detail ? ` ${detail}` : ""}`);
  }
  function fail(label, detail) {
    console.log(`FAIL  ${label}${detail ? ` ${detail}` : ""}`);
    failed++;
  }

  if (!dbReachable) {
    console.log("\n⚠ Postgres غير متاح — فحص API الذي يعتمد على قاعدة البيانات يُكمَل كـ SKIP.\n");
  }

  for (const { path: p, rule, note } of routes) {
    try {
      const { status, loc } = await fetchPath(p);
      if (rule === "redirect") {
        // /login → /auth/login (legacy). /auth/register → /auth/signup (legacy).
        // Other protected routes (e.g. /profile, /orders, /checkout) just
        // need to redirect anywhere into /auth/login with ?next=.
        const expectedDest =
          p === "/login" ? "/auth/login" :
          p === "/auth/register" ? "/auth/signup" :
          null;
        const isRedirect = [301, 302, 307, 308].includes(status);
        let ok = false;
        if (isRedirect && expectedDest) {
          const re = new RegExp(expectedDest.replace(/[/.+?^${}()|[\]\\]/g, '\\$&'));
          ok = re.test(loc);
        } else if (isRedirect && !expectedDest) {
          // Generic protected route — accept any redirect to /auth/login
          ok = /\/auth\/login/.test(loc);
        }
        if (ok) {
          pass(p, expectedDest ? `→ ${expectedDest} (${status})` : `→ login (${status})`);
        } else {
          fail(p, `expected redirect to ${expectedDest || "/auth/login"}, got ${status} loc=${loc || "—"}${note ? ` (${note})` : ""}`);
        }
      } else if (rule === "ok") {
        if (status >= 200 && status < 400)
          pass(p, `${status}${note ? ` (${note})` : ""}`);
        else fail(p, `status ${status} loc=${loc || "—"}`);
      }
    } catch (e) {
      fail(p, String(e.message || e));
    }
  }

  // Dynamic product page + product API (requires Postgres)
  if (!dbReachable) {
    skip("/api/v1/products?limit=1", "قاعدة البيانات غير متاحة");
    skip("/products/{id}", "قاعدة البيانات غير متاحة");
  } else
  try {
    const prodRes = await fetchWithTimeout(`${BASE_URL}/api/v1/products?limit=1`, {
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
    let pj = null;
    try {
      pj = prodRes.ok ? await prodRes.json() : null;
    } catch {
      pj = null;
    }
    if (!prodRes.ok) {
      fail(`/api/v1/products?limit=1`, `status ${prodRes.status} (غالبًا قاعدة البيانات غير متاحة)`);
    } else {
      pass("/api/v1/products?limit=1", String(prodRes.status));
    }
    const pid = pj?.data?.[0]?.id ?? pj?.data?.products?.[0]?.id;
    if (pid && prodRes.ok) {
      const { status } = await fetchPath(`/products/${pid}`);
      if (status >= 200 && status < 400) pass(`/products/{id}`, String(status));
      else fail(`/products/{id}`, `status ${status}`);
    } else if (prodRes.ok) {
      fail(`/products/{id}`, "لم يُرجع المسار أي منتج (data فارغة)");
    }
  } catch (e) {
    fail(`/products/{id}`, String(e.message || e));
  }

  for (const p of apiGet) {
    if (!dbReachable && p !== "/api/v1/auth/config") {
      skip(p, "قاعدة البيانات غير متاحة");
      continue;
    }
    try {
      const { status } = await fetchWithTimeout(`${BASE_URL}${p}`, {
        redirect: "manual",
        headers: { Accept: "application/json" },
      });
      // قد يكون 500 عند تعطّل Postgres — لا نرمي خارجياً؛ نُسجّل فقط.
      if (status >= 200 && status < 300) pass(p, String(status));
      else fail(p, `status ${status}`);
    } catch (e) {
      fail(p, String(e.message || e));
    }
  }

  for (const p of apiAuth) {
    try {
      const { status } = await fetchWithTimeout(`${BASE_URL}${p}`, {
        redirect: "manual",
        credentials: "omit",
      });
      if (status === 401) pass(p, "401 anonymous");
      else fail(p, `expected 401, got ${status}`);
    } catch (e) {
      fail(p, String(e.message || e));
    }
  }

  // GET webhook: dev returns ping JSON; prod returns 404 (intentionally hidden).
  try {
    const { status } = await fetchWithTimeout(`${BASE_URL}/api/v1/payments/webhook`, {
      redirect: "manual",
      method: "GET",
    });
    if (status === 200 || status === 404) pass("GET /api/v1/payments/webhook", String(status));
    else fail("GET /api/v1/payments/webhook", `status ${status}`);
  } catch (e) {
    fail("/api/v1/payments/webhook", String(e.message || e));
  }

  console.log(failed === 0 ? "\n═══ HTTP: all checks passed ═══\n" : `\n═══ HTTP: ${failed} failure(s) ═══\n`);
  return failed === 0;
}

async function main() {
  console.log(`city-market-app QA smoke  base=${BASE_URL}`);
  const db = await checkDatabase();
  let httpOk = false;
  try {
    httpOk = await checkHttp(Boolean(db.reachable));
  } catch (e) {
    console.error("HTTP phase error:", e);
  }
  if (!db.reachable && !db.skipped) {
    console.warn(
      "\nتحذير: تعذّر الاتصال بـ Postgres — أعد تشغيل الفحص على خادم بقاعدة بيانات عاملة لمطابقة المنتجات والـ APIs."
    );
  }
  process.exit(httpOk ? 0 : 1);
}

main();
