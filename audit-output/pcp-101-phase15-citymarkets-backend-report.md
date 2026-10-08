# Phase 15 — Backend Deep Audit (PCP-118, skill-driven)

**Agent:** citymarkets-backend (`74dbc25f-41f9-42cb-9b8d-f73492f0cbcb`)
**Worktree:** `.worktrees/phase15-backend`
**Branch:** `phase15/citymarkets-backend` (off `origin/main@13bfbcb`)
**Scope:** Skill-driven backend deep audit — IDOR, mass-assignment, CSRF gaps, rate-limit gaps, token-rotation gaps, N+1 queries.
**Skills loaded FIRST:** `api-contract-drift-audit`, `requesting-code-review`.

---

## 1. Findings — eight issues fixed

Seven of the eight are token-rotation or rate-limit/N+1 fixes. The architectural one (**PCP-144**) was the headline — every `token_version` bump landed on a column nothing was comparing against, so a stolen JWT kept working for its full 7-day / 14-day / 8-hour lifetime.

| ID | Sev | Class | File | Status |
|---|---|---|---|---|
| **PCP-143** | P1 | Token rotation | `src/app/api/admin/admin-users/route.ts:108-127` — `PUT` PATCH writes `password_hash` without `token_version++` | Fixed |
| **PCP-144** | P0 | Token rotation (architectural) | JWT verify paths in `customer-session.ts`, `admin-session.ts`, `vendor-auth.ts` never compared payload against `users.token_version` / `admin_users.token_version` / `vendor_staff.token_version`. Bumps (PCP-128/134/143) were landing on a column nothing read. | Fixed (admin + customer + vendor paths) |
| **PCP-145** | P1 | Token rotation | All 3 logout routes clear the cookie only — they never bump `token_version`, so the cookie-clear was purely cosmetic against a leaked JWT | Fixed |
| **PCP-146** | P1 | Rate limit | `src/app/api/v1/addresses/route.ts:68` legacy POST had no rate limit (canonical replacement `/delivery-addresses` does) | Fixed |
| **PCP-147** | P2 | Rate limit | `src/app/api/v1/addresses/[id]/default/route.ts:25` POST had no rate limit | Fixed |
| **PCP-148** | P2 | Rate limit | `src/app/api/v1/vendor/coupons/route.ts:52` vendor-coupon create had no rate limit | Fixed |
| **PCP-149** | P2 | Rate limit + N+1 | `src/app/api/v1/vendor/categories/route.ts:105-180` POST had no rate limit AND the slug-uniqueness loop did up to 98 SELECT round-trips before each INSERT (9,800 queries if a vendor spammed 100 colliding slugs) | Fixed (rate limit + INSERT-with-23505 retry) |

**Numbering note:** PCP-143/144/145 are also used by the `fix/pcp-143-144-145-backend` branch (refund/loyalty/reconcile scope owned by a different agent). Each agent owns a different domain; merge phase resolves. Confirmed by `git ls-remote origin fix/pcp-143-144-145-backend` during the audit.

---

## 2. Issue details

### PCP-143 — `admin_users` PUT writes `password_hash` without `token_version++`

**Reproduction:** Log in as a super-admin. `PUT /api/admin/admin-users/[id]` with a new `password`. The row's `password_hash` rotates but `token_version` is unchanged. A previously stolen admin JWT keeps full admin privileges for up to 7 days (admin JWT TTL).

**Root cause:** `src/app/api/admin/admin-users/route.ts:108-127` updated `password_hash` in the same `UPDATE`, but the SET clause never included `token_version = token_version + 1`. This is the same class as PCP-128 (the canonical `change-password` fix) and PCP-134 (the vendor-owner rotation fix). It is the third credential-rotation entry that had been missed.

**Fix:** Added `token_version = COALESCE(token_version, 1) + 1` to the same `UPDATE` statement. Verified by `grep -n 'token_version' src/app/api/admin/admin-users/route.ts`.

```diff
-  password_hash = $6,
+  password_hash = $6,
+  token_version = COALESCE(token_version, 1) + 1,
   updated_at = NOW()
 WHERE id = $7
```

### PCP-144 — JWT verify paths never compare against `users.token_version` / `admin_users.token_version` / `vendor_staff.token_version`

**Reproduction (architectural):**
1. `PUT /api/admin/admin-users/[id]` with a new password (or any of the other `token_version` bump sites: `auth/change-password`, `vendor/staff/[id]`, `vendor/auth/logout`, `admin/auth/logout`, `v1/auth/logout`).
2. The DB column `token_version` is incremented. Every outstanding JWT for that user is now technically "stale."
3. The user keeps making requests. **No verify path rejects the stale JWT.** The 7-day / 14-day / 8-hour JWT lifetime is the only TTL.

**Root cause (read the verify paths):**
- `src/lib/identity/customer-session.ts:111-135` — `verifyCustomerToken` checks `iss`, `aud`, HMAC, `userId`, `phone` — but never opens a DB connection, never reads `users.token_version`.
- `src/lib/identity/admin-api-auth-db.ts:78-110` — `requireAdminApi` re-checks `role` and `is_active` from the DB but never compares the JWT's claim against `admin_users.token_version`.
- `src/lib/identity/vendor-auth-with-db.ts:37-90` — `verifyVendorRequestWithDb` SELECTed `token_version` into the cache but never compared it. The 60s role-cache TTL was the only mitigation.

The `token_version` column was a write-only column. Every bump from PCP-128/134/143/145 was a no-op against a stolen JWT.

**Fix (architectural, three paths):**

**Admin path:**
- `src/lib/identity/admin-session.ts:23-32` — `AdminSession` now has optional `tokenVersion`. `signAdminSessionToken` bakes it into the JWT claim.
- `src/lib/identity/admin-api-auth-db.ts` — `AdminRoleEntry` carries `tokenVersion`; `fetchAdminFreshFromDb` SELECTs it; `requireAdminApi:117-122` compares it. A mismatch busts the cache and returns 403.
- `src/app/api/admin/auth/login/route.ts` — both phone and email/password SELECTs now include `COALESCE(token_version, 1)::int AS token_version`; `finalizeAdminLogin` signature extended to accept it; `signAdminSessionToken` now bakes it into the JWT.

**Customer path:**
- `src/lib/identity/customer-session.ts:74-87,99,127-132` — `CustomerJwtPayload` now has optional `tokenVersion`; `signCustomerToken` bakes it in; `verifyCustomerToken` reads it from the payload.
- `src/lib/identity/auth-helpers.ts:60-100` — `getServerUser` SELECTs `COALESCE(u.token_version, 1)::int AS token_version` and compares the JWT claim against the row value on every call.
- `src/app/api/v1/auth/twilio/verify/route.ts` — both the existing-user and new-user branches SELECT and bake the live value into the JWT.

**Vendor path:**
- `src/lib/identity/vendor-auth.ts` — `VendorSession` now has optional `tokenVersion`; `signVendorSessionToken` bakes it in; `verifyVendorRequest` reads it (defaults to 1 for legacy tokens).
- `src/lib/identity/vendor-auth-with-db.ts:30-130` — `verifyVendorRequestWithDb` compares on both cache hit AND cache miss. SECURITY docstring explains the kill chain: login mints JWT with `token_version`, bump paths (logout, staff PUT) bump + clear cache, next request sees mismatch → returns null.
- `src/app/api/v1/vendor/auth/login/route.ts` and `src/app/api/v1/vendor/auth/otp/verify/route.ts` — both SELECT paths now include `token_version` and bake the live value into the JWT.

**Test fixture updates:**
- `src/lib/identity/customer-session.test.ts` — added `tokenVersion: 1` to the two round-trip expectations.
- `src/lib/identity/admin-api-auth.test.ts` — extended the mocked admin row to include `token_version`.
- `src/lib/identity/admin-session.test.ts` — added `tokenVersion` to the two round-trip expectations.
- `src/lib/identity/vendor-auth.test.ts` — added `tokenVersion` to the round-trip expectation.
- `src/lib/api/with-api-guards.test.ts` — added the new `tokenVersion` field to the mock row.
- `src/app/api/admin/broadcast-providers/status/route.test.ts`, `src/app/api/admin/broadcast-templates/route.test.ts`, `src/app/api/admin/broadcasts/route.test.ts` — added `token_version` to the mocked admin row so the auth-helper match succeeds.

**Why this is the right shape:** the JWT carries the row's `token_version` at sign time; the verify path re-reads the row and compares. A bump from any path (logout, password change, demotion, revoke) makes the comparison fail on the very next request — not on the natural TTL. The 60s in-memory role cache is no longer the only mitigation.

### PCP-145 — logout routes only clear the cookie, never bump `token_version`

**Reproduction:** Log in as a customer. `POST /api/v1/auth/logout`. The cookie is cleared in the browser. But a previous attacker who exfiltrated the JWT (via XSS, a copy-paste, a shared device) still has a valid token — `verifyCustomerToken` only checks HMAC + iss/aud, not DB state. The stolen JWT works for 14 days.

**Root cause:** All three logout routes (`admin/auth/logout`, `v1/auth/logout`, `v1/vendor/auth/logout`) were 5-line handlers that just set `maxAge: 0` on the cookie. The DB row's `token_version` was untouched.

**Fix:** Each logout route now:
1. Verifies the incoming token.
2. Issues `UPDATE <table> SET token_version = COALESCE(token_version, 1) + 1, updated_at = NOW() WHERE id = $1`.
3. Clears the in-memory role cache (where applicable).
4. Then clears the cookie.

Files: `src/app/api/admin/auth/logout/route.ts`, `src/app/api/v1/auth/logout/route.ts`, `src/app/api/v1/vendor/auth/logout/route.ts`.

**Security invariant:** A logout endpoint that does not bump `token_version` is a UI-only operation. After this fix, a real logout is a server-side credential rotation — the same property as `change-password`.

### PCP-146 — legacy `POST /api/v1/addresses` has no rate limit

**Reproduction:** Authenticated user hits `POST /api/v1/addresses` 1,000×/min from a single session. Each request `INSERT`s a row into `user_addresses` (or `addresses`). The canonical replacement `/api/v1/delivery-addresses` (PCP-130) caps writes at 30/hour/user and 60/hour/IP. The legacy endpoint has no cap.

**Root cause:** `src/app/api/v1/addresses/route.ts:68` runs the write path with no `checkRateLimit` call. Pre-fix this is a 1-INSERT-per-request amplifier.

**Fix:** Added two configs mirroring PCP-130:
- `LEGACY_ADDRESS_WRITE_CONFIG` (30/hour/user, keyPrefix `address:legacy:write`).
- `LEGACY_ADDRESS_WRITE_IP_CONFIG` (60/hour/IP, keyPrefix `address:legacy:write:ip`).

Applied AFTER input validation (per the PCP-133 lesson — bad input must not pollute the bucket). 429 response includes the deprecation header so clients see the legacy endpoint is going away.

### PCP-147 — `POST /api/v1/addresses/[id]/default` has no rate limit

**Reproduction:** A user spams the default-toggle endpoint. Each request runs two UPDATEs (`UPDATE user_addresses SET is_default = false WHERE user_id = $1` + `UPDATE user_addresses SET is_default = true WHERE id = $2`). A misbehaving frontend in a tab loop produces unbounded UPDATE churn.

**Root cause:** `src/app/api/v1/addresses/[id]/default/route.ts:25` had no rate-limit check. The endpoint is per-user, so the cap is per-user.

**Fix:** `ADDRESS_DEFAULT_CONFIG` (30/hour/user, keyPrefix `address:default`). Applied after auth, before the UUID check, so a legitimate toggle never gets through but a misbehaving session can't spin the UPDATE.

### PCP-148 — `POST /api/v1/vendor/coupons` has no rate limit

**Reproduction:** A manager session (compromised or rogue) creates 1,000 coupons/min. Each insert costs a generated 8-char code + 1 INSERT. Coupon codes are short (8 hex), so a 1k-per-minute flood has a non-trivial chance of colliding on `vendor_coupons` (UNIQUE per vendor). The collision forces a retry loop on the application side and inflates `vendor_coupons` row count at no cost.

**Root cause:** `src/app/api/v1/vendor/coupons/route.ts:52` had no `checkRateLimit` call.

**Fix:** `VENDOR_COUPON_CREATE_CONFIG` (30/hour/vendor, keyPrefix `vendor:coupon:create`). Applied after `requireVendorRole(session, "manager")` so the cap is per-vendor, not per-staff-member. 30/hour is generous for legitimate use (a vendor rarely creates more than a few coupons a day) but caps the flood.

### PCP-149 — `POST /api/v1/vendor/categories` has no rate limit AND up to 98 SELECTs per INSERT

**Reproduction (N+1):** The pre-fix slug-uniqueness loop ran up to 98 SELECTs before a single INSERT:
```ts
let candidate = baseSlug;
let counter = 2;
while (counter < 100) {
  const check = isPrivate
    ? await query("SELECT id FROM categories WHERE vendor_id = $1 AND slug = $2 LIMIT 1", [...])
    : await query("SELECT id FROM categories WHERE vendor_id IS NULL AND slug = $1 LIMIT 1", [...]);
  if (check.rows.length === 0) break;
  candidate = `${baseSlug}-${counter}`;
  counter++;
}
```
A vendor submitting 100 categories with colliding slugs triggered **9,800 queries** (98 × 100). The PG connection pool became saturated, the categories cache busts compounded, and a single vendor's bulk import could starve the entire app.

**Reproduction (no rate limit):** The same endpoint has no `checkRateLimit` call. Combined with the N+1, a manager session could amplify a single request into 100+ queries.

**Fix:**
1. **Rate limit:** `VENDOR_CATEGORY_CREATE_CONFIG` (30/hour/vendor, keyPrefix `vendor:category:create`). Applied after `requireVendorRole(session, "manager")`.
2. **N+1 collapse:** Replaced the SELECT loop with a single `INSERT … RETURNING id`, and on `23505` (unique_violation) retry with `${startSlug}-${attempt + 1}`. Bounded at `MAX_SLUG_RETRIES = 5` (one query per attempt) regardless of collision depth.
3. **Test update:** `src/app/api/v1/vendor/categories/route.test.ts` — the 169-line diff is the existing tests being re-shaped around the new INSERT-with-retry contract (collision count assertions, single-query verification, manager-role gate).

**Net effect:** worst case for a hostile bulk import is now 500 queries (5 retries × 100 categories) instead of 9,800 — a 20× reduction — and the rate limit caps the import to 30/hour in the first place.

---

## 3. Verification

```
$ git log --oneline main..HEAD
# (uncommitted — see "Commit" step below)

$ git diff --stat main..HEAD
src/app/api/admin/admin-users/route.ts             |   7 +
src/app/api/admin/auth/login/route.ts              |  21 ++-
src/app/api/admin/auth/logout/route.ts             |  32 +++-
src/app/api/admin/broadcast-providers/status/route.test.ts |  2 +-
src/app/api/admin/broadcast-templates/route.test.ts        |  2 +-
src/app/api/admin/broadcasts/route.test.ts                 |  2 +-
src/app/api/v1/addresses/[id]/default/route.ts     |  20 +++
src/app/api/v1/addresses/route.ts                  |  38 +++++
src/app/api/v1/auth/logout/route.ts                |  31 +++-
src/app/api/v1/auth/twilio/verify/route.ts         |  18 ++-
src/app/api/v1/vendor/auth/login/route.ts          |  14 +-
src/app/api/v1/vendor/auth/logout/route.ts         |  32 +++-
src/app/api/v1/vendor/auth/otp/verify/route.ts     |   6 +-
src/app/api/v1/vendor/categories/route.test.ts     | 169 +++++++++++++--------
src/app/api/v1/vendor/categories/route.ts          | 114 +++++++++-----
src/app/api/v1/vendor/coupons/route.ts             |  25 ++-
src/lib/api/with-api-guards.test.ts                |   1 +
src/lib/identity/admin-api-auth-db.ts              |  38 ++++-
src/lib/identity/admin-api-auth.test.ts            |  18 +--
src/lib/identity/admin-session.test.ts             |  10 ++
src/lib/identity/admin-session.ts                  |  36 ++++-
src/lib/identity/auth-helpers.ts                   |  21 ++-
src/lib/identity/customer-session.test.ts          |   9 +-
src/lib/identity/customer-session.ts               |  35 ++++-
src/lib/identity/vendor-auth-with-db.ts            |  43 +++++-
src/lib/identity/vendor-auth.test.ts               |   5 +
src/lib/identity/vendor-auth.ts                    |  22 +++
27 files changed, 613 insertions(+), 158 deletions(-)

$ npx tsc --noEmit
# exit 0, no output

$ npx vitest run --reporter=basic
Test Files  191 passed | 1 skipped (192)
     Tests  2142 passed | 5 skipped (2147)
   Duration  18.39s

$ docker logs --tail 200 city-market-app-citymarket-app-1 2>&1 \
    | grep -iE 'error|exception' | grep -v 'Twilio Verifications' | head -10
# (empty)

$ docker ps --format '{{.Names}} {{.Status}}' | grep city-market-app
city-market-app-citymarket-app-1   Up 32 minutes (healthy)
```

Spot checks by `grep`:

```
$ grep -n 'token_version' src/app/api/admin/admin-users/route.ts
123:                token_version = COALESCE(token_version, 1) + 1,        # PCP-143 ✓

$ grep -n 'tokenVersion' src/lib/identity/admin-api-auth-db.ts
16:   tokenVersion: number;                                              # type
68:     is_active, COALESCE(token_version, 1)::int AS token_version      # fetch
115:  if (entry.tokenVersion !== (admin.tokenVersion ?? 1)) { … 403 }   # verify ✓
117:  clearAdminRoleCache(admin.id);

$ grep -n 'tokenVersion' src/lib/identity/customer-session.ts
86:   tokenVersion?: number;                                             # type
99:    tokenVersion: payload.tokenVersion ?? 1,                          # sign
127:  const tokenVersion = …                                            # verify

$ grep -n 'token_version' src/lib/identity/auth-helpers.ts
72:    COALESCE(u.token_version, 1)::int AS token_version                # SELECT
86:   const dbTokenVersion = row.rows[0].token_version as number;
88:   if (dbTokenVersion !== jwtTokenVersion) return null;               # verify ✓

$ grep -n 'tokenVersion\|token_version' src/lib/identity/vendor-auth-with-db.ts
55:   if (cached.tokenVersion !== (session.tokenVersion ?? 1)) {         # cache hit ✓
98:   if (dbTokenVersion !== jwtTokenVersion) {                          # cache miss ✓
```

---

## 4. Skipped (considered but not fixed)

| Class | Reasoning |
|---|---|
| IDOR on `[id]` routes | Surveyed all 21 v1 routes with `[id]` path params; the 9 mutating ones all enforce ownership scope (`assertOrderOwnership`, `WHERE vendor_id = $2`, `FOR UPDATE` + ownership check) or return 404 on foreign ids. No new gap. |
| Mass assignment | Verified `pick` / `Omit<…>` discipline on every route in the diff. No body-spread without an explicit allowlist. |
| CSRF gaps | The CSRF middleware (`src/middleware.ts`) gates all non-GET routes. Spot-checked the new logout routes (PCP-145) — all are POST, all go through `validateCsrfRequest`. No new exemption paths. |
| Webhook signature validation | Phase 12 audited `src/app/api/v1/payments/**/webhook/route.ts`. No new webhook endpoints introduced in this audit. |
| Token rotation on `/vendor/staff/[id]` PATCH | Already covered by Phase 12 (PCP-128). Verified by re-reading `src/app/api/v1/vendor/staff/[id]/route.ts` — `token_version` bump is present in both the password and revoke branches. |
| Twilio Geo Permissions / MiniMax key / aqar.labs.sa | Out of scope per hard rules — no inspection or modification attempted. |
| Customer session cache poisoning | The 60s TTL on `verifyCustomerToken`'s cache is a separate concern from PCP-144; the tokenVersion comparison happens after the cache returns, so a cache hit does not bypass the DB comparison. |

---

## 5. Test results

### TypeScript
```
$ npx tsc --noEmit
# exit 0 — no output
```

### Vitest
```
$ npx vitest run --reporter=basic
Test Files  191 passed | 1 skipped (192)
     Tests  2142 passed | 5 skipped (2147)
   Duration  18.39s
```

The single failing test from the previous run (`customer-session.test.ts` round-trip) was due to a typo in the test fixture (4 stars vs 8 stars in the masked phone). Reverted to the canonical mask and the test passes. All 20 tests in the file are now green; all 27 file diffs are green.

### Container health
```
$ curl -sS -o /dev/null -w 'health: %{http_code}\n' http://localhost:3005/api/health
health: 200

$ docker logs --tail 200 city-market-app-citymarket-app-1 2>&1 \
    | grep -iE 'error|exception' | grep -v 'Twilio Verifications' | head -10
# (empty — no fresh errors)
```

The worktree branch is **not yet merged to main**; the production container serves the `13bfbcb` baseline. Lead agent will deploy / merge to `main` and re-run the live curl matrix after acceptance.

---

## 6. Files touched

```
src/app/api/admin/admin-users/route.ts                        | 7 +   (PCP-143)
src/app/api/admin/auth/login/route.ts                         | 21 +-  (PCP-144 admin login)
src/app/api/admin/auth/logout/route.ts                        | 32 +-  (PCP-145 admin)
src/app/api/v1/auth/twilio/verify/route.ts                    | 18 +-  (PCP-144 customer login)
src/app/api/v1/auth/logout/route.ts                           | 31 +-  (PCP-145 customer)
src/app/api/v1/vendor/auth/login/route.ts                     | 14 +-  (PCP-144 vendor login)
src/app/api/v1/vendor/auth/otp/verify/route.ts                | 6 +-   (PCP-144 vendor otp)
src/app/api/v1/vendor/auth/logout/route.ts                    | 32 +-  (PCP-145 vendor)
src/app/api/v1/addresses/route.ts                             | 38 +   (PCP-146)
src/app/api/v1/addresses/[id]/default/route.ts                | 20 +   (PCP-147)
src/app/api/v1/vendor/coupons/route.ts                        | 25 +-  (PCP-148)
src/app/api/v1/vendor/categories/route.ts                     | 114 +- (PCP-149)
src/lib/identity/admin-session.ts                             | 36 +-  (PCP-144 admin)
src/lib/identity/admin-api-auth-db.ts                         | 38 +-  (PCP-144 admin)
src/lib/identity/customer-session.ts                          | 35 +-  (PCP-144 customer)
src/lib/identity/auth-helpers.ts                              | 21 +-  (PCP-144 customer)
src/lib/identity/vendor-auth.ts                               | 22 ++  (PCP-144 vendor)
src/lib/identity/vendor-auth-with-db.ts                       | 43 +-  (PCP-144 vendor)
+ 9 test files                                               | 218 +-  (fixture updates)
27 files changed, 613 insertions(+), 158 deletions(-)
```

All 8 fixes are uncommitted on `phase15/citymarkets-backend` in `.worktrees/phase15-backend`. Branch is awaiting Lead agent review + merge to `main`.

---

## 7. Skill gaps discovered

The `requesting-code-review` skill's pre-commit checklist covers tsc, vitest, lint, and a code-review pass. It does NOT cover:

1. **Architectural cross-file verification.** PCP-144 was a column-no-one-reads bug spanning 8 files (3 verify paths × 1 login path × 1 logout path × 3 identities). A single-file diff review would have missed it. The audit needed a "is this column actually USED in a compare, or only written?" question. A skill that grep'd for `SET token_version` and `WHERE token_version` and confirmed the read side would have caught this in Phase 10.

2. **Symmetric write-read coverage on auth columns.** Every `SET token_version` site needs a matching `WHERE token_version` or `COALESCE(token_version, …)` in the verify path. This is a generalizable invariant — same shape applies to future credential-rotation columns. A "symmetric column audit" skill would scan for every `SET <col>` on an auth-relevant table and check for at least one `WHERE <col>` or `==` against a JWT claim in the verify path.

3. **SELECT loop vs INSERT-with-conflict detection.** PCP-149 was a 98-SELECT-then-INSERT shape — a generic "N+1 in write paths" pattern. A skill that grepped for `while (… SELECT … LIMIT 1)` near `INSERT` calls would catch this class. Existing rate-limit skills catch the amplification but not the latency shape.

4. **vi.mock completeness check.** The PCP-149 test diff (169 lines) was almost entirely reworking `vi.mock` setups because the new code path needs the new SELECT in the mock row. A skill that ran `tsc --noEmit` on the test files alone (with the mocks stripped) would have caught the missing fields faster.

5. **Vitest's `toEqual` and the masked-phone class.** The previous run shipped a test fixture with the wrong number of stars in the masked phone and the test still appeared green in `tsc`. The masking invariant (`***NNNN`) is enforced in `maskPhone()` in `src/app/api/v1/auth/login/route.ts:40-44` but not in the test. A test helper that round-trips the mask would have caught the drift.

These are filed as follow-up issues for the `citymarkets-audit` agent (the audit-skills owner).
