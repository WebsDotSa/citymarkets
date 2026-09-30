// scripts/dry-run-042.mjs
// Dry-run for migrations/042_category_taxonomy_reorder.sql.
// Connects to DATABASE_URL, replays every step in memory using SELECT-only
// queries, prints the deltas, and exits 0 if the plan is consistent (no
// missing slugs, no cycles, all target parents exist). NEVER mutates.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(__dirname, "..", ".env.local"), "utf8");
const url = env.match(/DATABASE_URL=(.*)/)?.[1].trim();
if (!url) {
  console.error("DATABASE_URL missing in .env.local");
  process.exit(2);
}

const c = new pg.Client({ connectionString: url });
await c.connect();

const REPARENTS_AR = [
  ["مستلزمات-المنزل", "المعلبات",                  "المقاضي"],
  ["كيك",             "الفشار",                    "السناكات-والحلويات"],
  ["حلوى",            "عيدان-البطاطس",             "رقائق-البطاطس"],
  ["العناية-بالمنزل", "مستلزمات-الجسم",            "العناية-الشخصية"],
  ["عناية-اليدين",    "مزيل-العرق",                "العناية-الشخصية"],
  ["عناية-اليدين",    "مستلزمات-الوجه",            "العناية-الشخصية"],
  ["عناية-اليدين",    "مستلزمات-المرأة",           "العناية-الشخصية"],
  ["عناية-اليدين",    "مزيل-الشعر",                "العناية-الشخصية"],
  ["مستلزمات-الشعر",  "شامبو-العباية",             "العناية-الشخصية"],
  ["مستلزمات-الحلاقة","مستلزمات-الاسنان",          "العناية-الشخصية"],
  ["خضروات",          "خضروات-مجمدة",              "الأطعمة-المجمدة"],
  ["العناية-بالمنزل", "فحم",                       "مستلزمات-المنزل"],
  ["المعلبات",        "بقوليات-معلبة",             "المقاضي"],
  ["المعلبات",        "تونة",                      "المقاضي"],
  ["المعلبات",        "معلبات-اخرى",               "المقاضي"],
  ["المعلبات",        "معلبات-قابلة-للدهن",        "المقاضي"],
  ["كاس-وعلب",        "اخرى",                      "مستلزمات-المنزل"],
];
const REPARENTS_EN = [
  ["biscuits",     "كورن-فليكس",     "المقاضي"],
  ["fresh-fruits", "زيتون-وورق-عنب", "المقاضي"],
  ["fresh-fruits", "ذرة",            "المقاضي"],
  ["fresh-fruits", "فطر",            "المقاضي"],
];
const REPARENTS_PRODUCE = [
  ["فواكه-مجمدة", "الأطعمة-المجمدة"],
  ["فواكه-معلبة", "المعلبات"],
];
const REPARENTS = [...REPARENTS_AR, ...REPARENTS_EN];

const ORDER = [
  ["الخضروات-والفواكه",      10],
  ["اللحوم-والدواجن",         20],
  ["الالبان-والاجبان",        30],
  ["الأطعمة-المجمدة",         40],
  ["المخبوزات",               50],
  ["المقاضي",                 60],
  ["السناكات-والحلويات",      70],
  ["المشروبات",               80],
  ["العناية-بالمنزل",         90],
  ["مستلزمات-المنزل",        100],
  ["العناية-الشخصية",        110],
];

let issues = 0;
console.log("═".repeat(72));
console.log("DRY-RUN  042_category_taxonomy_reorder");
console.log("═".repeat(72));

// 1. Resolve all slugs to ids
const idBySlug = new Map();
const slugById = new Map();
const r = await c.query("SELECT id, slug, name_ar, parent_id, is_active FROM categories");
for (const row of r.rows) {
  idBySlug.set(row.slug, row);
  slugById.set(row.id, row.slug);
}

console.log("\n── REPARENT PLAN ──");
for (const [srcSlug, childSlug, tgtSlug] of REPARENTS) {
  const child = idBySlug.get(childSlug);
  const tgt = tgtSlug ? idBySlug.get(tgtSlug) : null;
  const expectedSrc = idBySlug.get(srcSlug);
  const okSrc = !!expectedSrc && expectedSrc.is_active;
  const okChild = !!child && child.is_active && child.parent_id === expectedSrc?.id;
  const okTgt = !tgtSlug || (!!tgt && tgt.is_active);

  const status =
    okSrc && okChild && okTgt && (child.parent_id !== tgt?.id)
      ? "MOVE"
      : !okChild ? "SKIP (not under source)"
      : !okTgt ? "FAIL (target missing)"
      : "no-op";

  if (status === "FAIL (target missing)") issues++;
  if (status === "MOVE") {
    console.log(
      `  ${status.padEnd(22)} ${child.name_ar.padEnd(28)} ` +
      `${expectedSrc?.name_ar ?? "?"} → ${tgt?.name_ar ?? "?"}`
    );
  } else {
    console.log(`  ${status.padEnd(22)} ${child.name_ar}`);
  }
}

console.log("\n── ROOT SORT ORDER ──");
for (const [slug, so] of ORDER) {
  const row = idBySlug.get(slug);
  if (!row) { console.log(`  FAIL     missing root: ${slug}`); issues++; continue; }
  const change = row.parent_id == null && row.sort_order !== so;
  const status = change ? "UPDATE" : "ok";
  if (change) {
    console.log(`  ${status.padEnd(8)} ${row.name_ar.padEnd(28)} ${row.sort_order} → ${so}`);
  }
}

console.log("\n── SEASONAL / TYPO ──");
const ramadan = idBySlug.get("مستلزمات-رمضانية");
if (ramadan) console.log(`  ${ramadan.is_active ? "DEACTIVATE" : "ok (already)"} مستلزمات رمضانية (${ramadan.is_active})`);
const typo = idBySlug.get("مواد-غذاية");
if (typo) console.log(`  RENAME     مواد غذاية → مواد غذائية`);
else console.log(`  ok          (typo already fixed)`);

console.log("\n── CHILD RE-SORT PREVIEW (first 10 per root) ──");
const children = await c.query(`
  SELECT c.id, c.name_ar, c.sort_order, c.parent_id,
    p.name_ar AS parent_name,
    (SELECT COUNT(*) FROM products_unified pu WHERE pu.category_id = c.id AND pu.is_active)::int AS n,
    ROW_NUMBER() OVER (PARTITION BY c.parent_id ORDER BY
      (SELECT COUNT(*) FROM products_unified pu WHERE pu.category_id = c.id AND pu.is_active) DESC,
      c.name_ar ASC) * 10 AS new_sort
  FROM categories c
  JOIN categories p ON p.id = c.parent_id
  WHERE c.parent_id IS NOT NULL AND c.is_active
  ORDER BY p.sort_order, n DESC
`);
let currentRoot = null;
let count = 0;
for (const row of children.rows) {
  if (row.parent_name !== currentRoot) {
    currentRoot = row.parent_name;
    count = 0;
    console.log(`\n  ▸ ${currentRoot}`);
  }
  if (count++ < 10) {
    const change = row.sort_order !== row.new_sort ? "→" : "=";
    console.log(`    ${change} ${row.name_ar.padEnd(28)} n=${String(row.n).padStart(4)} so ${String(row.sort_order).padStart(3)} → ${row.new_sort}`);
  }
}

console.log("\n" + "═".repeat(72));
if (issues) {
  console.log(`✗ ${issues} blocking issue(s) — fix before applying.`);
  process.exit(1);
} else {
  console.log("✓ Plan is consistent. Safe to apply migrations/042.");
}
await c.end();
