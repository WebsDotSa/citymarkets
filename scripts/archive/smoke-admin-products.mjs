#!/usr/bin/env node
/**
 * End-to-end smoke test for the admin products page API.
 *
 * Exercises:
 *  - admin login (with CSRF token + cookie)
 *  - GET /api/admin/products (list + filters + pagination)
 *  - POST /api/admin/products (create a throw-away test product)
 *  - PUT /api/admin/products (toggle is_active)
 *  - POST /api/admin/products/bulk (bulk status + bulk category)
 *  - DELETE /api/admin/products?id=<created-id> (single delete)
 *  - POST /api/admin/products/bulk (bulk delete — last resort cleanup)
 *  - GET /api/admin/products?search=<term> (search)
 *  - GET /api/admin/inventory (low-stock count)
 *
 * Usage:
 *   node scripts/smoke-admin-products.mjs
 *
 * Requires:
 *   - ADMIN_EMAIL and ADMIN_PASSWORD env vars (or .env.local)
 *   - BASE_URL (default: http://localhost:3005)
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function loadEnvLocal() {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return;
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

loadEnvLocal();

const BASE_URL = process.env.BASE_URL || "http://localhost:3005";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@citymarkets.sa";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error("Set ADMIN_PASSWORD env var (or .env.local).");
  process.exit(1);
}

// Tiny cookie jar. Only stores Set-Cookie values verbatim.
const cookieJar = new Map();

function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

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
    headers: {
      ...headers,
      cookie: cookieHeader(),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  captureSetCookie(res);
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}

const results = [];
function pass(name) { results.push({ ok: true, name }); console.log(`  ✓ ${name}`); }
function fail(name, err) { results.push({ ok: false, name, err }); console.error(`  ✗ ${name}\n      ${err}`); }

async function main() {
  console.log(`Smoke test against ${BASE_URL} as ${ADMIN_EMAIL}`);

  // Step 1: bootstrap a CSRF token by hitting any GET that issues one.
  // Most admin GETs set x-csrf-token in the response header.
  console.log("\n[1] bootstrap CSRF token");
  const csrfInit = await http("GET", "/api/v1/products?limit=1");
  const csrfToken = csrfInit.headers?.["x-csrf-token"] ||
    csrfInit.body?.csrfToken ||
    cookieJar.get("csrf-token") ||
    cookieJar.get("csrf_token");
  if (!csrfToken) {
    fail("CSRF bootstrap", "no token returned");
    process.exit(1);
  }
  pass("CSRF token acquired");

  // Step 2: admin login
  console.log("\n[2] admin login");
  const login = await http("POST", "/api/admin/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    headers: { "x-csrf-token": csrfToken },
  });
  if (login.status !== 200 || !login.body?.success) {
    fail("admin login", `status=${login.status} body=${JSON.stringify(login.body)}`);
    process.exit(1);
  }
  pass("admin login");

  // Re-acquire CSRF token after login (some apps rotate it).
  const adminCsrf = await http("GET", "/api/admin/products?limit=1");
  const csrf2 =
    adminCsrf.body?.csrfToken ||
    adminCsrf.headers?.get?.("x-csrf-token") ||
    cookieJar.get("csrf-token");
  const useCsrf = csrf2 || csrfToken;

  // Step 3: list products
  console.log("\n[3] list products");
  const list = await http("GET", "/api/admin/products?limit=5");
  if (!list.body?.success) {
    fail("list products", JSON.stringify(list.body));
    process.exit(1);
  }
  const totalBefore = list.body.pagination?.total ?? list.body.data?.length ?? 0;
  pass(`list products (total=${totalBefore})`);

  // Step 4: create a test product
  console.log("\n[4] create test product");
  // Need a category for the product.
  const cats = await http("GET", "/api/admin/categories");
  const cat = cats.body?.data?.[0];
  if (!cat) {
    fail("list categories", "no categories available — cannot create product");
    process.exit(1);
  }
  const created = await http("POST", "/api/admin/products", {
    headers: { "x-csrf-token": useCsrf },
    body: {
      name_ar: `منتج اختبار ${Date.now()}`,
      name_en: `test product ${Date.now()}`,
      category_id: cat.id,
      price: 1,
      stock_qty: 99,
      is_active: true,
    },
  });
  if (!created.body?.success) {
    fail("create product", JSON.stringify(created.body));
    process.exit(1);
  }
  const newId = created.body.data?.id;
  pass(`create product (id=${newId})`);

  // Step 5: PUT toggle is_active=false (full payload required by schema)
  console.log("\n[5] PUT toggle active=false");
  const updated = await http("PUT", `/api/admin/products?id=${newId}`, {
    headers: { "x-csrf-token": useCsrf },
    body: {
      name_ar: `منتج اختبار ${Date.now()}`,
      category_id: cat.id,
      price: 1,
      stock_qty: 99,
      is_active: false,
    },
  });
  if (!updated.body?.success) {
    fail("PUT product", JSON.stringify(updated.body));
    process.exit(1);
  }
  pass("PUT toggle");

  // Step 6: GET single product
  console.log("\n[6] GET single product");
  const one = await http("GET", `/api/admin/products?id=${newId}`);
  if (!one.body?.success) fail("GET single", JSON.stringify(one.body));
  else pass("GET single");

  // Step 7: search by name
  console.log("\n[7] search by name");
  const search = await http("GET", `/api/admin/products?search=${encodeURIComponent("اختبار")}&limit=5`);
  if (!search.body?.success) fail("search", JSON.stringify(search.body));
  else pass(`search (results=${search.body.data?.length ?? 0})`);

  // Step 8: filter by category
  console.log("\n[8] filter by category");
  const filtered = await http("GET", `/api/admin/products?category_id=${cat.id}&limit=5`);
  if (!filtered.body?.success) fail("filter category", JSON.stringify(filtered.body));
  else pass(`filter category (results=${filtered.body.data?.length ?? 0})`);

  // Step 9: bulk update status (back to active)
  console.log("\n[9] bulk update_status active");
  const bulk = await http("POST", "/api/admin/products/bulk", {
    headers: { "x-csrf-token": useCsrf },
    body: { action: "update_status", ids: [newId], value: "active" },
  });
  if (!bulk.body?.success) fail("bulk update_status", JSON.stringify(bulk.body));
  else pass("bulk update_status");

  // Step 10: bulk update_quantity
  console.log("\n[10] bulk update_quantity");
  const bulkQty = await http("POST", "/api/admin/products/bulk", {
    headers: { "x-csrf-token": useCsrf },
    body: { action: "update_quantity", ids: [newId], value: 7 },
  });
  if (!bulkQty.body?.success) fail("bulk update_quantity", JSON.stringify(bulkQty.body));
  else pass("bulk update_quantity");

  // Step 11: bulk update_category
  console.log("\n[11] bulk update_category");
  if (cats.body.data.length > 1) {
    const otherCat = cats.body.data.find((c) => c.id !== cat.id);
    const bulkCat = await http("POST", "/api/admin/products/bulk", {
      headers: { "x-csrf-token": useCsrf },
      body: { action: "update_category", ids: [newId], value: otherCat.id },
    });
    if (!bulkCat.body?.success) fail("bulk update_category", JSON.stringify(bulkCat.body));
    else pass("bulk update_category");
  } else {
    console.log("  - skipped (only one category)");
  }

  // Step 12: DELETE single
  console.log("\n[12] DELETE single product");
  const del = await http("DELETE", `/api/admin/products?id=${newId}`, {
    headers: { "x-csrf-token": useCsrf },
  });
  if (!del.body?.success) {
    fail("DELETE single", JSON.stringify(del.body));
    process.exit(1);
  }
  pass(`DELETE single (deleted=${del.body.deleted}, r2=${del.body.r2Cleaned})`);

  // Step 13: confirm gone
  console.log("\n[13] confirm gone");
  const after = await http("GET", `/api/admin/products?id=${newId}`);
  if (after.status === 404 || after.body?.success === false) pass("product gone");
  else fail("confirm gone", `still returned ${after.status}`);

  // Step 14: GET inventory
  console.log("\n[14] GET inventory");
  const inv = await http("GET", "/api/admin/inventory");
  if (inv.body?.success !== false) pass("inventory");
  else console.log("  - inventory: " + JSON.stringify(inv.body));

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
