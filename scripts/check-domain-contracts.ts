/**
 * Phase 10.7 (v2 contracts) — Domain Contract Guard
 *
 * Enforces that cross-domain imports go through the public barrel
 * (`@/lib/<domain>`), never through deep paths (`@/lib/<domain>/X`).
 *
 * Allowed:
 *   - Imports of the barrel: `@/lib/orders` (resolves to `./orders/index.ts`)
 *   - Same-domain deep imports: file in `src/lib/orders/` importing
 *     `@/lib/orders/checkout/pricing` is fine
 *   - Shared modules at `src/lib/` root: `@/lib/cache`, `@/lib/env`, etc.
 *   - Shared subfolders that act as utility buckets: `@/lib/seo`,
 *     `@/lib/validation`, `@/lib/db`, `@/lib/supabase`, `@/lib/errors`,
 *     `@/lib/broadcasts` (free to deep-import from anywhere)
 *
 * Forbidden (when source is outside the target domain):
 *   - `@/lib/orders/checkout/checkout-service` from `src/app/...`
 *   - `@/lib/identity/auth/jwt-helper` from `src/components/...`
 *
 * A small allowlist (`LEGACY_DEEP_IMPORTS`) exempts existing pre-Phase-10
 * consumers until a follow-up codemod migrates them. Any new deep import
 * outside the allowlist fails the gate.
 *
 * Exit code 0 = clean (or only allowlisted violations).
 * Exit code 1 = new violation found.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const SHARED_PREFIX = "@/lib/";

// Bounded contexts (5 from Phase 10). Files inside these dirs may deep-import
// freely; files OUTSIDE these dirs must go through the barrel.
const DOMAINS = [
  "identity",
  "catalog",
  "payments",
  "orders",
  "delivery",
] as const;

// Shared subfolders that are free to deep-import from anywhere. These are
// utility buckets, not bounded contexts. Add new shared subfolders here
// rather than expanding the contract surface.
const SHARED_SUBFOLDERS: ReadonlySet<string> = new Set([
  "db", // pool + typed wrappers
  "seo", // site + (catalog-owned) product/sitemap-sources shimmed
  "validation", // zod schemas, sub-modular by entity
  "supabase", // browser/server clients
  "errors", // Sentry reporters
  "broadcasts", // deferred 6th domain (per Phase 10 mapping report)
]);

// Existing pre-Phase-10 deep imports (whitelisted until a codemod migrates them).
// Keep this list short — every entry is debt to retire.
const LEGACY_DEEP_IMPORTS: ReadonlySet<string> = new Set([
  // payments/payment-service has 13 consumers outside payments/
  "src/app/api/v1/payments/retry/route.ts",
  "src/app/api/v1/payments/initiate/route.ts",
  "src/app/api/v1/payments/moyasar/confirm/route.ts",
  "src/app/api/v1/payments/moyasar/config/route.ts",
  "src/app/api/v1/payments/webhook/route.ts",
  "src/app/api/v1/payments/webhook/route.test.ts",
  "src/app/api/v1/payments/tamara/webhook/route.ts",
  "src/app/api/admin/payments/route.ts",
  "src/app/api/admin/settings/payments/route.ts",
  "src/app/api/v1/payments/initiate/route.test.ts",
  "src/__tests__/payment-service.test.ts",
  // orders/checkout/* has 2 consumers outside orders/ (via shim — fix by codemod)
  "src/__tests__/checkout-service.test.ts",
  "src/app/api/v1/checkout/route.ts",
  // identity/auth/* has 3 consumers outside identity/
  "src/__tests__/jwt-helper.test.ts",
  "src/__tests__/role-cache.test.ts",
  "src/middleware.ts",
]);

interface Violation {
  file: string;
  line: number;
  spec: string;
  reason: string;
}

const violations: Violation[] = [];

function isInDomain(file: string, domain: string): boolean {
  const rel = relative(SRC, file).split(sep);
  return rel[0] === "lib" && rel[1] === domain;
}

function classify(spec: string): "barrel" | "shared" | "shared-subfolder" | "domain-deep" | "unknown" {
  const rest = spec.slice(SHARED_PREFIX.length);
  if (!rest) return "unknown";
  const [first] = rest.split("/");
  if (DOMAINS.includes(first as (typeof DOMAINS)[number])) {
    return rest.split("/").length === 1 ? "barrel" : "domain-deep";
  }
  if (SHARED_SUBFOLDERS.has(first)) {
    return "shared-subfolder"; // free to deep-import
  }
  return "shared"; // root-level shared module (cache, env, logger, types, …)
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const importRe = /from\s+["'](@\/lib\/[^"']+)["']/g;

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  const content = readFileSync(file, "utf8");
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content)) !== null) {
    const spec = m[1];
    const kind = classify(spec);
    if (kind === "shared" || kind === "barrel" || kind === "shared-subfolder" || kind === "unknown") continue;

    // kind === "domain-deep": cross-domain deep import.
    const targetDomain = spec.slice(SHARED_PREFIX.length).split("/")[0];
    if (isInDomain(file, targetDomain)) continue; // same-domain OK

    if (LEGACY_DEEP_IMPORTS.has(rel)) continue;

    const line = content.slice(0, m.index).split("\n").length;
    violations.push({
      file: rel,
      line,
      spec,
      reason: `cross-domain deep import — use \`@/lib/${targetDomain}\` (barrel) instead`,
    });
  }
}

if (violations.length === 0) {
  console.log("=== Domain Contract Guard ===");
  console.log(`Domains:           ${DOMAINS.join(", ")}`);
  console.log(`Shared subfolders: ${Array.from(SHARED_SUBFOLDERS).join(", ")}`);
  console.log(`Status:            OK (0 new violations)`);
  console.log(`Legacy allowlist:  ${LEGACY_DEEP_IMPORTS.size} files exempt until codemod`);
  process.exit(0);
}

console.log("=== Domain Contract Guard ===");
console.log(`Status:            FAIL (${violations.length} new violation${violations.length === 1 ? "" : "s"})`);
console.log("");
for (const v of violations) {
  console.log(`  ${v.file}:${v.line}  ${v.spec}`);
  console.log(`    → ${v.reason}`);
}
console.log("");
console.log("Fix: import from the public barrel `@/lib/<domain>` instead.");
console.log("If this is a pre-existing legacy import, add the file to");
console.log("LEGACY_DEEP_IMPORTS in scripts/check-domain-contracts.ts and");
console.log("open a follow-up issue to codemod it.");
process.exit(1);
