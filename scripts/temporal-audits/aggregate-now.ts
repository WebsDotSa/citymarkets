/**
 * Manual aggregation of the most recent run of each workflow.
 * Run when the live client was killed before aggregate() finished.
 *
 *   npx tsx scripts/temporal-audits/aggregate-now.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "audit-output");

const workflows = [
  "customerJourneyAudit",
  "adminPanelAudit",
  "vendorDashboardAudit",
  "iosWebParityAudit",
  "crossCuttingAudit",
];

const reports = workflows.map((wf) => {
  const files = fs
    .readdirSync(OUT)
    .filter((f) => f.startsWith(wf + "-") && f.endsWith(".json"))
    .map((f) => path.join(OUT, f));
  if (files.length === 0) throw new Error(`No report for ${wf}`);
  // newest = largest mtime
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return JSON.parse(fs.readFileSync(files[0], "utf-8"));
});

const all = reports.flatMap((r: any) => r.issues_found);
const by = (k: string) =>
  all.reduce<Record<string, number>>((acc, i: any) => {
    acc[i[k]] = (acc[i[k]] ?? 0) + 1;
    return acc;
  }, {});

const critical = all.filter((i: any) => i.severity === "critical");
const high = all.filter((i: any) => i.severity === "high");
const medium = all.filter((i: any) => i.severity === "medium");
const low = all.filter((i: any) => i.severity === "low");

const dead = reports.flatMap((r: any) => r.dead_code_candidates);
const missing = reports.flatMap((r: any) => r.missing_features);
const design = reports.flatMap((r: any) => r.design_inconsistencies);
const sec = reports.flatMap((r: any) => r.security_vulnerabilities);
const perf = reports.flatMap((r: any) => r.performance_issues);

const md = [
  "# CONSOLIDATED REPORT — citymarkets.sa full audit (Temporal)",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Source: 5 Temporal workflows on citymarkets-audit-task-queue`,
  "",
  "## Executive summary",
  "",
  "| Workflow | pages_scanned | issues_found |",
  "|---|---|---|",
  ...reports.map((r: any) => `| ${r.workflow} | ${r.total_pages_scanned} | ${r.issues_found.length} |`),
  "",
  `Total: **${all.length} issues** across 5 workflows`,
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
  ...(critical.length === 0 ? ["_none_"] : critical.map((i: any) => `- **${i.file}${i.line ? ":" + i.line : ""}** — ${i.message}`)),
  "",
  "## HIGH issues",
  "",
  ...(high.length === 0 ? ["_none_"] : high.map((i: any) => `- **${i.file}${i.line ? ":" + i.line : ""}** — ${i.message}${i.fix ? `\n  _fix:_ ${i.fix}` : ""}`)),
  "",
  "## MEDIUM issues (top 30)",
  "",
  ...medium.slice(0, 30).map((i: any) => `- **${i.file}${i.line ? ":" + i.line : ""}** — ${i.message}${i.fix ? `\n  _fix:_ ${i.fix}` : ""}`),
  "",
  "## LOW issues (top 30)",
  "",
  ...low.slice(0, 30).map((i: any) => `- **${i.file}${i.line ? ":" + i.line : ""}** — ${i.message}${i.fix ? `\n  _fix:_ ${i.fix}` : ""}`),
  "",
  "## Dead code candidates (top 30)",
  "",
  ...(dead.length === 0 ? ["_none_"] : dead.slice(0, 30).map((d: string) => `- ${d}`)),
  "",
  "## Missing iOS endpoints (top 30)",
  "",
  ...(missing.length === 0 ? ["_none_"] : missing.slice(0, 30).map((m: string) => `- ${m}`)),
  "",
  "## Suggested fixes (per workflow, top 10)",
  "",
  ...reports.flatMap((r: any) => [
    `### ${r.workflow}`,
    "",
    ...(r.suggested_fixes || []).slice(0, 10).map((f: any) => `${f.id}. \`${f.file}\` — ${f.issue}\n   _Fix:_ ${f.fix}`),
    "",
  ]),
].join("\n");

fs.writeFileSync(path.join(OUT, "CONSOLIDATED_REPORT.md"), md);
fs.writeFileSync(
  path.join(OUT, "CONSOLIDATED_REPORT.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      reports,
      totals: { critical: critical.length, high: high.length, medium: medium.length, low: low.length },
    },
    null,
    2,
  ),
);

console.log(`[aggregate-now] CRITICAL=${critical.length} HIGH=${high.length} MEDIUM=${medium.length} LOW=${low.length}`);
console.log("[aggregate-now] wrote audit-output/CONSOLIDATED_REPORT.md");