const cookieJar = new Map();
function setCookies(arr) { for (const sc of arr || []) { const [pair] = sc.split(";"); const [k, v] = pair.split("="); if (k && v !== undefined) cookieJar.set(k.trim(), v.trim()); } }
function hdr() { return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
async function go(url, init = {}) {
  const h = new Headers(init.headers || {});
  if (cookieJar.size) h.set("Cookie", hdr());
  const r = await fetch(url, { ...init, headers: h, redirect: "manual" });
  setCookies(r.headers.getSetCookie?.());
  return r;
}

const csrfRes = await go("http://127.0.0.1:3005/api/auth/csrf");
const csrfJson = await csrfRes.json();

const loginRes = await go("http://127.0.0.1:3005/api/admin/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-csrf-token": csrfJson.csrfToken },
  body: JSON.stringify({ email: "admin@citymarkets.sa", password: "CityMarket2026!" }),
});
console.log("login:", loginRes.status);

const endpoints = [
  "/api/admin/products?limit=10",
  "/api/admin/orders?limit=10",
  "/api/admin/analytics",
  "/api/admin/categories",
  "/api/admin/banners",
  "/api/admin/coupons",
  "/api/admin/users",
  "/api/admin/notifications",
  "/api/admin/orders/direct?limit=5",
];
for (const ep of endpoints) {
  const r = await go(`http://127.0.0.1:3005${ep}`, { headers: { "x-csrf-token": csrfJson.csrfToken } });
  const text = await r.text();
  const ok = r.status === 200 && (text.startsWith("{") || text.startsWith("["));
  console.log(`${ok ? "✓" : "✗"} ${r.status} ${ep} ${text.slice(0, 80).replace(/\n/g, "")}`);
}
