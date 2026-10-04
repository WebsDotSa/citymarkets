/**
 * Temporal audit client — fires 5 parallel audit workflows and awaits
 * the consolidated result.
 *
 * Usage:
 *   npx tsx scripts/temporal-audits/client.ts
 *
 * Requires the worker at scripts/temporal-audits/worker.ts to be
 * running on the same Temporal cluster (default 127.0.0.1:7233).
 *
 * Outputs to audit-output/CONSOLIDATED_REPORT.md and prints a
 * one-line summary per workflow.
 */

import { Client, Connection } from "@temporalio/client";
import * as fs from "node:fs";
import * as path from "node:path";

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "citymarkets-audit-task-queue";
const ADDRESS = process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233";
const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "audit-output");

interface AuditReportLike {
  workflow: string;
  total_pages_scanned: number;
  issues_found: { severity: string; category: string; file: string; line?: number; message: string; fix?: string }[];
  dead_code_candidates: string[];
  duplicate_components: { canonical: string; duplicates: string[] }[];
  design_inconsistencies: string[];
  missing_features: string[];
  security_vulnerabilities: { file: string; message: string }[];
  performance_issues: { file: string; message: string }[];
  suggested_fixes: { id: number; issue: string; file: string; fix: string }[];
}

async function main() {
  const connection = await Connection.connect({ address: ADDRESS });
  const client = new Client({ connection });

  console.log(`[audit-client] connected to ${ADDRESS}, task queue ${TASK_QUEUE}`);

  const workflows = [
    "customerJourneyAudit",
    "adminPanelAudit",
    "vendorDashboardAudit",
    "iosWebParityAudit",
    "crossCuttingAudit",
  ];

  const handles = await Promise.all(
    workflows.map((name) =>
      client.workflow.start(name, {
        args: [],
        taskQueue: TASK_QUEUE,
        workflowId: `audit-${name}-${Date.now()}`,
      }),
    ),
  );

  console.log(`[audit-client] started ${handles.length} workflows`);

  const results = await Promise.all(
    handles.map(async (h, i) => {
      const r = await h.result();
      console.log(`[audit-client] ✓ ${workflows[i]} complete: ${r.issues_found.length} issues`);
      return r as AuditReportLike;
    }),
  );

  await aggregate(results);
  console.log("[audit-client] aggregation done — see audit-output/CONSOLIDATED_REPORT.md");
}

function aggregate(reports: AuditReportLike[]) {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const all = reports.flatMap((r) => r.issues_found);
  const by = (k: "severity" | "category") =>
    all.reduce<Record<string, number>>((acc, i) => {
      acc[i[k]] = (acc[i[k]] ?? 0) + 1;
      return acc;
    }, {});

  const critical = all.filter((i) => i.severity === "critical");
  const high = all.filter((i) => i.severity === "high");
  const medium = all.filter((i) => i.severity === "medium");
  const low = all.filter((i) => i.severity === "low");

  const dead = reports.flatMap((r) => r.dead_code_candidates);
  const missing = reports.flatMap((r) => r.missing_features);
  const design = reports.flatMap((r) => r.design_inconsistencies);
  const sec = reports.flatMap((r) => r.security_vulnerabilities);
  const perf = reports.flatMap((r) => r.performance_issues);

  const md = [
    "# CONSOLIDATED REPORT — citymarkets.sa full audit (Temporal)",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Temporal cluster: ${ADDRESS}`,
    `Task queue: ${TASK_QUEUE}`,
    "",
    "## Executive summary",
    "",
    "| Workflow | total_pages_scanned | issues |",
    "|---|---|---|",
    ...reports.map((r) => `| ${r.workflow} | ${r.total_pages_scanned} | ${r.issues_found.length} |`),
    "",
    "## Severity counts",
    "",
    `- CRITICAL: ${critical.length}`,
    `- HIGH:     ${high.length}`,
    `- MEDIUM:   ${medium.length}`,
    `- LOW:      ${low.length}`,
    "",
    "## Category counts",
    "",
    ...Object.entries(by("category"))
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## CRITICAL issues",
    "",
    ...critical.map((i) => `- **${i.file}${i.line ? ":" + i.line : ""}** — ${i.message}${i.fix ? ` — _fix: ${i.fix}_` : ""}`),
    "",
    "## HIGH issues (top 30)",
    "",
    ...high.slice(0, 30).map((i) => `- **${i.file}${i.line ? ":" + i.line : ""}** — ${i.message}${i.fix ? ` — _fix: ${i.fix}_` : ""}`),
    "",
    "## MEDIUM issues (top 50)",
    "",
    ...medium.slice(0, 50).map((i) => `- **${i.file}${i.line ? ":" + i.line : ""}** — ${i.message}${i.fix ? ` — _fix: ${i.fix}_` : ""}`),
    "",
    "## Dead code candidates (top 50)",
    "",
    ...dead.slice(0, 50).map((d) => `- ${d}`),
    "",
    "## Missing iOS endpoints (top 30)",
    "",
    ...missing.slice(0, 30).map((m) => `- ${m}`),
    "",
    "## Design inconsistencies (top 30)",
    "",
    ...design.slice(0, 30).map((d) => `- ${d}`),
    "",
    "## Security vulnerabilities (top 30)",
    "",
    ...sec.slice(0, 30).map((s) => `- **${s.file}** — ${s.message}`),
    "",
    "## Performance issues (top 20)",
    "",
    ...perf.slice(0, 20).map((p) => `- **${p.file}** — ${p.message}`),
    "",
    "## Suggested fixes (per workflow)",
    "",
    ...reports.flatMap((r) => [
      `### ${r.workflow}`,
      "",
      ...r.suggested_fixes.slice(0, 20).map((f) => `${f.id}. \`${f.file}\` — ${f.issue}\n   _Fix:_ ${f.fix}`),
      "",
    ]),
  ].join("\n");

  fs.writeFileSync(path.join(OUT, "CONSOLIDATED_REPORT.md"), md);
  fs.writeFileSync(
    path.join(OUT, "CONSOLIDATED_REPORT.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), reports, totals: { critical: critical.length, high: high.length, medium: medium.length, low: low.length } }, null, 2),
  );
}

main().catch((err) => {
  console.error("[audit-client] fatal:", err);
  process.exit(1);
});