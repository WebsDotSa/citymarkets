/**
 * Temporal audit activities for city-markets-sa.
 *
 * Each activity performs a single concrete audit task: scanning
 * directory trees, running grep, executing npm scripts, or invoking
 * route tests. Activities are pure — they read but never write code.
 *
 * The 5 workflows that compose these activities:
 *   - customerJourneyAuditWorkflow
 *   - adminPanelAuditWorkflow
 *   - vendorDashboardAuditWorkflow
 *   - iosWebParityAuditWorkflow
 *   - crossCuttingAuditWorkflow
 *
 * Run order: `npx tsx scripts/temporal-audits/worker.ts` in one shell,
 * then `npx tsx scripts/temporal-audits/client.ts` in another.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "audit-output");

export interface AuditIssue {
  severity: "critical" | "high" | "medium" | "low";
  category:
    | "404"
    | "redirect"
    | "form"
    | "race"
    | "hydration"
    | "authz"
    | "crud"
    | "endpoint"
    | "design"
    | "duplicate"
    | "dead"
    | "perf"
    | "type"
    | "validation"
    | "security"
    | "i18n"
    | "rtl"
    | "paging"
    | "logging"
    | "error";
  file: string;
  line?: number;
  message: string;
  fix?: string;
}

export interface AuditReport {
  workflow: string;
  startedAt: string;
  finishedAt: string;
  total_pages_scanned: number;
  issues_found: AuditIssue[];
  dead_code_candidates: string[];
  duplicate_components: { canonical: string; duplicates: string[] }[];
  design_inconsistencies: string[];
  missing_features: string[];
  security_vulnerabilities: AuditIssue[];
  performance_issues: AuditIssue[];
  suggested_fixes: { id: number; issue: string; file: string; fix: string }[];
}

function run(cmd: string, cwd = ROOT, timeoutMs = 30_000): string {
  try {
    const r = spawnSync(cmd, { cwd, shell: true, timeout: timeoutMs, encoding: "utf-8" });
    return (r.stdout ?? "") + (r.stderr ?? "");
  } catch (e) {
    return `ERR: ${(e as Error).message}`;
  }
}

function listFiles(dir: string, pattern: RegExp, max = 500): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (out.length >= max) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
        walk(p);
      } else if (pattern.test(e.name)) {
        out.push(p);
        if (out.length >= max) return;
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

function readSafe(p: string, max = 2000): string {
  try {
    return fs.readFileSync(p, "utf-8").slice(0, max);
  } catch {
    return "";
  }
}

// ────────────────────────────────────────────────────────────────────
// CUSTOMER JOURNEY ACTIVITIES
// ────────────────────────────────────────────────────────────────────

export async function scanCustomerPages(): Promise<{
  total: number;
  pages: string[];
  issues: AuditIssue[];
}> {
  const appDir = path.join(ROOT, "src/app");
  const customerDirs = [
    "",
    "categories",
    "products",
    "cart",
    "checkout",
    "orders",
    "account",
    "profile",
    "search",
    "track",
    "track-order",
    "vendors",
    "wishlist",
    "blog",
    "contact",
    "employment",
    "spin",
  ];
  const pages: string[] = [];
  const issues: AuditIssue[] = [];

  for (const d of customerDirs) {
    const base = path.join(appDir, d);
    if (!fs.existsSync(base)) continue;
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === "page.tsx" || e.name === "page.ts") pages.push(p);
      }
    };
    walk(base);
  }

  // Hydration mismatches: client-only state in SSR components
  for (const p of pages) {
    const src = readSafe(p, 4000);
    if (/typeof window/.test(src) && !/"use client"/.test(src)) {
      issues.push({
        severity: "high",
        category: "hydration",
        file: path.relative(ROOT, p),
        message: "typeof window used without 'use client' directive",
        fix: "Add 'use client' to top of file or move window check inside useEffect",
      });
    }
    // Empty state without data check
    if (/\.length\s*===\s*0/.test(src) && !/loading|Skeleton|spinner/i.test(src)) {
      issues.push({
        severity: "low",
        category: "form",
        file: path.relative(ROOT, p),
        message: "Empty-state check without loading indicator",
        fix: "Add Skeleton/Spinner fallback during data fetch",
      });
    }
    // 404 / notFound() presence
    if (/notFound\(\)/.test(src)) {
      issues.push({
        severity: "low",
        category: "404",
        file: path.relative(ROOT, p),
        message: "Page uses notFound() — verify catch-all route exists",
      });
    }
  }

  return { total: pages.length, pages, issues };
}

export async function checkRedirects(): Promise<AuditIssue[]> {
  const out = run("grep -rn 'redirect(' --include='*.tsx' --include='*.ts' src/app | grep -v 'redirect,}' | grep -v 'useRouter' | head -40");
  const issues: AuditIssue[] = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const m = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!m) continue;
    const [, file, ln, body] = m;
    if (body.includes("redirect(")) {
      const target = body.match(/redirect\(['"]([^'"]+)['"]/);
      if (target && !target[1].startsWith("/")) {
        issues.push({
          severity: "medium",
          category: "redirect",
          file,
          line: Number(ln),
          message: `Redirect to non-absolute path: ${target[1]}`,
          fix: "Use absolute path starting with /",
        });
      }
    }
  }
  return issues;
}

// ────────────────────────────────────────────────────────────────────
// ADMIN PANEL ACTIVITIES
// ────────────────────────────────────────────────────────────────────

export async function scanAdminRoutes(): Promise<{
  total: number;
  routes: string[];
  issues: AuditIssue[];
}> {
  const adminDir = path.join(ROOT, "src/app/admin");
  const routes: string[] = [];
  const issues: AuditIssue[] = [];

  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "page.tsx" || e.name === "route.ts") routes.push(p);
    }
  };
  walk(adminDir);

  // Every admin route must have admin auth guard
  for (const r of routes) {
    if (!r.endsWith("route.ts")) continue;
    const src = readSafe(r, 4000);
    if (!/requireAdminApi|verifyAdminRequest|isAdmin|admin_session/.test(src)) {
      issues.push({
        severity: "critical",
        category: "authz",
        file: path.relative(ROOT, r),
        message: "Admin route handler missing admin auth guard",
        fix: "Add requireAdminApi() guard at the top of the handler",
      });
    }
  }

  return { total: routes.length, routes, issues };
}

// ────────────────────────────────────────────────────────────────────
// VENDOR DASHBOARD ACTIVITIES
// ────────────────────────────────────────────────────────────────────

export async function scanVendorRoutes(): Promise<{
  total: number;
  routes: string[];
  issues: AuditIssue[];
}> {
  const vendorDir = path.join(ROOT, "src/app/api/v1/vendor");
  const vendorAppDir = path.join(ROOT, "src/app/vendor");
  const routes: string[] = [];
  const issues: AuditIssue[] = [];

  for (const base of [vendorDir, vendorAppDir]) {
    if (!fs.existsSync(base)) continue;
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === "route.ts" || e.name === "page.tsx") routes.push(p);
      }
    };
    walk(base);
  }

  for (const r of routes) {
    if (!r.endsWith("route.ts")) continue;
    const src = readSafe(r, 4000);
    if (!/requireVendor|verifyVendorRequest|requireVendorMatch|requireVendorRole|vendorAuth/.test(src)) {
      // skip webhook-style routes that are intentionally unauthenticated
      if (/webhook|cron|status|public/i.test(r)) continue;
      issues.push({
        severity: "critical",
        category: "authz",
        file: path.relative(ROOT, r),
        message: "Vendor route handler missing vendor auth guard",
        fix: "Add requireVendorRole() / verifyVendorRequest() guard",
      });
    }
  }

  return { total: routes.length, routes, issues };
}

// ────────────────────────────────────────────────────────────────────
// iOS PARITY ACTIVITIES
// ────────────────────────────────────────────────────────────────────

export async function scanIosParity(): Promise<{
  webEndpoints: string[];
  iosEndpoints: string[];
  missing: string[];
  issues: AuditIssue[];
}> {
  // Web endpoints: src/app/api/v1/**/route.ts
  const webSet = new Set<string>();
  const webDir = path.join(ROOT, "src/app/api/v1");
  if (fs.existsSync(webDir)) {
    const walk = (dir: string, prefix = "") => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        const seg = prefix + "/" + e.name;
        if (e.isDirectory()) walk(p, seg);
        else if (e.name === "route.ts") webSet.add(seg.replace("/route.ts", ""));
      }
    };
    walk(webDir);
  }
  // Admin endpoints (iOS may also call these)
  const adminDir = path.join(ROOT, "src/app/api/admin");
  if (fs.existsSync(adminDir)) {
    const walk = (dir: string, prefix = "") => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        const seg = prefix + "/" + e.name;
        if (e.isDirectory()) walk(p, seg);
        else if (e.name === "route.ts") webSet.add("/api/admin" + seg.replace("/route.ts", ""));
      }
    };
    walk(adminDir);
  }
  const webEndpoints = [...webSet].sort();

  // iOS endpoints: search ios-citymarkets/ for endpoint usage strings
  const iosDir = path.join(ROOT, "ios-citymarkets");
  const iosEndpoints = new Set<string>();
  if (fs.existsSync(iosDir)) {
    const iosFiles = listFiles(iosDir, /\.(swift|m)\b/, 100);
    for (const f of iosFiles) {
      const src = readSafe(f, 5000);
      // Match "/api/v1/foo" string literals in Swift files
      const matches = src.matchAll(/['"](\/api\/[^'"]+)['"]/g);
      for (const m of matches) iosEndpoints.add(m[1]);
    }
  }
  const iosList = [...iosEndpoints].sort();

  // Missing: web endpoints never referenced by iOS
  const iosSet = new Set(iosList);
  const missing = webEndpoints.filter((w) => {
    // skip vendor + admin internals that iOS doesn't need
    if (w.includes("/admin/") && !w.includes("/api/admin/orders")) return false;
    if (w.includes("/vendor-staff/")) return false;
    if (w.includes("/internal/")) return false;
    // heuristic: must appear in iOS or be a known cosmetic one
    const normalized = w.replace(/\[id\]/g, "X").replace(/^\/api\/v1/, "");
    return !iosList.some((ie) => ie.replace(/\[id\]/g, "X").includes(normalized));
  });

  return {
    webEndpoints,
    iosEndpoints: iosList,
    missing,
    issues: missing.slice(0, 20).map((m) => ({
      severity: "medium" as const,
      category: "endpoint" as const,
      file: m,
      message: `Web endpoint ${m} has no iOS counterpart`,
      fix: "Either add iOS call site or remove web route",
    })),
  };
}

// ────────────────────────────────────────────────────────────────────
// CROSS-CUTTING ACTIVITIES
// ────────────────────────────────────────────────────────────────────

export async function scanDeadCode(): Promise<{ candidates: string[]; issues: AuditIssue[] }> {
  const issues: AuditIssue[] = [];
  const candidates: string[] = [];
  // Files in src/lib and src/components not imported anywhere
  const libFiles = listFiles(path.join(ROOT, "src/lib"), /\.(ts|tsx)$/, 600)
    .filter((f) => !f.includes(".test.") && !f.includes("/validation/"));
  const componentFiles = listFiles(path.join(ROOT, "src/components"), /\.tsx$/, 600)
    .filter((f) => !f.includes(".test.") && !f.includes("/stories") && !f.includes("/__"));

  const checkUsed = (file: string) => {
    const basename = path.basename(file).replace(/\.(ts|tsx)$/, "");
    if (["index", "types", "utils", "helpers", "common"].includes(basename)) return;
    const rel = path.relative(ROOT, file).replace(/\.(ts|tsx)$/, "");
    const grep = run(`grep -rln "${basename}" --include="*.ts" --include="*.tsx" src/ | grep -v "${rel}" | head -1`);
    if (!grep.trim()) candidates.push(rel);
  };

  for (const f of libFiles) checkUsed(f);
  for (const f of componentFiles) checkUsed(f);

  return { candidates, issues };
}

export async function scanDuplicates(): Promise<{
  duplicates: { canonical: string; duplicates: string[] }[];
  issues: AuditIssue[];
}> {
  const issues: AuditIssue[] = [];
  const dup: { canonical: string; duplicates: string[] }[] = [];
  // Tailwind emerald/green classes that should be primary-*
  const emeraldOut = run(
    `grep -rn "from-emerald\\|to-emerald\\|ring-emerald\\|border-emerald\\|bg-emerald\\|text-emerald" --include="*.tsx" --include="*.ts" src/ | grep -v ".test." | head -50`,
  );
  for (const line of emeraldOut.split("\n").filter(Boolean)) {
    const m = line.match(/^([^:]+):(\d+):/);
    if (!m) continue;
    issues.push({
      severity: "medium",
      category: "design",
      file: m[1],
      line: Number(m[2]),
      message: "Tailwind emerald-* class — should be primary-* token",
      fix: "Replace with primary-{NNN} from tailwind.config.ts brand ramp",
    });
  }
  return { duplicates: dup, issues };
}

export async function scanSecurity(): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];
  // console.log/error/warn in production code
  const logs = run(
    `grep -rn "console\\.\\(log\\|error\\|warn\\|info\\)" --include="*.ts" --include="*.tsx" src/lib src/app 2>&1 | grep -v ".test." | head -50`,
  );
  for (const line of logs.split("\n").filter(Boolean)) {
    const m = line.match(/^([^:]+):(\d+):/);
    if (!m) continue;
    issues.push({
      severity: "low",
      category: "logging",
      file: m[1],
      line: Number(m[2]),
      message: "console.* outside structured logger bypasses LOG_LEVEL gate",
      fix: "Replace with logger.ts/info/warn/error",
    });
  }
  return issues;
}

export async function scanPerf(): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];
  // Large client components without dynamic import
  const largeClient = run(
    `find src/components -name "*.tsx" -not -name "*.test.*" -size +10k 2>/dev/null | head -20`,
  );
  for (const f of largeClient.split("\n").filter(Boolean)) {
    const src = readSafe(f, 1500);
    if (!/next\/dynamic|React\.lazy/.test(src)) {
      issues.push({
        severity: "medium",
        category: "perf",
        file: path.relative(ROOT, f),
        message: "Large client component not lazy-loaded",
        fix: "Use next/dynamic for heavy client-only components",
      });
    }
  }
  return issues;
}

export async function scanTypes(): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];
  // `as any` / `@ts-ignore` in production
  const ts = run(
    `grep -rn "as any\\|@ts-ignore\\|@ts-nocheck" --include="*.ts" --include="*.tsx" src/ 2>&1 | grep -v ".test." | grep -v node_modules | head -30`,
  );
  for (const line of ts.split("\n").filter(Boolean)) {
    const m = line.match(/^([^:]+):(\d+):/);
    if (!m) continue;
    issues.push({
      severity: "medium",
      category: "type",
      file: m[1],
      line: Number(m[2]),
      message: "TypeScript escape hatch (as any / @ts-ignore)",
      fix: "Add proper type or narrow via discriminated union",
    });
  }
  return issues;
}

export async function scanValidation(): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];
  // Routes without Zod validation
  const routes = listFiles(path.join(ROOT, "src/app/api/v1"), /route\.ts$/, 200);
  for (const r of routes) {
    if (/webhook|cron|status\//.test(r)) continue;
    const src = readSafe(r, 3000);
    if (/POST|PUT|PATCH|DELETE/.test(src) && !/safeParse|\.parse\(|\.parseAsync\(/.test(src) && !/formData\(\)|searchParams/.test(src)) {
      issues.push({
        severity: "high",
        category: "validation",
        file: path.relative(ROOT, r),
        message: "Mutation route handler without Zod parse",
        fix: "Add schema.parse() / safeParse() before mutation",
      });
    }
  }
  return issues;
}

// ────────────────────────────────────────────────────────────────────
// REPORT PERSISTENCE
// ────────────────────────────────────────────────────────────────────

export async function writeReport(report: AuditReport): Promise<string> {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${report.workflow}-${report.startedAt.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  return file;
}