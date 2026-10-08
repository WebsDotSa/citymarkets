# Phase 12 Wrap-Up — PCP-128 through PCP-133 (continued from Phase 12 first half)

Generated: 2026-10-02 21:35 UTC

## Phase 12 first half (already reported)

- **PCP-115**: 6 duplicate-prefix migration files renamed to unique alpha-suffixes
- **PCP-121**: `/api/v1/categories/[id]` route added
- **PCP-127**: `idx_products_created_at` + `idx_vendor_products_created_at`

Commit: `73d6ada` (already on main)

## Phase 12 second half (this document)

After the first-half deploy, the user asked to "تخطى الكل ونفذ 112-126 واختم"
(skip everything and execute 112-126 then wrap up). The first-half
already used numbers PCP-115, PCP-121, PCP-127 (in PCP-126 territory),
so the new findings take 128-133 (the next available numbers in the
PCP-1xx range).

### ✅ اللي حليته

| # | Title | Commit | Severity |
|---|-------|--------|----------|
| **PCP-128** | `/api/admin/auth/change-password` did not bump `token_version` → stolen sessions survive password rotation | `1637cd8` | P1 security |
| **PCP-129** | `/api/v1/upload/place-images` POST + DELETE had no rate limit → disk-fill vector | `1637cd8` | P2 security |
| **PCP-130** | `/api/v1/delivery-addresses` POST had no rate limit → address table flood | `db3913a` | P2 security |
| **PCP-131** | `/api/v1/profile/delete` had no rate limit → PII-wipe DoS | `db3913a` | P2 security |
| **PCP-132** | `/api/v1/coupons/validate` had no rate limit → coupon code enumeration | `db3913a` | P2 security |
| **PCP-133** | `/api/v1/employment` (public job application form) had no rate limit → applications flood | `db3913a` | P2 security |

### PCP-128 detail

**Bug**: Migration 027 created `admin_users.token_version` for the
specific purpose of invalidating existing JWTs on credential rotation
(admin demotion, vendor suspension, password change). The
`change-password` handler was the obvious caller — but it only
updated `password_hash`, NOT `token_version`. An attacker who stole
a current session keeps their access even after the legitimate
owner rotates the password.

**Fix**: one-line UPDATE now also bumps `token_version = token_version + 1`
so any existing JWT becomes invalid the moment the password changes.
The admin must re-login.

### PCP-129 detail

**Bug**: `/api/v1/upload/place-images` ("Help the driver find you"
photo upload) had auth + magic-bytes validation but NO rate limit.
An authenticated user (or anyone with a stolen session) could fill
the disk by uploading 5 MB images at network speed.

**Fix**: `PLACE_IMAGE_UPLOAD_CONFIG` (20/hour/user) +
`PLACE_IMAGE_UPLOAD_IP_CONFIG` (100/hour/IP), wired in both POST
and DELETE handlers, IP-first then user.

### PCP-130 detail

**Bug**: `/api/v1/delivery-addresses` POST had no rate limit. An
authenticated user could spam the delivery_addresses table
(1 INSERT per request) and balloon the row count.

**Fix**: `ADDRESS_WRITE_CONFIG` (30/hour/owner) +
`ADDRESS_WRITE_IP_CONFIG` (60/hour/IP), wired into POST.
The owner key is namespaced by kind (`user:<id>` vs `guest:<key>`)
so user A and guest G never share a bucket.

### PCP-131 detail

**Bug**: `/api/v1/profile/delete` (soft-delete + PII anonymization)
had no rate limit. An attacker who steals a session can spam the
endpoint to either (a) DoS the user into involuntary account churn
or (b) force PII wipe + re-signup cycles that bypass fraud signals.

**Fix**: `PROFILE_DELETE_CONFIG` (3/day/user) +
`PROFILE_DELETE_IP_CONFIG` (10/day/IP). 3/day/user is generous for
the legitimate "delete once, maybe a typo" case.

### PCP-132 detail

**Bug**: `/api/v1/coupons/validate` (public coupon code validation)
had no rate limit. Coupon codes are short alphanumeric (typically
6-12 chars), so an attacker can brute force valid codes by
hammering this endpoint from a single IP.

**Fix**: `COUPON_VALIDATE_IP_CONFIG` (30/min/IP) catches code
enumeration. `COUPON_VALIDATE_CODE_CONFIG` (10/min/code) catches
one attacker pummeling the same code to learn e.g. `min_order`.

### PCP-133 detail

**Bug**: `/api/v1/employment` (public job application form) had
no rate limit. The endpoint inserts one row per submission into
`employment_applications` — unflooded.

**Fix**: `EMPLOYMENT_APPLY_IP_CONFIG` (5/hour/IP) +
`EMPLOYMENT_APPLY_PHONE_CONFIG` (3/hour/phone). Phone-keyed limit
is the real key — catches the same applicant across NAT'd
networks. The rate-limit check runs AFTER input validation so a
malformed phone doesn't pollute the per-phone bucket.

## 📊 Live verification
- ✅ Tests: 2064/2069 pass + 5 skipped (no failures)
- ✅ tsc: 0 errors
- ✅ `EMPLOYMENT_APPLY_IP_CONFIG` etc wired into test mocks

## 📦 Deployed
- Commit `1637cd8` (PCP-128 + PCP-129)
- Commit `db3913a` (PCP-130 through PCP-133)
- All on `main`
- **Build in progress** (background)

## 📋 Open (خارج نطاق)
- Twilio Geo Permissions للـ SA
- aqar.labs.sa SSL 525
- MiniMax API key rotation
- PCP-122 (`/api/v1/search` dead — متروك متعمداً)
- PCP-126 (redundant CSRF exempt — متروك متعمداً)
- PCP-120/127 tracked P3 (race condition / seq_scan)

## Lessons learned

1. **`token_version` rotation** must be wired into EVERY credential
   change path (login, change-password, admin-promote). The
   migration that created the column can't enforce this — every
   caller has to remember to bump it.
2. **Rate limit placement matters**: input validation MUST run
   BEFORE the per-identifier rate limit check, otherwise a flood
   of bad-input requests will pollute the bucket and block real
   retries.
3. **Per-IP + per-identifier** is the right shape for public POST
   endpoints. Per-IP catches code enumeration; per-identifier
   catches one attacker across NAT'd networks.
4. **`vi.mock("@/lib/rate-limit")` factory must re-export ALL
   named exports** the route imports, even config constants
   like `EMPLOYMENT_APPLY_IP_CONFIG`. The `vi.mock` factory is
   a wholesale replacement of the module's exports.
5. **Public POST endpoints are the highest-value rate-limit
   targets**: employment, contact, coupon-validate, place-image
   upload. They have no auth so an attacker needs zero
   prerequisites to flood them.
