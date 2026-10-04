/**
 * 5 Temporal audit workflows for city-markets-sa.
 *
 * Each workflow composes multiple activities to produce a structured
 * AuditReport. Run on the "citymarkets-audit-task-queue" task queue
 * via `scripts/temporal-audits/client.ts`.
 *
 * Aggregated to audit-output/CONSOLIDATED_REPORT.md by
 * `scripts/temporal-audits/aggregate.ts`.
 */

import { proxyActivities, ApplicationFailure } from "@temporalio/workflow";
import type * as acts from "./activities";

// Activities have a 60-second start-to-close timeout. Each activity
// is a pure read against the file system — no DB writes.
const { scanCustomerPages, checkRedirects, scanAdminRoutes, scanVendorRoutes,
   scanIosParity, scanDeadCode, scanDuplicates, scanSecurity, scanPerf,
   scanTypes, scanValidation, writeReport } = proxyActivities<typeof acts>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 1 },
});

// ────────────────────────────────────────────────────────────────────
// Workflow 1 — Customer Journey Audit
// ────────────────────────────────────────────────────────────────────

export async function customerJourneyAuditWorkflow(): Promise<acts.AuditReport> {
  const startedAt = new Date().toISOString();
  const pagesResult = await scanCustomerPages();
  const redirectIssues = await checkRedirects();
  const issues: acts.AuditIssue[] = [
    ...pagesResult.issues,
    ...redirectIssues,
  ];
  const finishedAt = new Date().toISOString();
  const report: acts.AuditReport = {
    workflow: "customerJourneyAudit",
    startedAt,
    finishedAt,
    total_pages_scanned: pagesResult.total,
    issues_found: issues,
    dead_code_candidates: [],
    duplicate_components: [],
    design_inconsistencies: [],
    missing_features: [],
    security_vulnerabilities: [],
    performance_issues: [],
    suggested_fixes: issues.slice(0, 50).map((i, idx) => ({
      id: idx + 1,
      issue: i.message,
      file: i.file,
      fix: i.fix ?? "(needs triage)",
    })),
  };
  await writeReport(report);
  return report;
}

// ────────────────────────────────────────────────────────────────────
// Workflow 2 — Admin Panel Audit
// ────────────────────────────────────────────────────────────────────

export async function adminPanelAuditWorkflow(): Promise<acts.AuditReport> {
  const startedAt = new Date().toISOString();
  const admin = await scanAdminRoutes();
  const validationIssues = await scanValidation();
  const issues: acts.AuditIssue[] = [
    ...admin.issues,
    ...validationIssues.filter((v) => v.file.includes("/admin/")),
  ];
  const finishedAt = new Date().toISOString();
  const report: acts.AuditReport = {
    workflow: "adminPanelAudit",
    startedAt,
    finishedAt,
    total_pages_scanned: admin.total,
    issues_found: issues,
    dead_code_candidates: [],
    duplicate_components: [],
    design_inconsistencies: [],
    missing_features: [],
    security_vulnerabilities: issues.filter((i) => i.category === "authz"),
    performance_issues: [],
    suggested_fixes: issues.slice(0, 50).map((i, idx) => ({
      id: idx + 1,
      issue: i.message,
      file: i.file,
      fix: i.fix ?? "(needs triage)",
    })),
  };
  await writeReport(report);
  return report;
}

// ────────────────────────────────────────────────────────────────────
// Workflow 3 — Vendor Dashboard Audit
// ────────────────────────────────────────────────────────────────────

export async function vendorDashboardAuditWorkflow(): Promise<acts.AuditReport> {
  const startedAt = new Date().toISOString();
  const vendor = await scanVendorRoutes();
  const validationIssues = await scanValidation();
  const issues: acts.AuditIssue[] = [
    ...vendor.issues,
    ...validationIssues.filter((v) => v.file.includes("/vendor/")),
  ];
  const finishedAt = new Date().toISOString();
  const report: acts.AuditReport = {
    workflow: "vendorDashboardAudit",
    startedAt,
    finishedAt,
    total_pages_scanned: vendor.total,
    issues_found: issues,
    dead_code_candidates: [],
    duplicate_components: [],
    design_inconsistencies: [],
    missing_features: [],
    security_vulnerabilities: issues.filter((i) => i.category === "authz"),
    performance_issues: [],
    suggested_fixes: issues.slice(0, 50).map((i, idx) => ({
      id: idx + 1,
      issue: i.message,
      file: i.file,
      fix: i.fix ?? "(needs triage)",
    })),
  };
  await writeReport(report);
  return report;
}

// ────────────────────────────────────────────────────────────────────
// Workflow 4 — iOS ↔ Web Parity Audit
// ────────────────────────────────────────────────────────────────────

export async function iosWebParityAuditWorkflow(): Promise<acts.AuditReport> {
  const startedAt = new Date().toISOString();
  const parity = await scanIosParity();
  const finishedAt = new Date().toISOString();
  const report: acts.AuditReport = {
    workflow: "iosWebParityAudit",
    startedAt,
    finishedAt,
    total_pages_scanned: parity.webEndpoints.length + parity.iosEndpoints.length,
    issues_found: parity.issues,
    dead_code_candidates: [],
    duplicate_components: [],
    design_inconsistencies: [],
    missing_features: parity.missing.slice(0, 30),
    security_vulnerabilities: [],
    performance_issues: [],
    suggested_fixes: parity.issues.slice(0, 30).map((i, idx) => ({
      id: idx + 1,
      issue: i.message,
      file: i.file,
      fix: i.fix ?? "(needs triage)",
    })),
  };
  await writeReport(report);
  return report;
}

// ────────────────────────────────────────────────────────────────────
// Workflow 5 — Cross-cutting Concerns
// ────────────────────────────────────────────────────────────────────

export async function crossCuttingAuditWorkflow(): Promise<acts.AuditReport> {
  const startedAt = new Date().toISOString();
  const [dead, dup, sec, perf, types] = await Promise.all([
    scanDeadCode(),
    scanDuplicates(),
    scanSecurity(),
    scanPerf(),
    scanTypes(),
  ]);
  const issues: acts.AuditIssue[] = [
    ...dup.issues,
    ...sec,
    ...perf,
    ...types,
  ];
  const finishedAt = new Date().toISOString();
  const report: acts.AuditReport = {
    workflow: "crossCuttingAudit",
    startedAt,
    finishedAt,
    total_pages_scanned: 0,
    issues_found: issues,
    dead_code_candidates: dead.candidates.slice(0, 100),
    duplicate_components: dup.duplicates,
    design_inconsistencies: dup.issues
      .filter((i) => i.category === "design")
      .map((i) => `${i.file}:${i.line ?? 0} ${i.message}`),
    missing_features: [],
    security_vulnerabilities: issues.filter((i) => i.category === "security"),
    performance_issues: perf,
    suggested_fixes: issues.slice(0, 50).map((i, idx) => ({
      id: idx + 1,
      issue: i.message,
      file: i.file,
      fix: i.fix ?? "(needs triage)",
    })),
  };
  await writeReport(report);
  return report;
}