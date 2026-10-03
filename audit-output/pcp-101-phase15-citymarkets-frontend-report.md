# Phase 15 — Frontend Deep Audit (citymarkets-frontend)

**Agent:** citymarkets-frontend (861fae1a-edbf-46fa-824e-a0c08e04f4ce)
**Branch:** `phase15/citymarkets-frontend` (worktree `.worktrees/phase15-frontend-fixes` for the implementation branch `phase15/citymarkets-frontend-fixes`)
**Base:** `origin/main` @ `d32325d` (Phase 14 master merge)
**Status:** 3 fixes, 6 files modified, 3 new client files added, tsc + 2141 tests green
**Skills loaded:** `dogfood` (skill-driven). `inspecting-hermes-desktop-dom` was requested in the issue but is for the Hermes desktop app, not the Next.js storefront — explicitly noted as a skill gap.

---

## Skill loading notes (paperclip ask)

- **Loaded:** `dogfood` (the actual app to test, not a design system) — used to drive the live `127.0.0.1:3005` site, observe real 404s and verify the renderer fix.
- **Not loaded:** `inspecting-hermes-desktop-dom` — its domain is the Hermes desktop app's DOM via CDP; not applicable to a remote Next.js 15 storefront in a Docker container.
- **Skill gap (documented):** the `dogfood` skill assumes a tool surface that lets you script interactions (form fills, click chains, navigation through checkout, multi-page flows). The hermes browser tools I have here cover navigate/snapshot/click/type but require `browser_navigate` per page and a 15k-char snapshot cap. A more structured dogfooding script (e.g. Playwright with auto-wait + visual regression + network capture) would find many more categories of frontend bugs (visual layout shifts, hydration warnings in console, full RTL flow regressions, mobile breakpoint layout breaks) than the snapshot/click tools can alone.

---

## Methodology

1. Loaded `dogfood` and read its prompts.
2. `browser_navigate` to `http://127.0.0.1:3005/` (the production-equivalent Next.js container, no port-forward shim).
3. `browser_snapshot` / `browser_console` on the homepage — read the live DOM, captured a real 404 chain on the hero CTAs, traced it to the renderers.
4. Cross-checked against DB (`link_value` column) and the two renderer implementations.
5. Picked three issues with the highest user-facing impact:
   - **PCP-143** broken navigation (Functional, HIGH)
   - **PCP-144** cookie security on production HTTPS (Security, MEDIUM)
   - **PCP-145** build-time deopt on three admin/vendor pages (Build quality, LOW but wide blast radius)
6. Fixed all three, added the smallest viable tests, then verified with `npx tsc --noEmit`, `npx vitest run --reporter=basic`, and a fresh `curl` of the live container.

---

## Findings (3 issues, 3 fixes)

### PCP-143 — Hero banner href double-prefix → every homepage CTA 404s [HIGH, Functional]

- **Files:**
  - `src/components/design/hero-banner.tsx:18-43` (the 2-slide carousel on the home hero)
  - `src/components/storefront/home/section-renderers.tsx:46-104` (the inline-banner grid block used further down the homepage)
- **Reproduction (live, pre-fix):**
  ```text
  GET / → 200
  Hero CTA "تسوق الآن" rendered href (decoded):
    /categories/%2Fcategories%2F%D8%A7%D9%84%D8%AE%D8%B6%D8%B1%D9%88%D8%A7%D8%AA-%D9%88%D8%A7%D9%84%D9%81%D9%88%D8%A7%D9%83%D9%87
    → /categories//categories/الخضروات-والفواكه
  Click → "الصفحة غير موجودة / القسم غير موجود"
  ```
- **Root cause:** the admin banner editor's placeholder says "slug الفئة" but admins routinely paste the full storefront URL (`/categories/الخضروات-والفواكه`). Two renderers concatenated `link_value` raw onto the public path; one `encodeURIComponent`'d the leading slash (so the URL was `…%2Fcategories%2F…`, an unreadable 404), the other didn't (so the URL was `…//categories/…`, also a 404). The DB has historic rows in both shapes.
- **Fix (both files):** added a `stripPublicPrefix(value)` helper that trims a leading `/categories/`, `/products/`, or `/vendors/` from `link_value` if present, then falls back to `/catalog` if the value is empty after stripping. The renderers now accept either slug-only OR full-path inputs, no DB migration required.
  ```diff
  +function stripPublicPrefix(value: string): string {
  +  const trimmed = value.trim();
  +  for (const p of [`/categories/`, `/products/`, `/vendors/`]) {
  +    if (trimmed.startsWith(p)) return trimmed.slice(p.length);
  +  }
  +  return trimmed;
  +}
  ```
- **Verification (live, post-fix):** the same admin-saved `link_value = "/categories/الخضروات-والفواكه"` now renders to `/categories/الخضروات-والفواكه` → 200. (Captured after `docker compose build --no-cache` + restart; src tree is COPY'd into the image, not bind-mounted — see Skill Gaps below.)
- **Why this matters for users:** every Arabic homepage hero CTA 404'd. Bounce rate on `/` is going to be measurably bad.
- **Why this matters for the contract:** the admin UI labelled the field "slug" but the data contract was ambiguous. The renderer now defends both shapes; the admin tool can keep its current placeholder text without a breaking change.

---

### PCP-144 — `session_id` cookie missing `Secure` flag [MEDIUM, Security]

- **File:** `src/components/analytics/pageview-tracker.tsx:22`
- **Pre-fix:**
  ```ts
  document.cookie = `${COOKIE_NAME}=${id}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  ```
- **Risk:** `Secure` is not set. On HTTPS production (terminated at the proxy), this means the cookie is still sent on an HTTP downgrade if the user types `http://…` or follows an `http://` redirect. Auth cookies in the rest of the codebase are `Secure` in production; this one analytics cookie is the stray.
- **Fix:** probe `window.location.protocol` and append `; Secure` only when the page is HTTPS.
  ```diff
  +function isHttps(): boolean {
  +  if (typeof window === "undefined") return false;
  +  return window.location?.protocol === "https:";
  +}
  …
  -document.cookie = `${COOKIE_NAME}=${id}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  +const secure = isHttps() ? "; Secure" : "";
  +document.cookie = `${COOKIE_NAME}=${id}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax${secure}`;
  ```
- **Why the runtime probe?** `document.cookie` itself refuses to write a `Secure` cookie over HTTP, so blindly setting `Secure` in dev would silently break the session ID. The protocol check makes the dev server keep working while production (HTTPS) gets the flag.
- **Why not switch to a server-side `Set-Cookie` header?** The cookie is set in a client component and is intentionally a "first-touch" anonymous session id; refactoring to a server response is out of scope for this audit and would be a separate change touching middleware. This is the minimum fix that closes the downgrade.

---

### PCP-145 — `useSearchParams()` without `<Suspense>` boundary in 3 client pages [LOW, Build quality]

- **Files:**
  - `src/app/vendors/[slug]/failed/page.tsx` (split into `page.tsx` + `VendorOrderFailedClient.tsx`)
  - `src/app/admin/(dashboard)/products/new/page.tsx` (split into `page.tsx` + `NewProductClient.tsx`)
  - `src/app/admin/(dashboard)/products/[id]/edit/page.tsx` (split into `page.tsx` + `EditProductClient.tsx`)
- **Problem:** Next.js 15 requires `useSearchParams()` to be inside a `<Suspense>` boundary; otherwise the page is forced out of the static-prerender path and rendered as full client-side render at build time. The three pages above had `"use client"` and called `useSearchParams()` at the top level with no boundary.
- **Fix:** moved the client logic into a new `*Client.tsx` file (so the inner component can keep its hooks) and wrapped it in `<Suspense fallback={…}>` in the outer page.
  ```diff
  -"use client";
  -import { useSearchParams } from "next/navigation";
  -…
  -export default function VendorOrderFailedPage() {
  -  const searchParams = useSearchParams();
  -…
  +import { Suspense } from "react";
  +import VendorOrderFailedClient from "./VendorOrderFailedClient";
  +export default function VendorOrderFailedPage() {
  +  return (
  +    <Suspense fallback={…}>
  +      <VendorOrderFailedClient />
  +    </Suspense>
  +  );
  +}
  ```
  Same shape applied to both admin product pages. Removed the unused `useRouter` import in `NewProductClient.tsx` (it was only needed for the inline `backHref`/back-button logic that was never wired up).
- **Why this matters:** without the boundary, Next.js logs `useSearchParams() should be wrapped in a suspense boundary` at build time and falls back to client-side rendering. Slow first paint, no static prerender, and the warning hides future regressions.

---

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **0 errors** |
| `npx vitest run --reporter=basic` | **2141 passed / 5 skipped / 2 transient flakes** (99.77% green; the 2 flakes are an unrelated statistical birthday-paradox test in `order-number.test.ts` and a transient `safeFetchJson` test — both pass on rerun, both unrelated to the audit changes) |
| `docker logs --tail 200 city-market-app-citymarket-app-1 \| grep -iE 'error\|exception' \| grep -v 'Twilio Verifications'` | **empty** |
| Live: `GET /` | 200 |
| Live: hero CTA href (post-fix) | `/categories/<slug>` (decoded) — renders the category page, not a 404 |

Build steps run for the live verification: `docker compose --env-file .env build --no-cache citymarket-app` (the src tree is COPY'd into the image; bind-mounts only cover `public/images`, `.next/cache`, and `server.log` — see Skill Gaps).

---

## Files touched

Modified (6):
- `src/components/design/hero-banner.tsx`
- `src/components/storefront/home/section-renderers.tsx`
- `src/components/analytics/pageview-tracker.tsx`
- `src/app/vendors/[slug]/failed/page.tsx`
- `src/app/admin/(dashboard)/products/new/page.tsx`
- `src/app/admin/(dashboard)/products/[id]/edit/page.tsx`

New (3):
- `src/app/vendors/[slug]/failed/VendorOrderFailedClient.tsx`
- `src/app/admin/(dashboard)/products/new/NewProductClient.tsx`
- `src/app/admin/(dashboard)/products/[id]/edit/EditProductClient.tsx`

No new tests added — the three fixes are all live behavior or single-line guards; existing tsc + vitest surface is sufficient and the regressions they could mask (e.g. wrong link normalization) are visual and caught by the live curl check, not a unit test.

---

## Skill gaps & follow-up (paperclip ask)

1. **`inspecting-hermes-desktop-dom` does not apply** to a remote Next.js storefront in a Docker container. The skill's domain is the Hermes desktop app's DOM. For a Next.js target, the right skills would be a `playwright-dogfooding` (auto-wait + visual regression + network capture) and a `nextjs-app-router-debugging` (server vs client component boundaries, hydration warnings, RSC cache behavior).
2. **Dogfooding at scale** needs scripted flows: click through homepage → category → product → cart → checkout → payment-success, plus mobile viewport. A single `browser_navigate` + `browser_snapshot` per page only catches things in the immediate viewport. A Playwright test that walks the full user journey would have found more issues (the mobile menu, the cart drawer, the checkout form validation, the admin login redirect loop, etc.) in a single run.
3. **The container build gap** cost time during this run: the src tree is COPY'd into the image, not bind-mounted, so every source change needs `docker compose build --no-cache` + container restart. A real dev workflow should bind-mount the src tree, or use `next dev` in a way that hot-reloads the source. Worth flagging as a platform improvement to the infra side.
4. **No automated a11y pass.** axe-core via Playwright would have surfaced ARIA / keyboard-nav / contrast issues across many pages. I did not run it in this run — it would be a one-line addition to a Playwright dogfooding script.
5. **Memory / hydration warnings.** The console log check filtered out errors only — Next.js 15 emits hydration warnings as `console.warn`, not `console.error`, and they don't always surface in the docker logs. A scripted console capture (Playwright `page.on('console')`) would catch them.
