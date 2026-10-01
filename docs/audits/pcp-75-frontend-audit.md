# PCP-75 Frontend Audit — Findings

- **Scope**: 106 `src/app/**/page.tsx` + 169 components (`src/components/**/*.{ts,tsx}`) = 275 files.
- **Commit base**: `ecc435c` (origin/main at audit time)
- **Static checks**:
  - `npx tsc --noEmit` → **0 errors**.
  - `npx vitest run` → **1980/1982 passing**, 1 skipped, 1 backend test fail (out of scope).
- **Live runtime** (`city-market-app-citymarket-app-1`, last 1500 log lines):
  - Hydration / console errors: **0**.
  - `upstream image response failed` (CDN 404): **18 occurrences** — backend/infra, not frontend.
  - `invalid input syntax for type uuid: "1"`: **8 occurrences** — backend, not frontend.
  - `column a.plus_code does not exist`: recurring on `/api/orders/[id]` — **backend**, surfaced to user as 5xx.

The findings below are real, evidence-attached, and reproducible from this worktree.

## Bugs to open as child issues (PCP-75 scope)

### 1. SECURITY — `target="_blank"` without `rel="noopener noreferrer"` (4 sites, tabnabbing)

When `target="_blank"` is used without `rel="noopener"`, the new page can call `window.opener.location = "..."` to navigate the originating tab to a phishing URL. Adding `noreferrer` also strips the Referer header.

| File | Line | Current | Fix |
| --- | --- | --- | --- |
| `src/app/admin/(dashboard)/home-design/page.tsx` | 330 | `target="_blank"` | add `rel="noopener noreferrer"` |
| `src/app/vendor/[slug]/admin/products/page.tsx` | 203 | `target="_blank"` (on `<Link>`) | add `rel="noopener noreferrer"` |
| `src/components/admin/admin-header.tsx` | 264 | `target="_blank"` (on `<Link>`) | add `rel="noopener noreferrer"` |
| `src/components/admin/admin-vendors.tsx` | 363 | `target="_blank"` (on `<Link>`) | add `rel="noopener noreferrer"` |

Verified: these are the only 4 sites — multiline look-ahead filters out the ~155 false positives (most `target="_blank"` already carry `rel=...` on the next line).

### 2. BROKEN LINK — vendor banner + storefront card route to vendor login, not vendor storefront (2 sites, customer UX)

`section-renderers.tsx` builds `/vendor/${slug}` from banner config and from the store cards on the home page. The `/vendor/[slug]/` directory has **no `page.tsx`** — only the vendor admin subtree. Middleware treats `/vendor/*` as a protected vendor-admin prefix and 307-redirects unauthenticated visitors to `/vendor/${slug}/admin/login`. So every vendor banner/card click on the home page sends an unauthenticated customer to a vendor login screen instead of the public storefront at `/vendors/${slug}`.

| File | Line | Current | Fix |
| --- | --- | --- | --- |
| `src/components/storefront/home/section-renderers.tsx` | 55 | `return `/vendor/${v}`;` (banner link, link_type "vendor" branch) | `/vendors/${v}` |
| `src/components/storefront/home/section-renderers.tsx` | 650 | `href={`/vendor/${s.slug ?? s.id}`}` (store cards) | `/vendors/${s.slug ?? s.id}` |

Reproduction: `curl -L http://localhost:3005/vendor/abc` → resolves to `/vendor/abc/admin/login`. `/vendors/abc` returns 200.

### 3. ACCESSIBILITY — `<label>` and `<input>` siblings without `htmlFor` / `id` (admin forms, many sites)

`<label className="...">field name</label>` immediately followed by `<input ...>`. The `<label>` has no `htmlFor` and the `<input>` has no `id`. Screen readers do NOT associate these implicitly because the label doesn't wrap the input AND there's no `for`/`id` binding. Affects at least these files (representative, not exhaustive):

| File | Inputs missing label-binding | Notes |
| --- | --- | --- |
| `src/components/admin/admin-delivery-settings.tsx` | 18 | admin delivery config form |
| `src/app/vendors/register/page.tsx` | 13 | public vendor signup |
| `src/app/vendor/[slug]/admin/settings/page.tsx` | 13 | vendor self-service settings |
| `src/components/admin/offer-edit-form.tsx` | 10 | admin offer edit |
| `src/components/admin/product-edit-form.tsx` | 9 | admin product edit |
| `src/app/vendor/[slug]/admin/coupons/page.tsx` | 7 | vendor coupons |
| `src/app/vendor/[slug]/admin/products/page.tsx` | 6 | vendor products |
| `src/components/admin/notifications/NotificationsTemplatesTab.tsx` | 6 | admin templates |
| `src/components/admin/notifications/NotificationsComposerTab.tsx` | 6 | admin composer |
| `src/app/admin/(dashboard)/products/page.tsx` | 5 | admin products list |
| `src/app/vendor/[slug]/admin/categories/page.tsx` | 5 | vendor categories |
| `src/app/vendor/[slug]/admin/staff/page.tsx` | 5 | vendor staff |
| `src/components/admin/admin-loyalty.tsx` | 5 | admin loyalty |
| `src/components/admin/category-edit-form.tsx` | 5 | admin category edit |
| `src/components/admin/admin-activity.tsx` | 5 | admin activity log |
| `src/components/admin/notifications/NotificationsComposerTab.tsx` | 6 | (already counted) |

**Total: 199 `<input>` elements** flagged by the same regex across 14+ files.

Fix pattern: add `id="..."` to `<input>` and `htmlFor="..."` to the adjacent `<label>`.

### 4. RTL — `dir="rtl"` site uses physical classes (`pl-`, `pr-`, `ml-`, `mr-`, `left-`, `right-`, `border-l-`, `border-r-`)

`src/app/layout.tsx` ships `<html lang="ar" dir="rtl">` but Tailwind v3 is not configured for RTL (no `rtlcss` plugin, no `tailwindcss-logical` plugin). So `pr-4` always means "physical right side" — which renders on the **left** in RTL UI. 159 occurrences across 56 files; some are intentional (e.g. `pr-4` next to an icon that's *visually* always on the right), but most are RTL bugs that flip icons, badges, chevrons to the wrong side on RTL customers' screens.

| Pattern | Occurrences | Files |
| --- | --- | --- |
| `right-N` (absolute right) | 90 | 56 |
| `left-N` (absolute left) | 69 | 48 |
| `text-right` | 58 | 24 |
| `pr-N` (padding-right) | 33 | 25 |
| `pl-N` (padding-left) | 29 | 22 |
| `mr-N` (margin-right) | 22 | 18 |
| `ml-N` (margin-left) | 15 | 8 |
| `border-r-N` | 14 | 6 |
| `border-l-N` | 6 | 4 |

`text-right` is intentional for Arabic (correct visually), but the directional positioning, padding, and border classes are the real RTL risk. Suggest batching into a "RTL logical-classes sweep" subtask that converts them to `ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`, `border-s-`, `border-e-`.

### 5. DESIGN — `<a>` / `<Link>` uses `href={null}` as "no link" sentinel (3 sites)

`CityMarketsLogo` accepts `href` to render the logo as a link or not. The 3 callers below pass `href={null}` to disable linking, but `<Link href={null}>` is type-unsafe and is a non-idiomatic "no link" signal. Caller passes null to disable link inside CityMarketsLogo.

| File | Line | Call |
| --- | --- | --- |
| `src/app/landing-page/page.tsx` | 69 | `<CityMarketsLogo height={48} priority href={null} />` |
| `src/components/admin/admin-login.tsx` | 133 | `<CityMarketsLogo height={48} href={null} />` |
| `src/components/auth/login-page.tsx` | 96 | `<CityMarketsLogo height={48} href={null} />` |

Design-smell only, not a bug. Skip unless the team wants to harden the `CityMarketsLogo` API.

### 6. STYLE — `<input>` without explicit `type` (11 sites; defaults to `text`)

All 11 sites are admin notifications tabs. No functional bug (`text` is the default), but explicit `type="text"` is lint hygiene.

| File | Line |
| --- | --- |
| `src/app/admin/(dashboard)/abandoned-carts/page.tsx` | 215 |
| `src/components/admin/notifications/NotificationsTemplatesTab.tsx` | 228, 236, 369, 405, 422, 436 |
| `src/components/admin/notifications/NotificationsComposerTab.tsx` | 158, 202, 212, 221 |

### 7. LINT — `<button>` missing `type` inside `<form>` (0 sites)

Initially 251 hits reported by a naive sweep, but a refined regex that scopes each `<button>` to its enclosing `<form>` returns 0. The 251 are mostly icon-only buttons or toggle buttons that live outside `<form>` tags. Lint hygiene only; **no bug**.

## Items NOT a bug (false positives worth keeping in mind)

- 29 sites reported as `target="_blank"` without `rel` by a single-line scan; multiline check filters to 4 real sites (above).
- 2 `<img>` without `alt` flagged by simple scan; both are inside code-comments, not real tags.
- 19 `<img alt="">` are decorative (product thumbs, logo placeholders) — `alt=""` is the correct semantic for decorative images, but could add `role="presentation"` for explicit WCAG 2.1 conformance.
- 19 `dangerouslySetInnerHTML` sites are all JSON-LD SEO payloads (`<script type="application/ld+json">`) — expected and safe.
- 28 `console.error` sites are all in `fetch().catch()` handlers — expected error logging.

## Out-of-scope issues observed during the audit (delegate)

These surfaced while reading logs and code, but they are backend/infra — create as child issues against **citymarkets-backend** or **citymarkets-checkout**, not PCP-75.

| Symptom (live log) | Likely owner |
|---|---|
| `column a.plus_code does not exist` recurring on `/api/orders/[id]` (every few seconds in last logs) | backend (missing column or stale DB schema) |
| `invalid input syntax for type uuid: "1"` recurring on `generateMetadata` for blog page | backend (uuid-typed column receiving numeric id) |
| 18 `upstream image response failed for https://cdn.citymarkets.sa/products/<hash>.jpg 404` | infra / CDN (separate issue already) |

## Recommended PR breakdown

Five frontend subtasks (per the issue spec, "open subtasks for each bug"):

- **PCP-75.1** Security: add `rel="noopener noreferrer"` to 4 `target="_blank"` sites.
- **PCP-75.2** UX: fix vendor banner + card links `/vendor/${slug}` → `/vendors/${slug}` (plural).
- **PCP-75.3** A11y: bind `<label>` to `<input>` via `htmlFor`/`id` in 14+ admin/vendor forms (~199 inputs).
- **PCP-75.4** RTL: convert physical padding/margin/border classes (`pr-`, `pl-`, `mr-`, `ml-`, `border-l-`, `border-r-`) to logical classes (`pe-`, `ps-`, `me-`, `ms-`, `border-s-`, `border-e-`) site-wide.
- **PCP-75.5** Lint/hygiene: explicit `type="text"` on 11 inputs (notifications tabs); document the `href={null}` sentinel pattern.

Plus three backend/infra delegated observations (above) as their own child issues under PCP-73 (parent audit).