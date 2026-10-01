/**
 * Duplicate Detection Gate — AST-based duplication scanner.
 *
 * Scans `src/` (tests excluded) with the TypeScript compiler API and reports
 * every place where the same responsibility is implemented more than once:
 *
 *   files      — files whose token stream is identical (comments/whitespace ignored)
 *   functions  — function bodies that are identical (exact) or identical after
 *                renaming identifiers (renamed clone), ≥ MIN_FN_TOKENS tokens
 *   types      — interface/type names declared in >1 file, and identical
 *                object shapes (same property-name set) declared under any name
 *   literalSets— string-literal lists (arrays, Sets, z.enum, unions) that look
 *                like domain vocabularies (payment methods, order/payment states)
 *   sql        — identical SQL statements (whitespace/param-normalised) in >1 file
 *   constants  — SCREAMING_CASE top-level constants declared in >1 file
 *   patterns   — hand-rolled pricing / stock / fetch-parsing idioms per file
 *
 * Usage:
 *   npx tsx scripts/scan-duplicates.ts                 # markdown summary
 *   npx tsx scripts/scan-duplicates.ts --json out.json # also write full JSON
 *   npx tsx scripts/scan-duplicates.ts --gate          # exit 1 on unregistered
 *                                                      # domain vocabularies
 *
 * The gate only fails on *domain vocabulary* duplicates (payment methods and
 * order/payment states) that are not listed in `ALLOWED_VOCAB_SITES` — those
 * are the sources of truth this repo has decided must stay single. Other
 * sections are informational: 0 duplicate lines is not the goal, 0 unintended
 * duplicate sources of truth is.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const MIN_FN_TOKENS = 40;
const MIN_SHAPE_PROPS = 4;

const PAYMENT_METHOD_VOCAB = new Set([
  "cash", "card", "mada", "visa", "mastercard", "amex", "apple_pay", "wallet",
  "bank_transfer", "tamara", "stc_pay", "cod", "moyasar", "applepay", "stcpay",
]);
const ORDER_STATE_VOCAB = new Set([
  "pending", "confirmed", "preparing", "ready", "picked_up", "out_for_delivery",
  "on_the_way", "delivering", "delivered", "cancelled", "rejected", "accepted",
  "processing", "awaiting_payment",
]);
const PAYMENT_STATE_VOCAB = new Set([
  "pending", "paid", "failed", "refunded", "partially_refunded", "authorized",
  "completed", "cancelled", "voided", "initiated",
]);

/**
 * Sites that are *allowed* to spell out domain vocabularies inline. Each entry
 * must be the canonical registry itself, or a classified, documented reason
 * (see docs/architecture/canonical-sources.md and
 * docs/audits/2026-09-30-duplication-remediation.md). Keys are
 * `<file>` (whole file) or `<file>#<declaration name>`.
 */
const ALLOWED_VOCAB_SITES: ReadonlyMap<string, string> = new Map([
  ["src/lib/payments/payment-methods.ts", "CANONICAL payment-method registry"],
  ["src/lib/orders/state-machine.ts", "CANONICAL order/vendor-order/payment state machine"],
  ["src/lib/supabase/database.types.ts", "GENERATED DB types"],
  ["src/lib/payments/moyasar.ts#methods", "SPECIALIZED Moyasar API vocabulary (creditcard/applepay/stcpay)"],
  ["src/components/checkout/moyasar-checkout-form.tsx#supported_networks", "SPECIALIZED Moyasar card-network vocabulary"],
  ["src/lib/payments/event-ledger.ts#PaymentGateway", "FALSE_POSITIVE gateway ids, not payment methods"],
  ["src/app/api/admin/driver/orders/history/route.ts#<inline>", "SPECIALIZED driver-history filter subset"],
  ["src/app/api/v1/vendors/[slug]/orders/route.ts#<inline>", "SPECIALIZED vendor timeline 'at or past confirmed'"],
  ["src/app/api/v1/orders/[id]/payment-method/route.ts#LOCKED_PAYMENT_STATUSES", "SPECIALIZED rule: method switch locked once settled"],
  ["src/lib/orders/order-payment-action.ts#TERMINAL_PAYMENT_STATUSES", "LEGACY includes historical 'completed' rows"],
  ["src/app/.well-known/acp/config.json/route.ts#methods", "OPEN DECISION DUP-PM-AGENT: agent manifest advertises cod/google_pay"],
  ["src/app/.well-known/acp.json/route.ts#methods", "OPEN DECISION DUP-PM-AGENT: agent manifest advertises cod/google_pay"],
  ["src/app/api/v1/route.ts#payment_modes_supported", "OPEN DECISION DUP-PM-AGENT: API index advertises cod/google_pay"],
]);
const isAllowedVocab = (v: { file: string; name?: string }) =>
  ALLOWED_VOCAB_SITES.has(v.file) || ALLOWED_VOCAB_SITES.has(`${v.file}#${v.name ?? ""}`);

// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

const rel = (p: string) => relative(ROOT, p).split(sep).join("/");
const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

function tokens(text: string, variant: ts.LanguageVariant, renameIdentifiers: boolean): string[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, variant, text);
  const out: string[] = [];
  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    if (renameIdentifiers && kind === ts.SyntaxKind.Identifier) out.push("$id");
    else out.push(scanner.getTokenText());
    kind = scanner.scan();
  }
  return out;
}

interface Loc { file: string; line: number; name?: string }
type Groups = Map<string, Loc[]>;
const push = (g: Groups, k: string, v: Loc) => { const a = g.get(k); if (a) a.push(v); else g.set(k, [v]); };

const fileGroups: Groups = new Map();
const fnExact: Groups = new Map();
const fnRenamed: Groups = new Map();
const typeNames: Groups = new Map();
const typeShapes: Groups = new Map();
const sqlGroups: Groups = new Map();
const constGroups: Groups = new Map();
const sqlText = new Map<string, string>();
const shapeText = new Map<string, string>();
interface VocabSite extends Loc { domain: string; values: string[] }
const vocabSites: VocabSite[] = [];
interface PatternHit { file: string; pattern: string; count: number }
const patternHits: PatternHit[] = [];

const PATTERNS: Array<[string, RegExp]> = [
  ["pricing:discount_price ?? price", /discount_price\s*\?\?\s*[\w.]*price\b|discount_price\s*\|\|\s*[\w.]*price\b/g],
  ["pricing:effective_price fallback", /effective_price\s*\?\?/g],
  ["stock:stock_qty", /\bstock_qty\b/g],
  ["stock:stock_quantity", /\bstock_quantity\b/g],
  ["stock:available_stock", /\bavailable_stock\b/g],
  ["api:res.json() after fetch", /await\s+\w+\.json\(\)/g],
  ["api:manual error extraction", /\.error\?\.message\s*\?\?|data\.error\s*\|\||json\.error\s*\?\?/g],
];

function classifyVocab(values: string[]): string | null {
  const v = values.filter((x) => x !== "");
  if (v.length < 3) return null;
  const pm = v.filter((x) => PAYMENT_METHOD_VOCAB.has(x)).length;
  const os = v.filter((x) => ORDER_STATE_VOCAB.has(x)).length;
  const ps = v.filter((x) => PAYMENT_STATE_VOCAB.has(x)).length;
  if (pm / v.length >= 0.75) return "payment-method";
  if (ps / v.length >= 0.75 && v.some((x) => x === "paid" || x === "refunded")) return "payment-state";
  if (os / v.length >= 0.75) return "order-state";
  return null;
}

function stringLiterals(nodes: readonly ts.Node[]): string[] | null {
  const out: string[] = [];
  for (const n of nodes) {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal)) out.push(n.literal.text);
    else return null;
  }
  return out;
}

function normaliseSql(s: string): string | null {
  if (!/\b(select\s[\s\S]+\sfrom|insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(s)) return null;
  const n = s
    .replace(/--[^\n]*/g, "")
    .replace(/\$\{[^}]*\}/g, "?")
    .replace(/\$\d+/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return n.length >= 40 ? n : null;
}

function scanFile(abs: string) {
  const file = rel(abs);
  const text = readFileSync(abs, "utf8");
  const isTsx = abs.endsWith(".tsx");
  const variant = isTsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const all = tokens(text, variant, false);
  if (all.length > 30) push(fileGroups, sha(all.join(" ")), { file, line: 1 });

  for (const [name, re] of PATTERNS) {
    const c = (text.match(re) || []).length;
    if (c) patternHits.push({ file, pattern: name, count: c });
  }

  const visit = (node: ts.Node) => {
    // --- functions -------------------------------------------------------
    let fnName: string | undefined;
    let body: ts.Node | undefined;
    if (ts.isFunctionDeclaration(node) && node.body) { fnName = node.name?.text; body = node.body; }
    else if (ts.isMethodDeclaration(node) && node.body) { fnName = node.name.getText(sf); body = node.body; }
    else if (ts.isVariableDeclaration(node) && node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      fnName = node.name.getText(sf); body = node.initializer.body;
    }
    if (body && fnName) {
      const btxt = body.getText(sf);
      const exact = tokens(btxt, variant, false);
      if (exact.length >= MIN_FN_TOKENS) {
        push(fnExact, sha(exact.join(" ")), { file, line: line(node), name: fnName });
        push(fnRenamed, sha(tokens(btxt, variant, true).join(" ")), { file, line: line(node), name: fnName });
      }
    }

    // --- types -----------------------------------------------------------
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      const name = node.name.text;
      push(typeNames, name, { file, line: line(node), name });
      const members = ts.isInterfaceDeclaration(node)
        ? node.members
        : ts.isTypeLiteralNode(node.type) ? node.type.members : undefined;
      if (members) {
        const props = members
          .map((m) => (m.name ? m.name.getText(sf).replace(/['"]/g, "") : ""))
          .filter(Boolean)
          .sort();
        if (props.length >= MIN_SHAPE_PROPS) {
          const k = sha(props.join(","));
          shapeText.set(k, props.join(", "));
          push(typeShapes, k, { file, line: line(node), name });
        }
      }
      if (ts.isTypeAliasDeclaration(node) && ts.isUnionTypeNode(node.type)) {
        const vals = stringLiterals(node.type.types);
        const d = vals && classifyVocab(vals);
        if (d && vals) vocabSites.push({ file, line: line(node), name, domain: d, values: vals });
      }
    }

    // --- literal vocabularies (arrays, Sets, z.enum) ---------------------
    if (ts.isArrayLiteralExpression(node)) {
      const vals = stringLiterals(node.elements);
      const d = vals && classifyVocab(vals);
      if (d && vals) {
        let owner = node.parent;
        while (owner && !ts.isVariableDeclaration(owner) && !ts.isPropertyAssignment(owner) && !ts.isSourceFile(owner)) owner = owner.parent;
        const name = owner && (ts.isVariableDeclaration(owner) || ts.isPropertyAssignment(owner)) ? owner.name.getText(sf) : "<inline>";
        vocabSites.push({ file, line: line(node), name, domain: d, values: vals });
      }
    }

    // --- SQL -------------------------------------------------------------
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node) || ts.isTemplateExpression(node)) {
      const raw = ts.isTemplateExpression(node) ? node.getText(sf).slice(1, -1) : node.text;
      const n = normaliseSql(raw);
      if (n) { const k = sha(n); sqlText.set(k, n); push(sqlGroups, k, { file, line: line(node) }); }
    }

    // --- SCREAMING_CASE top-level constants ------------------------------
    if (ts.isVariableStatement(node) && node.parent === sf) {
      for (const d of node.declarationList.declarations) {
        const n = d.name.getText(sf);
        if (/^[A-Z][A-Z0-9_]{2,}$/.test(n)) push(constGroups, n, { file, line: line(d), name: n });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ---------------------------------------------------------------------------

const files = walk(SRC);
for (const f of files) scanFile(f);

const multiFile = (g: Groups) =>
  [...g.entries()].filter(([, locs]) => new Set(locs.map((l) => l.file)).size > 1)
    .sort((a, b) => b[1].length - a[1].length);

const report = {
  scannedFiles: files.length,
  duplicateFiles: multiFile(fileGroups).map(([, l]) => l.map((x) => x.file)),
  exactFunctionClones: multiFile(fnExact).map(([, l]) => l),
  // renamed clones that are not already reported as exact clones
  renamedFunctionClones: multiFile(fnRenamed)
    .map(([, l]) => l)
    .filter((l) => !multiFile(fnExact).some(([, e]) => e.length === l.length && e.every((x, i) => x.file === l[i].file && x.line === l[i].line))),
  duplicateTypeNames: multiFile(typeNames).map(([name, l]) => ({ name, sites: l })),
  duplicateTypeShapes: multiFile(typeShapes).map(([k, l]) => ({ props: shapeText.get(k), sites: l })),
  duplicateSql: multiFile(sqlGroups).map(([k, l]) => ({ sql: sqlText.get(k)!.slice(0, 220), sites: l })),
  duplicateConstants: multiFile(constGroups).map(([name, l]) => ({ name, sites: l })),
  vocabularies: vocabSites,
  patterns: patternHits,
};

const jsonIdx = process.argv.indexOf("--json");
if (jsonIdx > -1 && process.argv[jsonIdx + 1]) writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(report, null, 2));

const locStr = (l: Loc) => `${l.file}:${l.line}${l.name ? ` (${l.name})` : ""}`;
const out: string[] = [];
out.push(`# Duplicate scan — ${files.length} source files`);
out.push(`\n## Identical files (${report.duplicateFiles.length})`);
for (const g of report.duplicateFiles) out.push(`- ${g.join("  ==  ")}`);
out.push(`\n## Exact function clones across files (${report.exactFunctionClones.length})`);
for (const g of report.exactFunctionClones) out.push(`- ${g.map(locStr).join("  |  ")}`);
out.push(`\n## Renamed function clones across files (${report.renamedFunctionClones.length})`);
for (const g of report.renamedFunctionClones) out.push(`- ${g.map(locStr).join("  |  ")}`);
out.push(`\n## Type names declared in >1 file (${report.duplicateTypeNames.length})`);
for (const g of report.duplicateTypeNames) out.push(`- ${g.name}: ${g.sites.map((s) => `${s.file}:${s.line}`).join(", ")}`);
out.push(`\n## Identical type shapes across files (${report.duplicateTypeShapes.length})`);
for (const g of report.duplicateTypeShapes) out.push(`- {${g.props}}: ${g.sites.map(locStr).join(", ")}`);
out.push(`\n## Identical SQL across files (${report.duplicateSql.length})`);
for (const g of report.duplicateSql) out.push(`- \`${g.sql}\`\n  ${g.sites.map(locStr).join(", ")}`);
out.push(`\n## SCREAMING_CASE constants declared in >1 file (${report.duplicateConstants.length})`);
for (const g of report.duplicateConstants) out.push(`- ${g.name}: ${g.sites.map((s) => `${s.file}:${s.line}`).join(", ")}`);
out.push(`\n## Domain vocabularies spelled inline (${report.vocabularies.length})`);
for (const v of report.vocabularies) {
  const reason = ALLOWED_VOCAB_SITES.get(v.file) ?? ALLOWED_VOCAB_SITES.get(`${v.file}#${v.name ?? ""}`);
  const tag = reason ?? "UNREGISTERED";
  out.push(`- [${v.domain}] [${tag}] ${locStr(v)} → ${v.values.join(",")}`);
}
out.push(`\n## Idiom hits`);
const byPattern = new Map<string, PatternHit[]>();
for (const h of patternHits) { const a = byPattern.get(h.pattern) ?? []; a.push(h); byPattern.set(h.pattern, a); }
for (const [p, hits] of byPattern) out.push(`- ${p}: ${hits.length} files — ${hits.map((h) => `${h.file}(${h.count})`).join(", ")}`);
console.log(out.join("\n"));

if (process.argv.includes("--gate")) {
  const violations = report.vocabularies.filter((v) => !isAllowedVocab(v));
  for (const v of violations) console.error(`  UNREGISTERED ${v.file}:${v.line} (${v.name}) → ${v.values.join(",")}`);
  if (violations.length) {
    console.error(`\nGATE FAIL: ${violations.length} inline domain vocabularies outside canonical sources.`);
    process.exit(1);
  }
  console.error("\nGATE PASS: no inline domain vocabularies outside canonical sources.");
}
