#!/usr/bin/env node
/**
 * E2E: admin vendor round-trip.
 *
 * Regression guard for the multi-vendor admin pipeline. Verifies that:
 *   1. An admin can POST a new vendor with logo_url (the field that the
 *      ImageUploader auto-populates — a regression here meant the
 *      upload widget rendered but the value never reached the API).
 *   2. The vendor appears in GET /api/admin/vendors with the same
 *      logo_url persisted.
 *   3. The public /vendors/<slug> storefront page renders the logo_url
 *      so customers actually see the uploaded image.
 *
 * Skipped by default to keep CI green until the test database is
 * seeded. Run with:
 *
 *     E2E_ADMIN_VENDORS=1 BASE_URL=http://localhost:4041 \
 *       ADMIN_EMAIL=admin@citymarkets.sa ADMIN_PASSWORD=... \
 *       node scripts/e2e-admin-vendors.mjs
 *
 * The script cleans up the vendor row it created, so re-running is
 * idempotent.
 *
 * Exits 0 on success, 1 on any assertion failure.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = process.env.BASE_URL || "http://127.0.0.1:4041";

function loadEnv() {
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

loadEnv();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@citymarkets.sa";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let passed = 0;
let failed = 0;
function ok(label, detail = "") {
  passed++;
  console.log(`OK   ${label}${detail ? ` — ${detail}` : ""}`);
}
function bad(label, detail = "") {
  failed++;
  console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Tiny cookie jar: the admin login endpoint sets HttpOnly cookies. */
function makeJar() {
  const cookies = new Map();
  return {
    capture(setCookieHeader) {
      if (!setCookieHeader) return;
      const parts = setCookieHeader.split(/,(?=[^ ])/);
      for (const raw of parts) {
        const semi = raw.indexOf(";");
        const kv = (semi === -1 ? raw : raw.slice(0, semi)).trim();
        const eq = kv.indexOf("=");
        if (eq === -1) continue;
        cookies.set(kv.slice(0, eq).trim(), kv.slice(eq + 1).trim());
      }
    },
    header() {
      if (cookies.size === 0) return "";
      return Array.from(cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    },
  };
}

async function request(jar, path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  const cookie = jar.header();
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // Capture every Set-Cookie the server emits (login, csrf, etc.).
  const setCookie = res.headers.getSetCookie?.();
  if (setCookie) {
    for (const c of setCookie) jar.capture(c);
  } else {
    const single = res.headers.get("set-cookie");
    if (single) jar.capture(single);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json, raw: text };
}

async function main() {
  if (!process.env.E2E_ADMIN_VENDORS) {
    console.log(
      "SKIP e2e-admin-vendors — set E2E_ADMIN_VENDORS=1 to run against a seeded DB.",
    );
    return;
  }
  if (!ADMIN_PASSWORD) {
    console.error(
      "ADMIN_PASSWORD env var is required when E2E_ADMIN_VENDORS=1.",
    );
    process.exit(2);
  }
  console.log(`\nE2E admin vendors @ ${BASE}\n`);

  const jar = makeJar();

  // ---- 1. Login as admin ----
  const login = await request(jar, "/api/admin/auth/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (login.status === 200 && login.json?.success) {
    ok("admin login", `email=${ADMIN_EMAIL}`);
  } else {
    bad(
      "admin login",
      `status=${login.status} body=${JSON.stringify(login.json).slice(0, 200)}`,
    );
    process.exit(1);
  }

  // ---- 2. Create vendor with logo_url ----
  const slug = `e2e-vendor-${randomUUID().slice(0, 8)}`;
  const logoUrl = `/images/vendors/${slug}-logo.png`;
  const create = await request(jar, "/api/admin/vendors", {
    method: "POST",
    body: {
      name_ar: "متجر اختبار آلي",
      name_en: "E2E Test Vendor",
      slug,
      vendor_type: "food_beverage",
      logo_url: logoUrl,
      primary_color: "#009345",
      is_active: true,
      is_featured: false,
    },
  });
  if (create.status === 200 && create.json?.success) {
    ok("create vendor 200", `slug=${slug}`);
  } else {
    bad(
      "create vendor",
      `status=${create.status} body=${JSON.stringify(create.json).slice(0, 300)}`,
    );
    process.exit(1);
  }
  const vendorId = create.json?.data?.id ?? create.json?.id;

  // ---- 3. GET /api/admin/vendors includes the new row with logo_url ----
  const list = await request(jar, "/api/admin/vendors");
  const data = Array.isArray(list.json?.data)
    ? list.json.data
    : Array.isArray(list.json)
      ? list.json
      : [];
  const found = data.find((v) => v.slug === slug);
  if (found) {
    ok("vendor appears in admin list", `slug=${slug}`);
    if (found.logo_url === logoUrl) {
      ok("logo_url persisted", logoUrl);
    } else {
      bad(
        "logo_url persisted",
        `expected=${logoUrl} got=${found.logo_url ?? "(null)"}`,
      );
    }
  } else {
    bad(
      "vendor appears in admin list",
      `slug=${slug} not found among ${data.length} rows`,
    );
  }

  // ---- 4. Public /vendors/<slug> renders the logo ----
  const page = await fetch(`${BASE}/vendors/${slug}`);
  const html = await page.text();
  if (page.status === 200) {
    ok("public vendor page 200", `/vendors/${slug}`);
    // The exact src depends on the JSX; check both possible forms so
    // the test is robust to next/image wrapping.
    const hasLogo =
      html.includes(logoUrl) ||
      html.includes(encodeURI(logoUrl)) ||
      html.includes(slug + "-logo.png");
    if (hasLogo) {
      ok("public page renders logo", logoUrl);
    } else {
      bad(
        "public page renders logo",
        `logo url not present in ${html.length} bytes of HTML`,
      );
    }
  } else {
    bad("public vendor page 200", `status=${page.status} url=/vendors/${slug}`);
  }

  // ---- 5. Cleanup ----
  if (vendorId) {
    try {
      execSync(
        `docker exec citymarket-db psql -U citymarket_user -d citymarket_db -c "DELETE FROM vendors WHERE id = '${vendorId}';"`,
        { encoding: "utf8", stdio: "ignore" },
      );
      ok("cleanup vendor row", `id=${vendorId}`);
    } catch (e) {
      bad("cleanup vendor row", e.message);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
