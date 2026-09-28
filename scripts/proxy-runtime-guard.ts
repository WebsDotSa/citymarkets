#!/usr/bin/env tsx
/**
 * proxy-runtime-guard — fail loudly when src/proxy.ts is not registered
 * in the runtime middleware-manifest.
 *
 * Background
 * ----------
 * Next.js 16 renamed `middleware.ts` to `proxy.ts` (the proxy layer). The
 * Turbopack bundler ships the file inside `.next/server/`, but as of
 * next@16.2.11 it does NOT register it in `.next/server/middleware-manifest.json`.
 * The manifest is what Next's request pipeline actually reads at runtime, so
 * the proxy (auth + CSRF + CSP nonce) never fires. Symptoms:
 *
 *   - `.next/server/middleware-manifest.json` → `"middleware": {}`,
 *     `"sortedMiddleware": []`
 *   - smoke tests for `/login`, `/auth/register`, `/direct-order` fail
 *     because no proxy redirects fire (worked around via
 *     `next.config.mjs` permanent redirects)
 *   - CSRF double-submit checks don't run on mutating API routes
 *   - CSP nonce per-request injection is skipped
 *
 * This guard makes the regression impossible to ship silently. CI calls
 * `npm run proxy:guard`; the script exits non-zero when the manifest is
 * empty so the build fails immediately.
 *
 * Usage
 * -----
 *   tsx scripts/proxy-runtime-guard.ts           # exit 0 (clean) / 1 (drift)
 *   tsx scripts/proxy-runtime-guard.ts --soft    # exit 0 always, warn only
 *
 * Why a standalone script
 * -----------------------
 * Earlier this guard lived inline in `.github/workflows/ci.yml` as a
 * `node -e` one-liner. Extracting it here means contributors can run
 * the same check locally before pushing, and the CI YAML stays
 * readable. The `--soft` flag preserves the existing CI behaviour
 * while the upstream Turbopack regression is being tracked
 * (see docs/09 "Operational gaps").
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");
const MANIFEST_PATH = join(
  REPO_ROOT,
  ".next",
  "server",
  "middleware-manifest.json",
);
const PROXY_PATH = join(REPO_ROOT, "src", "proxy.ts");
const SOFT = process.argv.includes("--soft");

interface Manifest {
  middleware?: Record<string, unknown>;
  sortedMiddleware?: string[];
  functions?: Record<string, unknown>;
}

function loadManifest(): Manifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    const text = readFileSync(MANIFEST_PATH, "utf8");
    return JSON.parse(text) as Manifest;
  } catch {
    return null;
  }
}

function main(): void {
  // 1. The proxy file must exist on disk.
  if (!existsSync(PROXY_PATH)) {
    console.error(
      `::error::proxy file missing — expected ${PROXY_PATH}. ` +
        `Restore src/proxy.ts or update this guard if the file was renamed.`,
    );
    process.exit(1);
  }

  // 2. The manifest must exist (i.e. a build has happened).
  const manifest = loadManifest();
  if (manifest === null) {
    const msg =
      `middleware-manifest.json not found at ${MANIFEST_PATH}. ` +
      `Run \`npm run build\` first, then re-run this guard.`;
    if (SOFT) {
      console.warn(`::warning::${msg}`);
      return;
    }
    console.error(`::error::${msg}`);
    process.exit(1);
  }

  // 3. The manifest must contain at least one middleware entry whose
  //    name maps to the proxy file. We accept any non-empty `middleware`
  //    object as a positive signal; the precise key naming has changed
  //    between Next 15.x and 16.x (e.g. `/proxy`, `src/proxy.ts`,
  //    `proxy`).
  const middlewareKeys = Object.keys(manifest.middleware ?? {});
  const sortedKeys = manifest.sortedMiddleware ?? [];

  if (middlewareKeys.length === 0 && sortedKeys.length === 0) {
    const msg =
      `proxy.ts is NOT registered in middleware-manifest.json — ` +
      `Turbopack regression. Manifest: ${JSON.stringify(manifest)}. ` +
      `See docs/09 "Operational gaps discovered 2026-09-28".`;
    if (SOFT) {
      console.warn(`::warning::${msg}`);
      return;
    }
    console.error(`::error::${msg}`);
    process.exit(1);
  }

  // 4. Sanity: at least one entry should reference the proxy layer.
  const referencesProxy = [...middlewareKeys, ...sortedKeys].some((k) =>
    /proxy|middleware/i.test(k),
  );
  if (!referencesProxy) {
    const msg =
      `middleware-manifest.json contains entries but none reference ` +
      `the proxy layer. Keys: middleware=${JSON.stringify(middlewareKeys)} ` +
      `sortedMiddleware=${JSON.stringify(sortedKeys)}. ` +
      `Expected at least one key matching /proxy|middleware/i.`;
    if (SOFT) {
      console.warn(`::warning::${msg}`);
      return;
    }
    console.error(`::error::${msg}`);
    process.exit(1);
  }

  console.log(
    `✓ proxy.ts registered. middleware=${middlewareKeys.length} ` +
      `sortedMiddleware=${sortedKeys.length}`,
  );
}

main();
