# City Markets — Implementation Backlog

## P0
- [ ] remove production DB debug leakage
- [ ] establish payment event/idempotency model
- [ ] reconcile schema drift
- [ ] verify stock concurrency
- [ ] verify auth/vendor/admin isolation
- [ ] make CI blocking

## P1
- [ ] create domain modules
- [ ] create v2 contracts
- [ ] extract CheckoutService
- [ ] extract PaymentService
- [ ] canonicalize catalog/product model
- [ ] unify actor/auth layer
- [ ] queue critical notifications
- [ ] remove local filesystem coupling

## P2
- [ ] consolidate routes/components
- [ ] remove auth aliases after consumer audit
- [ ] remove unused dependencies
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
      of the above. Add `npm run worker:smoke` (a tsx-driven import of the
      worker entry point + a single `process.exit(0)` after the cron timers
      register) to `.github/workflows/ci.yml`.
- [ ] **`src/proxy.ts` is not registered in `.next/server/middleware-manifest.json`**
      at runtime (Turbopack regression). The runtime manifest ships with
      `"middleware": {}` so CSRF/auth gates don't fire. The legacy-alias
      smoke failures (`/direct-order`, `/login`, `/auth/register`) are
      worked around by `next.config.mjs` redirects; the proxy root cause
      requires either a Next.js patch upgrade or a downgrade to `middleware.ts`.
      Tracked in `.next/server/middleware-manifest.json` (read at build
      time — see `scripts/proxy-runtime-guard.ts`).
- [ ] **`src/proxy.ts` runtime registration guard** — added to CI in
      the 2026-09-28 remediation pass. Fails the build if the manifest is
      empty. Does NOT auto-fix; surfaces the regression immediately.
