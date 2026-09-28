# Remaining non-critical issues (5 prompts)

The critical-issue review surfaced six items, all of which have been resolved. The next-tier review surfaced five items that were deferred. Each prompt below is self-contained and can be handed to a fresh agent.

---

## Prompt A — Add coverage to `vitest.config.ts` and write tests for remaining route handlers

**File**: `vitest.config.ts`

The coverage `include` glob currently lists only `src/lib/**` and `src/components/**`. Route handlers in `src/app/api/**` are tested (the new glob already picks them up via `include: ["src/**/*.test.ts"]`) but their **lines do not count** toward the 80% coverage threshold because the coverage scope excludes them. That's why the recent `/api/v1/orders` and `/api/v1/payments/initiate` tests are regression guards rather than coverage-bearing.

**Tasks**:
1. Add `"src/app/api/**"` to `coverage.include` in `vitest.config.ts`.
2. Exclude `**/route.test.ts` from the coverage scope (route tests are guard tests; counting their exercised lines against the route's coverage would inflate the numbers).
3. Run `npx vitest run --coverage` and confirm a coverage report is produced. Expect a sharp dip for `src/app/api/**` because most routes have no test yet. List the top 10 least-covered files.
4. Pick the 5 highest-traffic uncovered routes from the list and add minimal regression tests using the patterns in:
   - `src/app/api/v1/orders/route.test.ts`
   - `src/app/api/v1/payments/initiate/route.test.ts`
   - `src/app/api/v1/auth/login/route.test.ts`
5. Target: 80% line coverage on `src/app/api/**` after the new tests. Anything below that goes back into the backlog.

**Acceptance**:
- `vitest.config.ts` updated.
- At least 5 new test files added (one per route).
- `npx vitest run --coverage` shows 80%+ lines for `src/app/api/**`.
- `npx tsc --noEmit` clean.

---

## Prompt B — Type-strict rewrite of `src/lib/checkout/create-checkout.ts` and `src/lib/checkout/resolve-items.ts`

**Files**: `src/lib/checkout/create-checkout.ts`, `src/lib/checkout/resolve-items.ts`, `src/lib/checkout/resolve-delivery.ts`

These three files use `unknown` plus runtime `as` casts in places. The casts are necessary because the SQL rows are typed as `any` by `pool.query()`. The fix is upstream: wrap `pool.query<T>()` in a typed helper that does the `as` at the boundary, so the rest of the file is fully typed.

**Tasks**:
1. Audit `src/lib/db/index.ts` (or wherever `query` is defined) and confirm the current generic signature.
2. Create `src/lib/db/typed.ts` (or equivalent) with a `queryOne<T>` / `queryMany<T>` helper that:
   - Returns `T | null` / `T[]`
   - Validates `rows[0]` is non-null when `queryOne` is used
   - Throws a typed `DbError` on connection failure
3. Replace the inline `as` casts in the three checkout files with the typed helper.
4. Add a unit test for the typed helper using a fake `Pool` (the same pattern used in `src/lib/customer-session.test.ts` if one exists; otherwise write a small in-test fake).

**Acceptance**:
- No `as any` or `as Record<string, unknown>` in the three checkout files.
- New typed helper has tests.
- `npx tsc --noEmit` clean.
- `npx vitest run` — all green.

---

## Prompt C — Add per-IP rate limit to `voice-order` route

**Files**: `src/app/api/v1/voice-order/route.ts`, `src/lib/rate-limit.ts`

`VOICE_ORDER_CONFIG` exists (10/min) but is keyed on either user or IP depending on the caller. A logged-in user rotating IPs can blow past the cap; an unauthenticated attacker from one IP can spray 10 requests/min, each running N DB searches, and DoS the search pool.

**Tasks**:
1. Add a new `VOICE_ORDER_IP_CONFIG` preset to `src/lib/rate-limit.ts`:
   - `keyPrefix: 'voice:order:ip'`
   - `maxRequests: 30` (3× the per-user cap, so legit NAT'd offices aren't punished)
   - `windowMs: 60_000`
2. In `src/app/api/v1/voice-order/route.ts`, after the existing `VOICE_ORDER_CONFIG` check, add a second `checkRateLimit(getClientIp(request), VOICE_ORDER_IP_CONFIG)` call.
3. On 429, set the `X-RateLimit-By` header to `ip` (the per-user path stays without that header, mirroring the admin-login pattern).
4. Add a unit test for the new preset in `src/lib/rate-limit.test.ts`:
   - Different `keyPrefix` from `VOICE_ORDER_CONFIG`
   - `maxRequests` is exactly 3× the per-user cap
   - Same 1-minute window

**Acceptance**:
- `npx tsc --noEmit` clean.
- `npx vitest run src/lib/rate-limit.test.ts` — 19+ tests pass (was 18).
- Manual curl test: 31 rapid requests from one IP to `/api/v1/voice-order` returns 429 on request 31.

---

## Prompt D — E2E test for admin vendor management (add → upload logo → save → verify in /vendors)

**Files**: New `tests/e2e/admin-vendors.spec.ts` (Playwright)

The full flow for adding a vendor with a brand identity was wired in the previous review (admin/vendors route + Zod validation + image uploader + form state hoisting). There's no E2E that proves the round-trip works in a real browser. The most common production bug — the ImageUploader's `onChange` was originally `() => {}`, which meant the URL never made it into the form — would not be caught by route tests or unit tests alone.

**Tasks**:
1. Add a Playwright test that:
   - Logs in as admin
   - Navigates to `/admin/vendors`
   - Clicks "إضافة"
   - Fills `name_ar`, `name_en`, picks a `vendor_type`
   - Uploads a small PNG (≤ 50 KB) via the ImageUploader
   - Asserts the `logo_url` field is auto-populated (this is the regression guard)
   - Clicks "حفظ"
   - Verifies a 200 response and the vendor appears in the list
   - Clicks the "view" action
   - Asserts the public `/vendors/<slug>` page renders the uploaded logo
2. Skip the test on CI without a Postgres + admin-seed fixture. The test file should `test.skip` if `process.env.E2E_ADMIN_VENDORS === '1'` is not set, and document the seed setup needed.
3. Add a script `scripts/e2e-admin-vendors.sh` that starts a clean DB, seeds the admin user, runs migrations, and runs the test.

**Acceptance**:
- Test file passes locally when run against a seeded dev DB.
- `test.skip` default keeps CI green until the infra is ready.

---

## Prompt E — Decouple `proxy.ts` from RSC redirect quirks for storefront routes

**Files**: `src/proxy.ts`, `src/lib/app-routes.ts`, possibly `src/components/layout/store-chrome.tsx`

The auto-memory at `.claude/projects/.../memory/proxy_server_component_redirect_quirk.md` notes that `redirect()` in pages under this proxy silently breaks for storefront routes. The workaround is documented: "use canonical link + noindex instead of redirect() in pages under this proxy.ts." But the workaround is **not** applied in 5 known pages. Search the tree for `redirect(`/`, …)` or `redirect("/ar")` calls inside `app/(storefront)/**` and convert each to a `<head>` canonical link + a `noindex` meta tag, plus a 200 response with an empty state.

**Tasks**:
1. Grep `src/app/**` for `redirect(` and produce a list of every call site.
2. Filter the list to those that match a storefront pathname pattern (e.g. match `app/(storefront)/**` or any path where `isStorefrontRoute()` returns true).
3. For each, replace the `redirect()` with a server-rendered component that:
   - Sets `<meta name="robots" content="noindex" />`
   - Sets `<link rel="canonical" href="..." />` to the actual canonical URL
   - Renders an empty state (no UI body)
4. Add a unit test in `src/lib/app-routes.test.ts` that asserts no storefront route is allowed to call `redirect()`.
5. Re-run `npx vitest run`.

**Acceptance**:
- No `redirect()` calls in storefront route handlers.
- `X-Robots-Tag: noindex` and `<link rel="canonical">` present on the affected pages.
- New test in `app-routes.test.ts` passes.
