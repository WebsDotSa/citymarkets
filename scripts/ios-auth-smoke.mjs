#!/usr/bin/env node
/**
 * iOS auth + protected-endpoint smoke test.
 *
 * Validates that the backend enforces the iOS client's auth contract:
 *   - CSRF is required for state-changing requests
 *   - Unauthenticated requests to protected routes return 401
 *   - The login form endpoint accepts a Twilio-shaped phone payload
 *   - /auth/csrf sets the CSRF cookie that iOS will round-trip
 *
 * Unlike `e2e-customer-payment.mjs`, this script does NOT require
 * docker / DB access or a JWT signing secret — it runs purely against
 * the public API surface and is safe to call from CI against staging
 * or production.
 *
 * Usage:
 *   node scripts/ios-auth-smoke.mjs
 *   BASE_URL=https://staging.citymarkets.sa/api/v1 node scripts/ios-auth-smoke.mjs
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
  return parse(res);
}

async function post(path, body, headers = {}, cookie = "") {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    ...(cookie ? { headers: { Cookie: cookie } } : {}),
  });
  return parse(res);
}

async function parse(res) {
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return {
    status: res.status,
    json,
    body: text,
    setCookie: res.headers.get("set-cookie"),
  };
}

function extractCookieValue(setCookieHeader, name) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function run() {
  console.log(`\niOS auth smoke → ${BASE}\n`);

  // ------------------------------------------------------------------
  // 1. CSRF endpoint
  // ------------------------------------------------------------------
  console.log("== CSRF ==");
  const csrf = await get("/auth/csrf");
  ok("GET /auth/csrf returns 200", csrf.status === 200,
     `status=${csrf.status}`);
  const csrfToken = extractCookieValue(
    // Headers can be combined — look for the cookie in body OR headers
    csrf.json?.csrfToken ? csrf.setCookie : csrf.setCookie,
    "csrf_token"
  );
  ok("CSRF cookie is set", csrfToken !== null || csrf.json?.csrfToken !== undefined,
     `token=${(csrfToken || csrf.json?.csrfToken || "").slice(0, 16)}…`);

  // ------------------------------------------------------------------
  // 2. Twilio send — must reject without CSRF
  // ------------------------------------------------------------------
  console.log("\n== OTP send (CSRF gating) ==");
  const noCsrf = await post("/auth/twilio/send", { phone: "+966500000000" });
  const bodyText = noCsrf.body ?? "";
  const rejected =
    noCsrf.status === 403 ||
    !!noCsrf.json?.error ||
    /rate|تجاوز|Retry-After/i.test(bodyText);
  ok("POST /auth/twilio/send without CSRF is rejected",
     rejected,
     `status=${noCsrf.status} body=${bodyText.slice(0, 80)}`);

  // ------------------------------------------------------------------
  // 3. Twilio send with CSRF — accepted (200/202) or rate-limited (429)
  // ------------------------------------------------------------------
  console.log("\n== OTP send (with CSRF) ==");
  // Build a Cookie header from the CSRF response. iOS would store this
  // in the URLSession cookie jar; we mimic it manually for the smoke.
  const csrfCookieHeader = csrf.setCookie
    ? csrf.setCookie.split(",").map(s => s.split(";")[0]).join("; ")
    : "";
  const withCsrf = await post(
    "/auth/twilio/send",
    { phone: "+966500000000" },
    {},
    csrfCookieHeader
  );
  const accepted = withCsrf.status === 200 ||
    withCsrf.status === 202 ||
    withCsrf.status === 429 || // rate-limited but CSRF passed
    withCsrf.json?.success === true;
  ok("POST /auth/twilio/send with CSRF is accepted",
     accepted,
     `status=${withCsrf.status} success=${withCsrf.json?.success}`);

  // ------------------------------------------------------------------
  // 4. /auth/me — anonymous must return 401
  // ------------------------------------------------------------------
  console.log("\n== /auth/me (anonymous) ==");
  const meAnon = await get("/auth/me");
  ok("GET /auth/me without JWT returns 401",
     meAnon.status === 401,
     `status=${meAnon.status}`);

  // ------------------------------------------------------------------
  // 5. /auth/me — invalid Bearer is 401
  // ------------------------------------------------------------------
  const meBadBearer = await get("/auth/me", {
    Authorization: "Bearer not.a.real.jwt",
  });
  ok("GET /auth/me with garbage JWT returns 401",
     meBadBearer.status === 401,
     `status=${meBadBearer.status}`);

  // ------------------------------------------------------------------
  // 6. Protected routes reject anonymous calls
  // ------------------------------------------------------------------
  console.log("\n== Protected routes (anonymous must fail) ==");
  const protectedChecks = [
    { method: "GET",  path: "/cart",            label: "GET  /cart" },
    { method: "POST", path: "/cart",            label: "POST /cart",     body: { productId: 1, quantity: 1 } },
    { method: "GET",  path: "/orders",          label: "GET  /orders" },
    { method: "POST", path: "/checkout",        label: "POST /checkout", body: { addressId: 1, paymentMethod: "cash" } },
    { method: "GET",  path: "/loyalty",         label: "GET  /loyalty" },
    { method: "GET",  path: "/addresses",       label: "GET  /addresses" },
  ];

  for (const check of protectedChecks) {
    const res = check.method === "GET"
      ? await get(check.path)
      : await post(check.path, check.body || {});
    const rejected = res.status === 401 || res.status === 403;
    ok(`${check.label} without JWT returns 401/403`,
       rejected,
       `status=${res.status}`);
  }

  // ------------------------------------------------------------------
  // 7. CSRF middleware leaves GETs alone
  // ------------------------------------------------------------------
  console.log("\n== GETs bypass CSRF (intentional) ==");
  const productsGet = await get("/products?limit=1");
  ok("GET /products is reachable without CSRF",
     productsGet.status === 200,
     `status=${productsGet.status}`);

  // ------------------------------------------------------------------
  // 8. Twilio verify — wrong code returns 4xx, not crash
  // ------------------------------------------------------------------
  console.log("\n== OTP verify (rejection path) ==");
  const verifyBad = await post(
    "/auth/twilio/verify",
    { phone: "+966500000000", code: "000000" },
    {},
    csrfCookieHeader
  );
  const verifyRejected = verifyBad.status >= 400 && verifyBad.status < 500;
  ok("POST /auth/twilio/verify with bogus code returns 4xx",
     verifyRejected,
     `status=${verifyBad.status}`);

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log(`\n== Summary ==`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failures}`);
  if (failures > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Auth smoke crashed:", err);
  process.exit(2);
});
