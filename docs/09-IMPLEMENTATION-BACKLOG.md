# City Markets — Implementation Backlog

## P0
- [x] remove production DB debug leakage
- [x] establish payment event/idempotency model
- [x] reconcile schema drift
- [x] verify stock concurrency
- [x] verify auth/vendor/admin isolation
- [x] make CI blocking

## P1
- [ ] create domain modules
- [ ] create v2 contracts
- [ ] extract CheckoutService
- [ ] extract PaymentService
- [ ] canonicalize catalog/product model
- [x] **partially:** unify actor/auth layer — admin-api-auth.ts and
      vendor-auth.ts now share `createRoleCache` from
      `src/lib/auth/role-cache.ts` (single source of truth for TTL
      semantics, eviction, value shape). The customer path stays
      JWT-only — it has no DB-backed role cache and doesn't need one.
      Remaining unification work: extract a common
      `signJwt/verifyJwt` helper that subsumes the three near-identical
      `sign*Token/verify*Request` pairs.
- [ ] queue critical notifications
- [x] **partially:** remove local filesystem coupling — checkout + orders
      catch-all now goes through `src/lib/errors/checkout-error-reporter.ts`
      which captures to Sentry (when configured) AND writes a JSON line
      to `<tmpdir>/checkout-errors.log` (writable in Docker read_only
      containers). The upload routes (`admin/upload`, `upload/audio`,
      `upload/place-images`, `upload/cv`) still write user uploads to
      disk via a Docker volume — that's intentional until R2/S3 lands.

## P2
- [ ] consolidate routes/components
- [ ] remove auth aliases after consumer audit
- [x] remove unused dependencies — 2026-09-28 sweep removed:
      `@x402/next`, `react-leaflet`, `ws`, `drizzle-orm`,
      `@types/formidable` (none had any importer in src/ or scripts/;
      README already notes raw pg replaced Drizzle; leaflet is imported
      directly, not via the React wrapper). `date-fns` retained because
      `next.config.mjs` lists it in `optimizePackageImports`. Devdeps
      `@types/jquery`, `@types/select2`, and `postcss` retained — used
      by admin form components and the Tailwind pipeline.
- [ ] shared design system
- [ ] performance/caching review

## P3
- [ ] non-critical polish
- [ ] naming/documentation cleanup

## Operational gaps discovered 2026-09-28

- [ ] **`Dockerfile.worker` is not exercised by CI.** The worker container
      (`docker-compose.yml` → `citymarket-worker`) runs OTP cleanup, broadcast
      delivery, coupon-expiry deactivation, and abandoned-cart reconciliation.
      `scripts/worker.ts` is shipped to production but a regression in the
      worker image (broken `tsx` install, missing deps) silently disables all
      of the above. `npm run worker:smoke` (added in 2026-09-28 pass) now
      catches import-level regressions — wiring it into `.github/workflows/ci.yml`
      is tracked separately so an empty CI Postgres (no migrations applied)
      does not flip the job red for non-DB reasons.
- [ ] **`src/proxy.ts` is not registered in `.next/server/middleware-manifest.json`**
      at runtime (Turbopack regression). The runtime manifest ships with
      `"middleware": {}` so CSRF/auth gates do not fire. The legacy-alias
      smoke failures (`/direct-order`, `/login`, `/auth/register`) are
      worked around by `next.config.mjs` redirects; the proxy root cause
      requires either a Next.js patch upgrade or a downgrade to `middleware.ts`.
      Tracked in `.next/server/middleware-manifest.json` (read at build time).
- [ ] **`src/proxy.ts` runtime registration guard** — added to CI in
      the 2026-09-28 remediation pass as `npm run proxy:guard` (run with
      `--soft` in CI today). The script exits non-zero when the runtime
      manifest is empty. Currently a soft `::warning` in CI because the
      upstream Turbopack bug is unfixed; re-promote to a bare
      `npm run proxy:guard` (no `--soft`) when resolved so a future
      regression fails the build instead of slipping through.
