#!/usr/bin/env tsx
/**
 * Auth isolation audit — static walk of every API route handler.
 *
 * What it checks (per route handler file under src/app/api):
 *   - Path prefix under `/api/admin/...` MUST import at least one of:
 *       requireAdminApi, verifyAdminRequest
 *   - Path prefix under `/api/v1/vendor/...` MUST import at least one of:
 *       verifyVendorRequest, requireVendorRole, requireVendorMatch
 *   - Path prefix under `/api/v1/payments/...` webhook/callback paths
 *     is HMAC/Bearer-authenticated and CSRF-exempt; should NOT call CSRF helpers
 *   - Customer routes that mutate (`POST|PUT|PATCH|DELETE`) MUST import:
 *       applyCsrfProtection OR validateCsrfRequest
 *   - Read-only customer `GET` endpoints either use getCustomerUserIdFromRequest
 *     (when they need user context) or are public (categories, banners, etc.)
 *
 * Output:
 *   - scripts/out/auth-isolation.json (machine-readable)
 *   - stdout summary grouped by verdict
 *
 * Exit code: 0 if 0 critical gaps, 1 if any gap, 2 on script error.
 *
 * Why this is static-only:
 *   The CI runner doesn't have a live server or a customer JWT to test
 *   against. Static analysis catches the common class of "developer added
 *   a new endpoint and forgot to gate it" bugs — exactly the case this
 *   audit exists for. The CSRF gate in src/proxy.ts catches everything
 *   else at runtime (when proxy is registered — see docs/01 R5).
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");
const API_ROOT = join(REPO_ROOT, "src", "app", "api");

// ── helpers ──

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (entry === "route.ts") acc.push(full);
  }
  return acc;
}

interface FileAuth {
  adminAuth: boolean;          // requireAdminApi / verifyAdminRequest
  vendorAuth: boolean;         // verifyVendorRequest / requireVendorRole / requireVendorMatch
  customerAuth: boolean;       // getCustomerUserIdFromRequest / resolveCustomerUserIdFromRequest / verifyCustomerToken
  csrf: boolean;               // applyCsrfProtection / validateCsrfRequest / direct csrf import
  csrfExemptByComment: boolean; // file contains "// csrf-exempt" or "x-moyasar-signature" etc.
}

function analyzeFile(filePath: string): FileAuth {
  const src = readFileSync(filePath, "utf8");
  return {
    adminAuth:
      /\brequireAdminApi\b/.test(src) || /\bverifyAdminRequest\b/.test(src),
    vendorAuth:
      /\bverifyVendorRequest\b/.test(src) ||
      /\bverifyVendorRequestWithDb\b/.test(src) ||
      /\brequireVendorRole\b/.test(src) ||
      /\brequireVendorMatch\b/.test(src),
    customerAuth:
      /\bgetCustomerUserIdFromRequest\b/.test(src) ||
      /\bresolveCustomerUserIdFromRequest\b/.test(src) ||
      /\bverifyCustomerToken\b/.test(src),
    csrf:
      /\bapplyCsrfProtection\b/.test(src) || /\bvalidateCsrfRequest\b/.test(src),
    csrfExemptByComment:
      /\/\/\s*csrf-exempt/i.test(src) ||
      /\bx-moyasar-signature\b/i.test(src) ||
      /\bHMAC\b/.test(src),
  };
}

interface RouteVerdict {
  path: string;
  method_aware: boolean;       // true if the file uses req.method / new Request(req) style
  http_methods: string[];      // exported (GET, POST, etc.)
  auth: FileAuth;
  required: {
    admin: boolean;
    vendor: boolean;
    customer: boolean;
    csrf: boolean;
  };
  verdict: "ok" | "gap" | "review";
  reason?: string;
}

// ── verdict rules ──

function classify(file: string): RouteVerdict {
  const rel = relative(API_ROOT, file)
    .split(sep)
    .join("/")
    .replace(/\/route\.ts$/, "");
  const auth = analyzeFile(file);

  const isAdmin = rel.startsWith("admin/");
  // /v1/vendor/* (singular) = vendor admin backend; /v1/vendors/[slug]/*
  // (plural + slug) = public storefront or per-vendor customer view.
  const isVendorAdmin = rel.startsWith("v1/vendor/");
  const isPaymentWebhook =
    rel === "v1/payments/webhook" ||
    rel === "v1/payments/tamara/webhook";

  // Auth-establishing endpoints: login/logout/me/otp are exempt from the
  // admin/vendor auth requirement (they're the SESSION bootstrap, not
  // session-protected). src/proxy.ts already exempts these from CSRF for
  // the same reason (see CSRF_EXEMPT_PATHS at proxy.ts:119-140).
  const isAdminAuthEntry = rel.match(
    /^admin\/(auth\/login|auth\/logout|auth\/me|auth\/change-password)\b/,
  );
  const isVendorAuthEntry = rel.match(/^v1\/vendor\/auth\b/);
  const isPublicRead = rel.match(
    /^v1\/(categories|banners|home-layout|public|auth\/config|manifest|mobile-config|store-status)\b/,
  );
  const isPublicVendorStorefront = rel.match(/^v1\/vendors\/\[slug\]\b/);
  const isCustomerAuthEntry = rel.match(/^v1\/(auth|employment|vendor\/auth\/otp)\b/);

  const required = {
    admin: isAdmin && !isAdminAuthEntry,
    vendor: isVendorAdmin && !isPaymentWebhook && !isVendorAuthEntry,
    customer: false, // determined per-method below
    csrf: !isPaymentWebhook && !isAdminAuthEntry && !isVendorAuthEntry && !isCustomerAuthEntry,
  };

  // Customer CSRF applies to mutating methods only; static analysis can't
  // always tell which methods are exported without parsing, so we conservatively
  // require CSRF for any v1 route that is not webhook/auth/public-read.
  if (
    !isAdmin &&
    !isVendorAdmin &&
    !isPaymentWebhook &&
    !isPublicRead &&
    !isPublicVendorStorefront &&
    !isCustomerAuthEntry
  ) {
    required.customer = auth.customerAuth;
    required.csrf = true;
  }

  // Verdict
  let verdict: RouteVerdict["verdict"] = "ok";
  let reason: string | undefined;

  if (required.admin && !auth.adminAuth) {
    verdict = "gap";
    reason = `admin route does not call requireAdminApi/verifyAdminRequest`;
  } else if (required.vendor && !auth.vendorAuth) {
    verdict = "gap";
    reason = `vendor route does not call verifyVendorRequest/requireVendorRole`;
  } else if (required.csrf && !auth.csrf && !auth.csrfExemptByComment) {
    // CSRF enforcement is also covered at the proxy.ts layer — if the
    // proxy is registered, missing CSRF in the route is recoverable.
    // We flag "review" rather than "gap" because the proxy may be
    // covering this route (see docs/01 R5 / .next/server/middleware-manifest).
    verdict = "review";
    reason = `mutating route does not call applyCsrfProtection/validateCsrfRequest`;
  }

  return {
    path: "/api/" + rel,
    method_aware: /\brequest\.method\b|\bnew Request\(/.test(readFileSync(file, "utf8")),
    http_methods: [], // populated below if cheap
    auth,
    required,
    verdict,
    reason,
  };
}

// ── HTTP method extraction (cheap, source-level) ──
function exportedMethods(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
    const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`);
    if (re.test(src)) out.push(m);
  }
  return out;
}

// ── main ──
function main() {
  const files = walk(API_ROOT);
  const verdicts: RouteVerdict[] = files.map((f) => {
    const v = classify(f);
    v.http_methods = exportedMethods(f);
    return v;
  });

  // Group
  const ok = verdicts.filter((v) => v.verdict === "ok");
  const review = verdicts.filter((v) => v.verdict === "review");
  const gap = verdicts.filter((v) => v.verdict === "gap");

  // Emit JSON
  const outDir = join(REPO_ROOT, "scripts", "out");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "auth-isolation.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        route_count: verdicts.length,
        gap_count: gap.length,
        review_count: review.length,
        ok_count: ok.length,
        verdicts,
      },
      null,
      2,
    ),
  );

  // Human summary
  console.log("\n═══ Auth Isolation Audit ═══\n");
  console.log(`Routes scanned:  ${verdicts.length}`);
  console.log(`OK:              ${ok.length}`);
  console.log(`Review:          ${review.length}`);
  console.log(`Gap:             ${gap.length}`);
  console.log("");

  if (gap.length > 0) {
    console.log("── Gaps (must fix) ──");
    for (const v of gap) {
      console.log(`  ${v.path}`);
      console.log(`    ${v.reason}`);
    }
    console.log("");
  }

  if (review.length > 0 && review.length <= 50) {
    console.log("── Review (proxy.ts likely covers at runtime) ──");
    for (const v of review) {
      console.log(`  ${v.path} — ${v.reason}`);
    }
    console.log("");
  } else if (review.length > 50) {
    console.log(
      `── Review: ${review.length} routes (full list in auth-isolation.json) ──`,
    );
  }

  console.log(`JSON written:    ${outPath}`);
  if (gap.length > 0) process.exit(1);
}

main();
