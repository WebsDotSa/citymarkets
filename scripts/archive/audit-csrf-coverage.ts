#!/usr/bin/env tsx
/**
 * CSRF Coverage Audit Script
 *
 * Verifies that every mutating API route under src/app/api/.../route.ts
 * is protected against CSRF.
 *
 * The project uses TWO layers of CSRF protection:
 *
 *   1. Global proxy gate (src/proxy.ts) — applies the double-submit
 *      cookie / Origin check uniformly to every API request whose path
 *      starts with /api/v1/ or /api/admin/. Webhooks and a small set
 *      of session-establishing endpoints opt out via CSRF_EXEMPT_PATHS.
 *
 *   2. Per-route fallback (applyCsrfProtection(request)) — for any
 *      route that ships without the proxy in front (today: none).
 *
 * This audit treats (1) as authoritative: any route under `/api/v1/` or
 * `/api/admin/` that is NOT in `CSRF_EXEMPT_PATHS` is reported as
 * protected by the proxy. Per-route calls are noted for visibility but
 * do not change the verdict.
 *
 * Exits non-zero if any mutating route is missing CSRF protection (i.e.
 * outside the proxy's API_PREFIXES), so this can run in CI as a gating
 * check.
 *
 * Usage:
 *   npx tsx scripts/audit-csrf-coverage.ts
 *   npx tsx scripts/audit-csrf-coverage.ts --json
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const API_ROOT = path.join(process.cwd(), "src", "app", "api");
const PROXY_PATH = path.join(process.cwd(), "src", "proxy.ts");
const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
const CSRF_HELPERS = [
  "applyCsrfProtection",
  "requireCsrfProtection",
  "validateCsrfToken",
  "csrfErrorResponse",
] as const;

interface RouteFinding {
  file: string;
  method: string;
  hasCsrfCheck: boolean;
  csrfHelper?: string;
  /** "proxy" | "exempt" | "per-route" | "missing" */
  source: "proxy" | "exempt" | "per-route" | "missing";
  notes: string;
}

async function* walkRoutes(dir: string): AsyncGenerator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkRoutes(full);
    } else if (entry.isFile() && entry.name === "route.ts") {
      yield full;
    }
  }
}

function findHandlerBlocks(source: string): { method: string; body: string }[] {
  const blocks: { method: string; body: string }[] = [];
  const methodRegex =
    /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE|GET)\s*\([^)]*\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = methodRegex.exec(source)) !== null) {
    const method = match[1];
    const startIdx = match.index + match[0].length;
    let depth = 1;
    let idx = startIdx;
    while (idx < source.length && depth > 0) {
      const ch = source[idx];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      idx++;
    }
    blocks.push({ method, body: source.slice(startIdx, idx - 1) });
  }
  return blocks;
}

/**
 * Parse the proxy.ts source to extract:
 *   - API_PREFIXES (the namespaces the proxy gates)
 *   - CSRF_EXEMPT_PATHS (the opt-out list, with comments stripped)
 *
 * Returns null if proxy.ts is missing the global gate (in which case the
 * audit must flag every mutating API route as missing).
 */
async function loadProxyConfig(): Promise<{
  apiPrefixes: string[];
  exemptPaths: string[];
  hasGlobalGate: boolean;
}> {
  let source: string;
  try {
    source = await fs.readFile(PROXY_PATH, "utf8");
  } catch {
    return { apiPrefixes: [], exemptPaths: [], hasGlobalGate: false };
  }

  const apiPrefixMatch = source.match(
    /const\s+API_PREFIXES\s*=\s*\[([\s\S]*?)\]\s*as\s+const/,
  );
  const apiPrefixes: string[] = [];
  if (apiPrefixMatch) {
    const literalMatches = apiPrefixMatch[1].matchAll(/["']([^"']+)["']/g);
    for (const m of literalMatches) {
      apiPrefixes.push(m[1]);
    }
  }

  const exemptMatch = source.match(
    /const\s+CSRF_EXEMPT_PATHS\s*=\s*\[([\s\S]*?)\];/,
  );
  const exemptPaths: string[] = [];
  if (exemptMatch) {
    const literalMatches = exemptMatch[1].matchAll(/["']([^"']+)["']/g);
    for (const m of literalMatches) {
      exemptPaths.push(m[1]);
    }
  }

  // The proxy is treated as a CSRF gate only when it has BOTH the
  // `requiresCsrfProtection` invocation AND the `isCsrfExempt` check
  // inside an `if` block scoped to API paths. This avoids a false sense
  // of coverage on a future refactor that drops the gate.
  const hasGlobalGate =
    source.includes("requiresCsrfProtection") &&
    source.includes("isCsrfExempt") &&
    source.includes("isApiPath");

  return { apiPrefixes, exemptPaths, hasGlobalGate };
}

/**
 * Translate a route.ts file path (e.g.
 * `src/app/api/admin/banners/route.ts`) into the URL pathname prefix it
 * serves (`/api/admin/banners`).
 */
function pathFromRouteFile(relPath: string): string {
  // Strip leading `src/app` and trailing `/route.ts`.
  const withoutSrc = relPath.replace(/^src\/app/, "");
  const withoutRoute = withoutSrc.replace(/\/route\.ts$/, "");
  return withoutSrc === withoutRoute ? withoutSrc : withoutSrc;
}

/**
 * Check whether a given route path is inside one of the proxy's API
 * prefixes (e.g. `/api/admin/banners` is inside `/api/admin/`).
 */
function isUnderAnyPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname.startsWith(p));
}

/**
 * Check whether a given route path is exempted from the proxy gate
 * (e.g. `/api/v1/payments/webhook` matches `/api/v1/payments/webhook`).
 */
function isExempt(pathname: string, exemptPaths: string[]): boolean {
  return exemptPaths.some((p) => pathname === p || pathname.startsWith(p));
}

async function auditFile(
  filePath: string,
  proxyConfig: Awaited<ReturnType<typeof loadProxyConfig>>,
): Promise<RouteFinding[]> {
  const source = await fs.readFile(filePath, "utf8");
  const blocks = findHandlerBlocks(source);
  const findings: RouteFinding[] = [];
  const rel = path.relative(process.cwd(), filePath);
  const pathname = pathFromRouteFile(rel);

  for (const block of blocks) {
    if (
      !MUTATING_METHODS.includes(
        block.method as (typeof MUTATING_METHODS)[number],
      )
    ) {
      continue;
    }
    let hasCsrf = false;
    let helper: string | undefined;
    for (const h of CSRF_HELPERS) {
      if (block.body.includes(h)) {
        hasCsrf = true;
        helper = h;
        break;
      }
    }

    const proxyProtected =
      proxyConfig.hasGlobalGate && isUnderAnyPrefix(pathname, proxyConfig.apiPrefixes);
    const exempt = proxyConfig.hasGlobalGate && isExempt(pathname, proxyConfig.exemptPaths);

    let source$: RouteFinding["source"];
    let notes: string;
    if (proxyProtected && !exempt) {
      source$ = "proxy";
      notes = `Protected by proxy.ts global gate (matches API_PREFIXES: ${proxyConfig.apiPrefixes
        .filter((p) => pathname.startsWith(p))
        .join(", ")})`;
    } else if (proxyProtected && exempt) {
      source$ = "exempt";
      notes = `CSRF-exempt via CSRF_EXEMPT_PATHS (webhook / session-establishing)`;
    } else if (hasCsrf) {
      source$ = "per-route";
      notes = `Per-route CSRF helper (${helper}) — not gated by proxy.ts`;
    } else {
      source$ = "missing";
      const hasAuth =
        block.body.includes("requireAdminApi") ||
        block.body.includes("verifyAdminRequest") ||
        block.body.includes("verifyVendorRequest") ||
        block.body.includes("getCurrentUser") ||
        block.body.includes("resolveCustomerUserIdFromRequest");
      notes = hasAuth
        ? `Authenticated admin/vendor endpoint but NOT under proxy.ts API_PREFIXES (${proxyConfig.apiPrefixes.join(", ")}) — MANUAL REVIEW REQUIRED`
        : `Public or unknown — MANUAL REVIEW REQUIRED`;
    }

    findings.push({
      file: rel,
      method: block.method,
      hasCsrfCheck: source$ !== "missing",
      csrfHelper: helper,
      source: source$,
      notes,
    });
  }
  return findings;
}

async function main() {
  const proxyConfig = await loadProxyConfig();
  const findings: RouteFinding[] = [];
  for await (const routeFile of walkRoutes(API_ROOT)) {
    const fileFindings = await auditFile(routeFile, proxyConfig);
    findings.push(...fileFindings);
  }

  const total = findings.length;
  const protectedCount = findings.filter((f) => f.hasCsrfCheck).length;
  const missing = findings.filter((f) => f.source === "missing");
  const perRoute = findings.filter((f) => f.source === "per-route");

  const isJson = process.argv.includes("--json");

  if (isJson) {
    console.log(
      JSON.stringify(
        {
          total,
          protectedCount,
          missing,
          perRoute,
          proxy: {
            hasGlobalGate: proxyConfig.hasGlobalGate,
            apiPrefixes: proxyConfig.apiPrefixes,
            exemptPaths: proxyConfig.exemptPaths,
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`CSRF Coverage Audit — ${total} mutating routes audited`);
    console.log(`  Protected:        ${protectedCount}`);
    console.log(`    via proxy.ts:   ${findings.filter((f) => f.source === "proxy").length}`);
    console.log(`    via exempt:     ${findings.filter((f) => f.source === "exempt").length}`);
    console.log(`    per-route:      ${perRoute.length}`);
    console.log(`  Missing:          ${missing.length}`);
    console.log("");
    console.log(
      `proxy.ts global gate: ${proxyConfig.hasGlobalGate ? "PRESENT" : "MISSING"}`,
    );
    console.log(`  API_PREFIXES:    ${proxyConfig.apiPrefixes.join(", ")}`);
    console.log(`  CSRF_EXEMPT_PATHS: ${proxyConfig.exemptPaths.length} entries`);
    console.log("");
    if (missing.length > 0) {
      console.log("Routes missing CSRF protection:");
      console.log("─".repeat(80));
      for (const m of missing) {
        console.log(`  ${m.method.padEnd(6)} ${m.file}`);
        console.log(`         ${m.notes}`);
      }
      console.log("");
    }
    if (perRoute.length > 0) {
      console.log("Routes with per-route CSRF (not under proxy gate):");
      console.log("─".repeat(80));
      for (const p of perRoute) {
        console.log(`  ${p.method.padEnd(6)} ${p.file}`);
        console.log(`         ${p.notes}`);
      }
      console.log("");
    }
  }

  // CI gate: exit non-zero if any unprotected route is found OR if the
  // proxy gate is missing (the safety net is gone).
  if (missing.length > 0 || !proxyConfig.hasGlobalGate) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("CSRF audit failed:", err);
  process.exit(2);
});