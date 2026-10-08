# Phase 11 Audit Report — citymarkets.sa

Generated: 2026-10-02 21:04:34 UTC

## Scope

Following the user's prompt: "حل كل المشاكل وابحث عن مشاكل جديدة للنظام"
("Fix every problem and find new ones"). This phase picks up from Phase 10
(PCP-118 + tracked follow-ups) and:

1. **Fixes** the open follow-ups from Phase 10 (PCP-119, PCP-123,
   PCP-124, PCP-125) and one from Phase 8 (PCP-120 was already
   partially mitigated by the CASE-WHEN in reconcile-payment).
2. **New findings** discovered while implementing the fixes and during
   a follow-up pass on auth, upload, and middleware layers.

## Fixes delivered this phase

### PCP-119: Migrate 16 list endpoints to parsePagination helper (f44181b)

Routes migrated to the central `parsePagination(searchParams, {...})`
helper introduced in PCP-118 (44ee75a):

| Layer | Routes |
|---|---|
| **v1** | products, offers, blog, reviews, vendors/[slug]/products |
| **admin** | orders, products, offers, broadcasts, abandoned-carts, driver/orders, driver/orders/history, orders/direct |
| **vendor** | products, orders, dashboard/recent-orders |

Effect: every list route now rejects `limit=999999`, `limit=-1`,
`limit=abc`, and empty values with `DEFAULT_LIMIT=50`. 18 routes now use
the helper (up from 2 after PCP-118).

### PCP-123: Upload origin trust (f704b77)

**Bug**: `/api/admin/upload` trusted `x-forwarded-origin` and `origin`
headers when building the `localImageUrlAbsolute` that gets stored in
`products.image_url`. An attacker could spoof these to make the stored
URL point at their own server.

**Risk**: stored image_url poisoning. Not exploitable for XSS (browser
sanitises `<img src>`) but the DB row would reference attacker infra
and the R2 mirror upload would push our images to the attacker's
allowed origin set.

**Fix**: extracted `buildLocalImageUrl(request, path)` helper that
derives origin from `new URL(request.url).origin` only — the server's
own bound URL, not whatever the client claims.

**Tests**: 4 new unit tests for x-forwarded-origin, origin header,
trailing-slash, and HTTPS preservation.

### PCP-124: Vendor login rate limit (f704b77)

**Bug**: `/api/v1/vendor/auth/login` had no rate limit. The
customer-side `/api/v1/auth/login` is rate-limited and so is
`/api/admin/auth/login`, but the vendor staff login was not.

**Risk**: brute-force of `vendor_staff.password_hash` at network speed.
Bcrypt rounds slow each attempt but the staff table is small enough
that a determined attacker can iterate through every vendor's owner
account.

**Fix**: new `VENDOR_LOGIN_CONFIG` (5/identifier/15min) +
`VENDOR_LOGIN_IP_CONFIG` (10/IP/15min) in `src/lib/rate-limit.ts`.
Mirrors the admin login rate limit shape. Wired in BEFORE the vendor
lookup so the response code (404 vs 401) can't be used to enumerate
which (vendor, identifier) combos exist.

**Tests**: 1 new test verifies 5/identifier → 401, 6th → 429.

### PCP-125: Reviews rate limit (c62f428)

**Bug**: `REVIEW_SUBMIT_IP_CONFIG` (5/min/IP) was defined in
`src/lib/rate-limit.ts` during Phase 2 but the reviews route was
never wired to call it.

**Risk**: a single IP can flood `product_reviews` with fake reviews
at network speed. Combined with the auto-approve
(`is_approved=true` in the INSERT), this would let an attacker
manipulate the displayed rating for any product within minutes.

**Fix**: 429 gate at the top of `POST /api/v1/reviews`, before auth
+ DB. New test verifies the 5-then-429 contract.

## Live verification (deployed image `f42590de7e28`)

```
=== 1. Reviews rate limit (PCP-125) — should 429 after 5 ===
  attempt 1: 401
  attempt 2: 401
  attempt 3: 401
  attempt 4: 401
  attempt 5: 401
  attempt 6: 429
  attempt 7: 429
```

The first 5 attempts hit the auth check (returns 401 because we
don't have a session). The 6th hits the rate-limit gate (returns
429) — exactly the right order.

## Test stats

- 2,060 / 2,065 pass + 5 skipped + 1 pre-existing delivery/slot flake
- tsc: 0 errors
- New tests added: 6 (4 for PCP-123, 1 for PCP-124, 1 for PCP-125)

## Commits this phase

| SHA | Subject |
|---|---|
| `f44181b` | refactor(api): migrate 16 list endpoints to parsePagination helper (PCP-119) |
| `f704b77` | fix(security): PCP-123 origin trust + PCP-124 vendor login rate limit |
| `c62f428` | fix(security): wire REVIEW_SUBMIT_IP_CONFIG into reviews POST (PCP-125) |

## Open issues (non-blocking, tracked)

| # | Title | Severity |
|---|---|---|
| PCP-115 | app_migrations has 3 duplicate numeric prefixes (041, 059, 060) | P2 |
| PCP-120 | checkout UPDATE without FOR UPDATE (mitigated by CASE-WHEN) | P3 |
| PCP-121 | UUID rejection inconsistent (404 vs 400) | P3 |
| PCP-122 | `/api/v1/search` dead endpoint | P3 |
| PCP-127 | seq_scan on `products` (indexes exist, few admin queries do full scan) | P3 |

## Items requiring user action (outside the codebase)

- **Twilio Verify Geo Permissions for SA**: enable in Twilio Console
- **aqar.labs.sa SSL 525**: Cloudflare-side, not origin
- **MiniMax API key rotation** (was pasted in chat history)
