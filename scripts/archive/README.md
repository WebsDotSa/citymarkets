# Archived scripts

These scripts are **not invoked from CI, package.json, or any active
documentation**. They were moved here during the 2026-09-30
full-repository consolidation (`refactor/full-repository-consolidation`).

## Why each one is here

| Script | Reason for archiving |
|---|---|
| `apply-migration.mjs` | Superseded by `scripts/migrate.ts` (idempotent runner with checksum tracking + `--mark-applied`) |
| `audit-csrf-coverage.ts` | One-off CSRF audit. The static check it performed is now in `scripts/check-domain-contracts.ts` |
| `diag-zones.js` | One-off diagnostic for delivery-zone regression |
| `diag_apple_reviewer.ts` | One-off diagnostic for the App Store reviewer sandbox |
| `dry-run-042.mjs` | Manual dry-run of migration 042 — superseded by `npm run db:migrate:dry-run` |
| `e2e-admin-vendors.mjs` | Superseded by `npm run qa:golden-path` (the `.sh` wrapper still in `scripts/` was a thin shim; both moved) |
| `e2e-customer-payment.mjs` | Superseded by `npm run qa:golden-path` |
| `pick-category-images.mjs` | One-off category image picking for the seed migration |
| `quick-test.mjs` | ad-hoc test scratch — never wired to CI |
| `reset-admin-password.ts` | One-off operator helper; use `psql` directly with `crypt()` to reset instead |
| `sitemap-count.mjs` | One-off sitemap statistics |
| `smoke-admin-pages.mjs` | One-off admin-pages smoke; replaced by `qa:critical-paths` |
| `smoke-admin-products.mjs` | One-off admin-products smoke; replaced by `qa:critical-paths` |
| `test-checkout-payments.mjs` | ad-hoc test scratch — never wired to CI |
| `zz-test.mjs` | ad-hoc test scratch — never wired to CI |
| `backfill-category-images.sql` | One-off backfill for category images; superseded by the data already in 074 |

## Re-hydration policy

If you need to revive one of these scripts:

1. Confirm it has no replacement. Most do — see column 2.
2. `git mv scripts/archive/<name> scripts/`
3. Add the corresponding npm script in `package.json` (so CI can use it).
4. Add a row to `scripts/README.md` documenting the operational use.

## What was NOT archived (active)

Active scripts that remain at `scripts/` (all invoked by CI / npm / docs):

- `auth-isolation-audit.ts` ← `npm run auth:isolation`
- `check-domain-contracts.ts` ← `npm run domain:guard`
- `migrate.ts` ← `npm run db:migrate`, `db:migrate:dry-run`
- `migration-diagnostics.ts` ← `npm run migration:diagnostics`
- `migration-drift-report.ts` ← `npm run db:drift-report`
- `proxy-runtime-guard.ts` ← `npm run proxy:guard`
- `worker-smoke.ts` ← `npm run worker:smoke`
- `worker.ts` ← `npm run worker:run`
- `qa-smoke.mjs`, `qa-critical-paths.mjs`, `e2e-golden-path.mjs` ← `npm run qa:*`
- `ios-auth-smoke.mjs`, `ios-contract-smoke.mjs` ← `.github/workflows/ios.yml`
- `start.sh`, `backup*.sh`, `install-apple-pay-domain.sh`,
  `grant-products-write.sh` — operator-invoked deploy helpers
- `qa-smoke.sh`, `e2e-admin-vendors.sh`, `e2e-checkout-slice3-fanout.mjs`
  — referenced from `scripts/README.md` (operator-invoked E2E)
