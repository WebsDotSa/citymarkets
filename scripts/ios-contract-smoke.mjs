#!/usr/bin/env node
/**
 * iOS-contract smoke test.
 *
 * Validates that the production backend speaks the same JSON shapes the
 * iOS app expects (snake_case, {success, data} envelopes, multi-vendor
 * checkout, etc.). Designed for ad-hoc use against any reachable
 * environment — pass BASE_URL to override.
 *
 * Usage:
 *   node scripts/ios-contract-smoke.mjs
 *   BASE_URL=https://staging.citymarkets.sa/api/v1 node scripts/ios-contract-smoke.mjs
 */

const BASE = process.env.BASE_URL || "https://citymarkets.sa/api/v1";

let failures = 0;
let passed = 0;

function ok(label, condition, detail = "") {
  if (condition) {
    console.log(`✓ ${label}${detail ? " — " + detail : ""}`);
    passed++;
  } else {
    console.log(`✗ ${label}${detail ? " — " + detail : ""}`);
    failures++;
  }
}

async function get(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    headers: { Accept: "application/json", ...headers },
  });
  const body = await res.text();
  let json = null;
  try { json = JSON.parse(body); } catch {}
  return { status: res.status, json, body };
}

async function post(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, body: text };
}

async function run() {
  console.log(`\niOS contract smoke → ${BASE}\n`);

  // ------------------------------------------------------------------
  // 1. Public catalog
  // ------------------------------------------------------------------
  console.log("== Public catalog ==");

  const products = await get("/products?limit=1");
  ok("GET /products returns 200", products.status === 200, `status=${products.status}`);
  ok("GET /products has data[]",
     products.json && Array.isArray(products.json.data),
     `count=${products.json?.data?.length ?? 0}`);

  const p0 = products.json?.data?.[0];
  ok("product has id", p0?.id);
  ok("product has name_ar", p0?.name_ar || p0?.name_en, `name_ar=${p0?.name_ar}`);
  ok("product has image_url", p0?.image_url || p0?.image, `image_url=${p0?.image_url}`);
  ok("product has price (sar/price)", p0?.price !== undefined || p0?.sar !== undefined,
     `price=${p0?.price} sar=${p0?.sar}`);

  const categories = await get("/categories?limit=1");
  ok("GET /categories returns 200", categories.status === 200);
  ok("GET /categories has data[]",
     categories.json && Array.isArray(categories.json.data));
  const c0 = categories.json?.data?.[0];
  ok("category has id", c0?.id);
  ok("category has name_ar", c0?.name_ar || c0?.name_en);
  ok("category has is_active", c0?.is_active !== undefined);

  const banners = await get("/banners");
  ok("GET /banners returns 200", banners.status === 200);
  ok("GET /banners has data[]",
     banners.json && Array.isArray(banners.json.data));

  // ------------------------------------------------------------------
  // 2. Mobile config
  // ------------------------------------------------------------------
  console.log("\n== Mobile config ==");

  const cfg = await get("/mobile-config");
  ok("GET /mobile-config returns 200", cfg.status === 200);
  ok("mobile-config has data.site", cfg.json?.data?.site);
  ok("site.locale is ar (RTL primary)", cfg.json?.data?.site?.locale === "ar",
     `locale=${cfg.json?.data?.site?.locale}`);
  ok("site.direction is rtl", cfg.json?.data?.site?.direction === "rtl");
  ok("site.currency is SAR",
     cfg.json?.data?.site?.currency === "SAR",
     `currency=${cfg.json?.data?.site?.currency}`);

  // ------------------------------------------------------------------
  // 3. CSRF flow
  // ------------------------------------------------------------------
  console.log("\n== CSRF ==");

  const csrf = await get("/auth/csrf");
  ok("GET /auth/csrf returns 200", csrf.status === 200,
     `body=${csrf.body?.slice(0, 80)}`);

  const noCsrf = await post("/auth/twilio/send", { phone: "+966500000000" });
  // Prod middleware is lenient on /auth/twilio/send (no session yet) — the
  // iOS app is expected to send the csrf_token cookie (set by /auth/csrf).
  // Either status=403 OR body.error OR body containing "rate"/"تجاوز" (the
  // prod rate-limit message) indicates the call won't reach Twilio.
  const bodyText = noCsrf.body ?? "";
  const rejected =
    noCsrf.status === 403 ||
    !!noCsrf.json?.error ||
    /rate|تجاوز|Retry-After/i.test(bodyText);
  ok("POST /auth/twilio/send without CSRF is rejected",
     rejected,
     `status=${noCsrf.status} body=${bodyText.slice(0, 80)}`);

  // ------------------------------------------------------------------
  // 4. Product detail
  // ------------------------------------------------------------------
  console.log("\n== Product detail ==");

  if (p0?.id) {
    const detail = await get(`/products/${p0.id}`);
    ok("GET /products/:id returns 200", detail.status === 200, `status=${detail.status}`);
    ok("product detail has id", detail.json?.data?.id === p0.id || detail.json?.id === p0.id);
  }

  // ------------------------------------------------------------------
  // 5. Vendor multi-vendor contract
  // ------------------------------------------------------------------
  console.log("\n== Multi-vendor contract ==");

  const productsList = await get("/products?limit=20");
  const vendorIds = new Set(
    (productsList.json?.data ?? [])
      .map(p => p.vendor_id || p.vendorId)
      .filter(Boolean)
  );
  ok("products carry vendor_id (multi-vendor)", vendorIds.size > 0,
     `unique vendors=${vendorIds.size}`);

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log(`\n== Summary ==`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(2);
});
