#!/usr/bin/env node
/**
 * E2E Customer Journey — تجربة العميل الكاملة
 *
 * 1.  Login → JWT cookie (customer_session)
 * 2.  Browse vendors + products + categories + home
 * 3.  Wishlist: add / list / remove
 * 4.  Cart: add / list
 * 5.  Coupon validate (expect structured rejection, not 5xx)
 * 6.  Checkout → order created
 * 7.  Orders: list + detail
 * 8.  Profile: PUT update + reflect in GET
 * 9.  Addresses: list / add / PATCH label
 * 10. Reviews: requires productId or mine=1
 * 11. Loyalty + spin reads
 * 12. Logout
 *
 * Auth strategy:
 *   requireAuth() (profile route) and the customer JWT helpers both read
 *   the `customer_session` cookie, NOT the Authorization header. We seed
 *   the user in the DB, sign a fresh HS256 JWT with the dev secret, and
 *   inject it into the cookie jar — that is the same path the production
 *   /login endpoint takes when Twilio Verify is bypassed.
 *
 * Skip conditions (exit 0):
 *   BASE_URL not reachable
 *   DB not reachable
 *   JWT_SECRET not set
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = any check failed
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import pkg from "pg";

const { Pool } = pkg;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = process.env.BASE_URL || "http://127.0.0.1:3005";

// ---- env loader ----
function loadEnv() {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();

const pool = new Pool({
  host: process.env.DATABASE_HOST || "127.0.0.1",
  port: Number(process.env.DATABASE_PORT || 5432),
  database: process.env.DATABASE_NAME || "citymarket_db",
  user: process.env.DATABASE_USER || "citymarket_user",
  password:
    process.env.DATABASE_PASSWORD || "city-market-dev-database-password-only",
});

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

// ----- fetch with cookie jar -----
async function api(method, path, { body, jar, headers = {} } = {}) {
  const url = `${BASE}${path}`;
  // CSRF: every mutating request must echo the csrf_token cookie in
  // the x-csrf-token header. GETs are exempt.
  const m = method.toUpperCase();
  const isMutating = m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
  const csrf =
    isMutating && jar?.csrf_token ? { "x-csrf-token": jar.csrf_token } : {};
  const opts = {
    method,
    headers: {
      Accept: "application/json",
      ...csrf,
      ...(jar && Object.keys(jar).length
        ? { Cookie: Object.entries(jar)
            .map(([k, v]) => `${k}=${v}`)
            .join("; ") }
        : {}),
      ...headers,
    },
  };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  // update cookie jar
  if (jar) {
    const sc = res.headers.get("set-cookie");
    if (sc) {
      for (const c of sc.split(/,(?=[^;]+?=)/)) {
        const [pair] = c.split(";");
        const [k, v] = (pair || "").split("=");
        if (k && v !== undefined) {
          const key = k.trim();
          if (v.trim() === "" || /expires=.*1970/i.test(c)) delete jar[key];
          else jar[key] = v.trim();
        }
      }
    }
  }
  let json;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json };
}

// ============================================================
// preflight
// ============================================================
async function preflight() {
  try {
    const res = await fetch(`${BASE}/api/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    check(
      "preflight: /api/health returns 200",
      true,
      `db=${json.services?.database?.status}`,
    );
  } catch (e) {
    console.log(`SKIP: BASE_URL=${BASE} not reachable (${e.message}).`);
    process.exit(0);
  }
  try {
    await pool.query("SELECT 1");
    check("preflight: DATABASE_URL reachable", true, "");
  } catch (e) {
    console.log(`SKIP: DB not reachable (${e.message}).`);
    process.exit(0);
  }
  if (!process.env.JWT_SECRET && !process.env.CUSTOMER_JWT_SECRET) {
    console.log(`SKIP: JWT_SECRET / CUSTOMER_JWT_SECRET not set.`);
    process.exit(0);
  }
}

// ============================================================
// bootstrap — sign a customer JWT and place it in the cookie jar
// ============================================================
async function signCustomer(userId, phone) {
  const secret = process.env.JWT_SECRET || process.env.CUSTOMER_JWT_SECRET;
  return await new SignJWT({ userId, phone })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("citymarket-customer")
    .setAudience("citymarket-customer-api")
    .setSubject(userId)
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
}

// ============================================================
// fixtures — pick an active vendor + product
// ============================================================
async function pickVendorProduct() {
  const v = await pool.query(
    `SELECT id::text, slug, name_ar FROM vendors
     WHERE is_active = true ORDER BY created_at LIMIT 1`,
  );
  const vendor = v.rows[0];
  if (!vendor) throw new Error("no active vendor in DB");
  const p = await pool.query(
    `SELECT id::text, name_ar, price::numeric AS price, stock::int AS stock
       FROM vendor_products
      WHERE vendor_id = $1 AND is_active = true
      ORDER BY created_at LIMIT 1`,
    [vendor.id],
  );
  const product = p.rows[0];
  if (!product) throw new Error("no product for vendor " + vendor.slug);
  return { vendor, product };
}

// ============================================================
// step 0 — acquire a CSRF token (issued as the `csrf_token` cookie
//          by /api/v1/auth/csrf; the same value is required in the
//          `x-csrf-token` header on every POST/PUT/PATCH/DELETE)
// ============================================================
async function stepCsrf(jar) {
  const r = await api("GET", "/api/v1/auth/csrf", { jar });
  check(
    "step0: GET /api/v1/auth/csrf issues csrf_token cookie",
    r.status === 200 && Boolean(jar.csrf_token),
    `status=${r.status} cookie=${jar.csrf_token ? "set" : "missing"}`,
  );
  return jar.csrf_token;
}

// ============================================================
// step 1 — register/login (seed user, sign JWT, place in cookie jar)
// ============================================================
async function stepLogin(jar) {
  const userId = randomUUID();
  const phone =
    "+9665" +
    Math.floor(Math.random() * 9_000_000_00 + 100_000_000)
      .toString()
      .padStart(9, "0");
  await pool.query(
    `INSERT INTO users (id, phone, name) VALUES ($1, $2, 'E2E Customer')
     ON CONFLICT (phone) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name
     RETURNING id::text`,
    [userId, phone],
  );
  const u = await pool.query(
    `SELECT id::text FROM users WHERE phone = $1`,
    [phone],
  );
  const realId = u.rows[0].id;

  const token = await signCustomer(realId, phone);
  jar["customer_session"] = token;

  // verify the cookie resolves through requireAuth
  const r = await api("GET", "/api/v1/profile", { jar });
  check(
    "step1: GET /api/v1/profile returns 200 (cookie auth)",
    r.status === 200 && r.json?.data?.id === realId,
    `status=${r.status} id=${r.json?.data?.id?.slice(0, 8)}`,
  );
  return { userId: realId, phone, token };
}

// ============================================================
// step 2 — browse
// ============================================================
async function stepBrowse(jar) {
  const home = await fetch(`${BASE}/`, {
    headers: { Cookie: `customer_session=${jar.customer_session}` },
  });
  check(
    "step2: home page returns 200",
    home.status === 200,
    `status=${home.status}`,
  );

  const cats = await api("GET", "/api/v1/categories?limit=20", { jar });
  const catCount = Array.isArray(cats.json?.data)
    ? cats.json.data.length
    : 0;
  check(
    "step2: GET /api/v1/categories returns 200 with data[]",
    cats.status === 200 && catCount > 0,
    `count=${catCount}`,
  );

  const vendors = await api("GET", "/api/v1/vendors?limit=20", { jar });
  const vendorCount = Array.isArray(vendors.json?.vendors)
    ? vendors.json.vendors.length
    : 0;
  check(
    "step2: GET /api/v1/vendors returns 200 with vendors[]",
    vendors.status === 200 && vendorCount > 0,
    `count=${vendorCount}`,
  );

  const products = await api("GET", "/api/v1/products?limit=20", { jar });
  const productCount = Array.isArray(products.json?.data)
    ? products.json.data.length
    : 0;
  check(
    "step2: GET /api/v1/products returns 200 with data[]",
    products.status === 200 && productCount > 0,
    `count=${productCount}`,
  );

  return {
    vendor: vendors.json?.vendors?.[0],
    product: products.json?.data?.[0],
  };
}

// ============================================================
// step 3 — wishlist (CRUD)
// ============================================================
async function stepWishlist(jar, product) {
  if (!product?.id) {
    check("step3: wishlist (skipped — no product)", true, "n/a");
    return;
  }
  const add = await api("POST", "/api/v1/wishlist", {
    jar,
    body: { product_id: product.id },
  });
  check(
    "step3: POST /api/v1/wishlist (add product) returns 2xx",
    add.status >= 200 && add.status < 300,
    `status=${add.status} body=${JSON.stringify(add.json).slice(0, 120)}`,
  );

  const list = await api("GET", "/api/v1/wishlist", { jar });
  const listItems = list.json?.items ?? list.json?.data ?? [];
  const listCount = Array.isArray(listItems) ? listItems.length : 0;
  check(
    "step3: GET /api/v1/wishlist returns 200 with items",
    list.status === 200 && listCount > 0,
    `status=${list.status} count=${listCount}`,
  );

  // DELETE takes a query param: ?product_id=<id>
  const rm = await api("DELETE", `/api/v1/wishlist?product_id=${product.id}`, {
    jar,
  });
  check(
    "step3: DELETE /api/v1/wishlist?product_id=<id> returns 2xx",
    rm.status >= 200 && rm.status < 300,
    `status=${rm.status}`,
  );
}

// ============================================================
// step 4 — cart (POST /api/v1/cart; body camelCase)
// ============================================================
async function stepCart(jar, product) {
  if (!product?.id) {
    check("step4: cart (skipped — no product)", true, "n/a");
    return;
  }
  const add = await api("POST", "/api/v1/cart", {
    jar,
    body: { productId: product.id, quantity: 2 },
  });
  check(
    "step4: POST /api/v1/cart returns 2xx",
    add.status >= 200 && add.status < 300,
    `status=${add.status} body=${JSON.stringify(add.json).slice(0, 120)}`,
  );

  const get = await api("GET", "/api/v1/cart", { jar });
  const getItems = get.json?.items ?? get.json?.data ?? [];
  const items = Array.isArray(getItems) ? getItems.length : 0;
  check(
    "step4: GET /api/v1/cart returns 200 with items>0",
    get.status === 200 && items > 0,
    `items=${items}`,
  );
}

// ============================================================
// step 5 — coupon validate (expect structured rejection)
// ============================================================
async function stepCoupon(jar) {
  const r = await api("POST", "/api/v1/coupons/validate", {
    jar,
    body: { code: "E2E_NOPE_NOT_REAL_" + Date.now() },
  });
  // /api/v1/coupons/validate is documented to return 200 with
  // {success:true, valid:false, error:"..."} for an unknown code.
  // Verify the structured-rejection path works (no 5xx).
  check(
    "step5: POST /api/v1/coupons/validate handles bad code (no 5xx)",
    r.status === 200 && r.json?.valid === false,
    `status=${r.status} valid=${r.json?.valid} err=${r.json?.error}`,
  );
}

// ============================================================
// step 6 — checkout
// ============================================================
async function stepCheckout(jar, vendor, product) {
  if (!vendor?.id || !product?.id) {
    check("step6: checkout (skipped — no vendor/product)", true, "n/a");
    return { orderId: null };
  }
  // The checkout schema does NOT auto-load from the cart; the client must
  // send `items` (catalog) and/or `groups` (per-vendor) explicitly. We
  // pass the product we just added to the cart so checkout sees a
  // non-empty payload and the server can resolve vendor + price.
  const r = await api("POST", "/api/v1/checkout", {
    jar,
    body: {
      items: [
        {
          product_id: product.id,
          quantity: 1,
          // vendor_id is optional — checkout back-fills it from
          // products_unified. Including it here documents the full
          // contract.
          vendor_id: product.vendor_id ?? product.vendorId ?? null,
        },
      ],
      payment_method: "cash",
      delivery_mode: "delivery",
      address: {
        label: "Home",
        lat: 24.7136,
        lng: 46.6753,
        address_text: "King Fahd Rd 1234, Riyadh",
      },
    },
  });
  const ok = r.status >= 200 && r.status < 300;
  check(
    "step6: POST /api/v1/checkout returns 2xx",
    ok,
    `status=${r.status} body=${JSON.stringify(r.json).slice(0, 200)}`,
  );

  const orderId = r.json?.orderId ?? r.json?.id ?? r.json?.data?.id ?? null;
  return { orderId, json: r.json };
}

// ============================================================
// step 7 — orders
// ============================================================
async function stepOrders(jar, orderId) {
  const list = await api("GET", "/api/v1/orders?limit=10", { jar });
  const orders = list.json?.orders ?? list.json?.data ?? [];
  check(
    "step7: GET /api/v1/orders returns 200 with orders[]",
    list.status === 200 && Array.isArray(orders),
    `status=${list.status} count=${orders.length}`,
  );

  if (orderId) {
    const det = await api("GET", `/api/v1/orders/${orderId}`, { jar });
    check(
      "step7: GET /api/v1/orders/<id> returns 200",
      det.status === 200,
      `status=${det.status}`,
    );
  }
}

// ============================================================
// step 8 — profile update via PUT
// ============================================================
async function stepProfile(jar) {
  const newName = "E2E Customer " + Date.now().toString(36).slice(-4);
  const upd = await api("PUT", "/api/v1/profile", {
    jar,
    body: { name: newName },
  });
  check(
    "step8: PUT /api/v1/profile returns 2xx",
    upd.status >= 200 && upd.status < 300,
    `status=${upd.status} body=${JSON.stringify(upd.json).slice(0, 120)}`,
  );

  const get = await api("GET", "/api/v1/profile", { jar });
  const got = get.json?.data?.name ?? get.json?.name;
  check(
    "step8: GET /api/v1/profile reflects new name",
    get.status === 200 && got === newName,
    `name=${got}`,
  );
}

// ============================================================
// step 9 — addresses
// ============================================================
async function stepAddresses(jar) {
  const list = await api("GET", "/api/v1/addresses", { jar });
  const addrs = list.json?.data ?? list.json?.addresses ?? list.json ?? [];
  check(
    "step9: GET /api/v1/addresses returns 200",
    list.status === 200,
    `status=${list.status} count=${Array.isArray(addrs) ? addrs.length : "?"}`,
  );

  const add = await api("POST", "/api/v1/addresses", {
    jar,
    body: {
      label: "Home",
      lat: 24.7136,
      lng: 46.6753,
      address_text: "King Fahd Rd 1234, Riyadh",
      description: "Apt 5",
      is_default: true,
    },
  });
  const added = add.status >= 200 && add.status < 300;
  check(
    "step9: POST /api/v1/addresses returns 2xx",
    added,
    `status=${add.status} body=${JSON.stringify(add.json).slice(0, 200)}`,
  );

  const addrId =
    add.json?.id ?? add.json?.data?.id ?? add.json?.address?.id ?? null;
  if (addrId) {
    // The legacy /api/v1/addresses/[id] only supports DELETE; the
    // canonical PATCH-equivalent is PUT on /delivery-addresses/[id]
    // (migration 078). The PUT body requires both `label` AND
    // `address_text` — partial updates are not supported, so we
    // re-send the original fields with the renamed label.
    const upd = await api("PUT", `/api/v1/delivery-addresses/${addrId}`, {
      jar,
      body: {
        label: "Home (renamed)",
        address_text: "King Fahd Rd 1234, Riyadh",
        lat: 24.7136,
        lng: 46.6753,
        description: "Apt 5",
      },
    });
    check(
      "step9: PUT /api/v1/delivery-addresses/<id> returns 2xx",
      upd.status >= 200 && upd.status < 300,
      `status=${upd.status}`,
    );
  } else {
    check("step9: PUT /api/v1/delivery-addresses/<id>", false,
      "no address id returned from POST — cannot PUT");
  }
}

// ============================================================
// step 10 — reviews (mine=1 with auth)
// ============================================================
async function stepReviews(jar) {
  const r = await api("GET", "/api/v1/reviews?mine=1&limit=10", { jar });
  check(
    "step10: GET /api/v1/reviews?mine=1 returns 2xx",
    r.status >= 200 && r.status < 300,
    `status=${r.status} body=${JSON.stringify(r.json).slice(0, 120)}`,
  );
}

// ============================================================
// step 11 — loyalty + spin reads
// ============================================================
async function stepLoyalty(jar) {
  const r = await api("GET", "/api/v1/loyalty", { jar });
  check(
    "step11: GET /api/v1/loyalty returns 200",
    r.status === 200,
    `status=${r.status}`,
  );

  const s = await api("GET", "/api/v1/spin", { jar });
  check(
    "step11: GET /api/v1/spin returns 200",
    s.status === 200,
    `status=${s.status}`,
  );
}

// ============================================================
// step 12 — logout
// ============================================================
async function stepLogout(jar) {
  const r = await api("POST", "/api/v1/auth/logout", { jar });
  check(
    "step12: POST /api/v1/auth/logout returns 2xx",
    r.status >= 200 && r.status < 300,
    `status=${r.status}`,
  );
}

// ============================================================
// main
// ============================================================
async function main() {
  console.log(`\n--- Customer Journey E2E against ${BASE} ---\n`);
  await preflight();
  const jar = {};
  await stepCsrf(jar);
  const { userId } = await stepLogin(jar);
  console.log(`(customer: ${userId.slice(0, 8)})`);

  const { vendor, product } = await stepBrowse(jar);

  let fixtureProduct = product;
  if (!fixtureProduct) {
    try {
      fixtureProduct = (await pickVendorProduct()).product;
    } catch {
      fixtureProduct = null;
    }
  }

  await stepWishlist(jar, fixtureProduct);
  await stepCart(jar, fixtureProduct);
  await stepCoupon(jar);
  const { orderId } = await stepCheckout(jar, vendor, fixtureProduct);
  await stepOrders(jar, orderId);
  await stepProfile(jar);
  await stepAddresses(jar);
  await stepReviews(jar);
  await stepLoyalty(jar);
  await stepLogout(jar);

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n--- ${results.length - failed.length}/${results.length} checks passed ---\n`,
  );
  if (failed.length > 0) {
    console.log("Failed checks:");
    for (const f of failed) {
      console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ""}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch(async (e) => {
  console.error("FATAL:", e.message);
  console.error(e.stack);
  await pool.end().catch(() => {});
  process.exit(1);
});
