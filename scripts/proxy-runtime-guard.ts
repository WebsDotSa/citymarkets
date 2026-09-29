#!/usr/bin/env tsx
/**
 * proxy-runtime-guard — fail loudly when src/middleware.ts is not registered
 * in the runtime functions-config-manifest.
 *
 * Background
 * ----------
 * Next.js 16 introduced `proxy.ts` (the new name for `middleware.ts`).
 * Turbopack 16.2.11 has a regression that drops `proxy.ts` from the runtime
 * manifest, so the proxy (auth + CSRF + CSP nonce) never fires.
 *
 * The file in this repo is `src/middleware.ts` — the legacy name, which
 * Next.js 16 still recognises and DOES register correctly (it shows up in
 * `.next/server/functions-config-manifest.json` as `/_middleware` with the
 * matchers and runtime). Renaming back to `proxy.ts` would re-introduce
 * the regression. If you rename it back, update this guard's
 * MIDDLEWARE_PATH and re-check the manifest.
 *
 * Why functions-config-manifest.json and not middleware-manifest.json
 * ------------------------------------------------------------------
 * Next.js 16 writes the legacy `middleware-manifest.json` empty (with
 * `"middleware": {}`) for `middleware.ts` files in some build configs —
 * the legacy file is not the source of truth anymore. The runtime reads
 * `functions-config-manifest.json` to discover middleware (`/_middleware`
 * with matchers + runtime). Verified 2026-09-29: with the legacy name
 * the manifest populates correctly, and `x-nonce` / `x-session-id`
 * headers are observed on every response, confirming the proxy fires.
 *
 * Symptoms when the manifest is empty:
 *   - smoke tests for `/login`, `/auth/register`, `/direct-order` fail
 *     because no proxy redirects fire (worked around via
 *     `next.config.mjs` permanent redirects while the bug was open)
 *   - CSRF double-submit checks don't run on mutating API routes
 *   - CSP nonce per-request injection is skipped
 *
 * This guard makes the regression impossible to ship silently. CI calls
 * `npm run proxy:guard`; the script exits non-zero when no middleware
 * is registered so the build fails immediately.
 *
 * Usage
 * -----
 *   tsx scripts/proxy-runtime-guard.ts           # exit 0 (clean) / 1 (drift)
 *   tsx scripts/proxy-runtime-guard.ts --soft    # exit 0 always, warn only
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");
const FUNCTIONS_MANIFEST_PATH = join(
  REPO_ROOT,
  ".next",
  "server",
  "functions-config-manifest.json",
);
const MIDDLEWARE_MANIFEST_PATH = join(
  REPO_ROOT,
  ".next",
  "server",
  "middleware-manifest.json",
);
const MIDDLEWARE_PATH = join(REPO_ROOT, "src", "middleware.ts");
const SOFT = process.argv.includes("--soft");

interface FunctionsConfigManifest {
  version?: number;
  functions?: Record<string, { runtime?: string; matchers?: unknown[] }>;
}

interface LegacyMiddlewareManifest {
  middleware?: Record<string, unknown>;
  sortedMiddleware?: string[];
}

function loadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Check both manifests. The runtime reads functions-config-manifest.json,
 * but in some Next 16 configs the legacy middleware-manifest.json is also
 * populated. A green check requires EITHER:
 *   1. functions-config-manifest.json has `/_middleware` with a runtime, OR
 *   2. middleware-manifest.json has a non-empty `middleware` map.
 */
function isProxyRegistered(): {
  ok: boolean;
  source: "functions" | "legacy" | null;
  detail: string;
} {
  const functions = loadJson<FunctionsConfigManifest>(FUNCTIONS_MANIFEST_PATH);
  const fnEntry = functions?.functions?.["/_middleware"];
  if (fnEntry) {
    const matchers = fnEntry.matchers;
    if (matchers && matchers.length > 0) {
      return {
        ok: true,
        source: "functions",
        detail: `/_middleware registered (runtime=${fnEntry.runtime ?? "edge"}, matchers=${matchers.length})`,
      };
    }
  }

  const legacy = loadJson<LegacyMiddlewareManifest>(MIDDLEWARE_MANIFEST_PATH);
  const legacyKeys = legacy && legacy.middleware ? Object.keys(legacy.middleware) : [];
  if (legacyKeys.length > 0) {
    return {
      ok: true,
      source: "legacy",
      detail: `legacy middleware-manifest populated (${legacyKeys.length} entries)`,
    };
  }

  return {
    ok: false,
    source: null,
    detail:
      `neither functions-config-manifest.json (/_middleware) nor ` +
      `middleware-manifest.json (middleware{}) is populated. ` +
      `functions-config=${JSON.stringify(fnEntry ?? null)}, ` +
      `legacy middleware keys=${JSON.stringify(legacyKeys)}`,
  };
}

function main(): void {
  // 1. The middleware file must exist on disk.
  if (!existsSync(MIDDLEWARE_PATH)) {
    console.error(
      `::error::middleware file missing — expected ${MIDDLEWARE_PATH}. ` +
        `Restore src/middleware.ts or update this guard if the file was renamed.`,
    );
    process.exit(1);
  }

  // 2. A build must have happened.
  if (
    !existsSync(FUNCTIONS_MANIFEST_PATH) &&
    !existsSync(MIDDLEWARE_MANIFEST_PATH)
  ) {
    const msg =
      `neither ${FUNCTIONS_MANIFEST_PATH} nor ${MIDDLEWARE_MANIFEST_PATH} ` +
      `found. Run \`npm run build\` first, then re-run this guard.`;
    if (SOFT) {
      console.warn(`::warning::${msg}`);
      return;
    }
    console.error(`::error::${msg}`);
    process.exit(1);
  }

  // 3. The proxy must be registered in at least one of the manifests.
  const result = isProxyRegistered();
  if (!result.ok) {
    const msg =
      `proxy/middleware is NOT registered in either manifest — ` +
      `Turbopack regression. ${result.detail}. ` +
      `See docs/09 "Operational gaps discovered 2026-09-28".`;
    if (SOFT) {
      console.warn(`::warning::${msg}`);
      return;
    }
    console.error(`::error::${msg}`);
    process.exit(1);
  }

  console.log(`✓ middleware.ts registered via ${result.source}. ${result.detail}`);
}

main();
