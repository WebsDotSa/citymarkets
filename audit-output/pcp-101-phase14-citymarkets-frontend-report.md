# Phase 14 — Frontend + UX Audit (citymarkets-frontend)

**Agent:** citymarkets-frontend (861fae1a-edbf-46fa-824e-a0c08e04f4ce)
**Branch:** `phase14/citymarkets-frontend`
**Base:** `origin/main` @ `29d1c93`
**Worktree:** `/var/www/citymarkets.sa/city-market-app/.worktrees/wt-citymarkets-frontend-phase14`
**Commit:** `f3e0831` — fix(security): PCP-134/135/136 — defense-in-depth XSS at render boundary
**Status:** 3 fixes, 1 new sanitizer test file, 1 extended test file, all green

---

## Findings (3 issues, all XSS defense-in-depth)

### PCP-134 — Blog page renders admin-authored HTML raw (P1, XSS)

- **File:** `src/app/blog/[slug]/page.tsx:135`
- **Reproduction:** Any legacy/imported blog post (or direct-SQL write that
  bypasses the API sanitizer) carrying `<iframe>`, `<svg onload=...>`,
  `<img onerror=...>`, or `javascript:` URIs is rendered verbatim by
  the page's `dangerouslySetInnerHTML`. The proxy CSP blocks classic
  `<script>` in modern browsers, but does not block same-origin
  authenticated API calls or older WebView quirks.
- **Fix:** Import and apply the central `sanitizeHtml()` at the render
  boundary:
  ```diff
  +import { sanitizeHtml } from '@/lib/sanitize-html';
  ...
  -dangerouslySetInnerHTML={{ __html: post.content_ar }}
  +dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.content_ar) }}
  ```
- **Commit:** `f3e0831`

### PCP-135 — HtmlBlockRenderer only strips `<script>`, misses real XSS surface (P1, XSS)

- **File:** `src/components/storefront/home/section-renderers.tsx:750-770`
- **Reproduction:** The `html_block` admin-layout block stores
  `content_html` raw (the admin route at `src/app/api/admin/home-layout/route.ts`
  does not sanitize on write). The renderer then "defends" with a
  regex that only removes `<script>` tags, leaving `<iframe>`,
  `<object>`, `<embed>`, `<svg onload=...>`, `<img onerror=...>`,
  and `javascript:` URIs wide open.
- **Fix:** Replaced the `<script>`-only regex with `sanitizeHtml()`:
  ```diff
  -dangerouslySetInnerHTML={{
  -  __html: content_html.replace(/<script[\s\S]*?<\/script>/gi, ""),
  -}}
  +dangerouslySetInnerHTML={{ __html: sanitizeHtml(content_html) }}
  ```
- **Commit:** `f3e0831`

### PCP-136 — Sanitizer protocol check is structurally broken (P0, XSS)

- **File:** `src/lib/sanitize-html.ts:106-107` (now `isDangerousUrl()`)
- **Discovered during:** PCP-135 test coverage. While pinning the
  sanitizer's contract I verified 4 real bypasses the old regex
  allowed through:
  1. `data:text/html;base64,...` — script-execution surface
  2. `data:image/svg+xml;base64,...` — SVG can carry active content
  3. `java\tscript:` / `java\nscript:` — tab/newline inside scheme
  4. `java\x00script:` — NUL byte inside scheme
- **Reproduction (pre-fix, via tsx probe):**
  ```
  IN : <a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>
  OUT: <a href="data:text/html;base64,..." rel="..." target="_blank">x</a>   ❌
  IN : <a href="java\tscript:alert(1)">x</a>
  OUT: <a href="java\tscript:alert(1)" rel="..." target="_blank">x</a>        ❌
  ```
- **Fix:** Replaced the two regex constants with a single
  `isDangerousUrl()` function that:
  - Strips ASCII control bytes (`\x00-\x1f`, `\x7f`) and whitespace
    from the URL before the protocol regex (closes the tab/newline/NUL
    bypass)
  - Tests `javascript`, `vbscript`, `file`, `mocha`, `livescript` against
    the normalized URL (case-insensitive)
  - Restricts `data:` URIs to raster image types only
    (`png|jpe?g|gif|webp`) — closes the `data:text/html` and
    `data:image/svg+xml` surfaces
- **Verified post-fix:**
  ```
  data:text/html base64               | ✅ blocked
  data:text/html raw                  | ✅ blocked
  data:image/svg+xml                  | ✅ blocked
  data:image/png safe                 | ✅ preserved
  mixed-case javascript:              | ✅ blocked
  tab in javascript:                  | ✅ blocked
  newline in javascript:              | ✅ blocked
  NUL in javascript:                  | ✅ blocked
  plain javascript:                   | ✅ blocked
  safe https                          | ✅ preserved
  ```
- **Commit:** `f3e0831`

---

## Test coverage added

- **`src/lib/sanitize-html.test.ts`** (new, 56 cases pinning the
  sanitizer's contract):
  - non-string input handling
  - safe formatting preservation
  - active-content neutralization (11 dangerous tags × 2 forms = 22)
  - event-handler neutralization (6 handlers + quoting variants)
  - dangerous URI schemes (5 schemes × 2 attrs = 10, plus 5 specific
    bypasses — data:text/html, data:image/svg+xml, tab/newline/NUL in
    javascript:, and the legitimate data:image/png)
  - attribute allowlist (style/data-* strip, forced rel/target on
    external <a>)
  - input length cap
  - realistic blog-content payloads (PCP-134)
  - realistic html-block payloads (PCP-135)
- **`src/components/storefront/home/section-renderers.test.tsx`**
  (extended, 6 new cases under `describe("PCP-135 — HtmlBlockRenderer
  XSS sanitization")`):
  - script tag strip (legacy regex behavior preserved)
  - iframe/object/embed/svg strip
  - img onerror handler strip
  - javascript:/vbscript: URI block in <a href>
  - event handler strip on other tags
  - safe admin marketing HTML preservation

---

## Verified live

### Blog page renders after fix
```
$ curl -sS -o /dev/null -w "blog HTTP %{http_code} (size=%{size_download})\n" \
    "http://localhost:3005/blog/tips-smart-shopping-ramadan"
blog HTTP 200 (size=81769)
```

### Health check
```
$ curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3005/api/health
HTTP 200
```

### Live blog API still serves the catalog
```
$ curl -sS "http://localhost:3005/api/v1/blog?status=published&limit=5" | jq '.data | length'
3
```

The container is still running on the pre-fix image (image rebuild
not triggered by the frontend-only commit); the `tsc` + 2126-test
suite is the contract for the change.

---

## Skipped (considered, not fixed, with reasoning)

- **Open redirects** — every `redirect()` call I sampled uses internal
  paths only (`/checkout`, `/login`, `/admin/...`); none accept a
  user-controlled URL parameter. Out of scope for this audit; would
  need a broader static analysis pass.
- **Cache poisoning** — `unstable_cache` / `revalidateTag` usage in
  the storefront is already tagged by route segment; user-data
  responses set `Cache-Control: no-store` (verified via
  `curl -i /api/v1/blog`). The architecture is sound; no specific
  poisoning candidate found.
- **Race conditions in client-side state** — would require
  hand-tracing every `useEffect` and Zustand store update. The audit
  budget for this run was consumed by the XSS sanitizer chain; the
  store layer reads as conservative (no `setTimeout` without
  cleanup, no `addEventListener` without teardown in the components
  I sampled).
- **Bundle size** — no `import` of `@react-pdf/renderer` or
  `@sentry/nextjs` in client components (both are server-only paths
  via `dynamic = 'force-dynamic'` segments). Not a real concern
  for a Next.js App Router app of this size.
- **i18n / RTL regressions** — the site is Arabic-first with
  `dir="rtl"` on `<html>`; spot-checked admin and storefront pages
  with a real payload and they render RTL correctly. A systematic
  RTL regression scan would need a Playwright sweep — out of budget
  for this run.
- **Form validation UX** — the admin forms I sampled use
  react-hook-form + zod (visible in the imports). The contract
  looks correct; no client-only validation without server mirror
  found in the 4 admin forms I traced.

These are not "not applicable" — they're deferred. The XSS
defense-in-depth chain was the highest-impact, lowest-risk work for
this run; everything else can pick up in a subsequent audit.

---

## Test results

### TypeScript
```
$ npx tsc --noEmit
(0 errors)
```

### Vitest
```
$ npx vitest run --reporter=basic
...
Test Files  189 passed | 1 skipped (190)
Tests       2126 passed | 5 skipped (2131)
Duration    20.01s
```

### Pre-fix vs post-fix sanitizer probe
The four bypass payloads (data:text/html, data:image/svg+xml,
tab-in-scheme, NUL-in-scheme) that were confirmed leaking in the
pre-fix code are all blocked by the post-fix `isDangerousUrl()` and
verified by the 56-case test suite in `src/lib/sanitize-html.test.ts`.

---

## Commit

```
f3e0831 fix(security): PCP-134/135/136 — defense-in-depth XSS at render boundary
  5 files changed, 372 insertions(+), 14 deletions(-)
  create mode 100644 src/lib/sanitize-html.test.ts
```

Branch pushed: `origin/phase14/citymarkets-frontend` (PR not opened —
Lead agent merges per Phase 14 protocol).
