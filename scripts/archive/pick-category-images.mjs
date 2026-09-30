#!/usr/bin/env node
/**
 * Picks one representative product image for every active category.
 *
 * Scoring (highest wins):
 *   +100  product name shares a meaningful token with the category name
 *   + 60  product name matches one of the category's descendant names — this
 *         is what gives broad roots (المقاضي) a product that reads as
 *         "groceries" instead of an arbitrary jar of clove oil
 *   + 40  the product lives directly in the category (not a descendant)
 *   + 25  image file actually exists under public/images/
 *   + 15  product is in stock
 *   - 60  image already used by another category (dedupe pressure)
 *   -500  image is hosted off-site — never pick a remote URL when the local
 *         catalogue has anything at all (thawaniapp.com .jfif files were
 *         winning otherwise, adding a third-party dependency to every render)
 *
 * Emits:
 *   migrations/043_category_product_images.sql  (idempotent UPDATEs by slug)
 *   scripts/out/category-image-review.tsv        (human review table)
 *
 * Usage: node scripts/pick-category-images.mjs [--write]
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = resolve(ROOT, "public");

function databaseUrl() {
  const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
  const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL missing from .env.local");
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

/** Arabic-aware normalisation: unify alef/ya/ta-marbuta, drop diacritics. */
function normalize(s) {
  return (s || "")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[\u0622\u0623\u0625]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase()
    .trim();
}

const STOP = new Set([  "و", "من", "في", "على", "مع", "ال", "منتج", "منتجات", "علبة", "كيس",
  "حبة", "قطعة", "جم", "كجم", "مل", "لتر", "عبوة", "gm", "kg", "ml", "l",
  "the", "and", "of", "pack", "box", "pcs",
]);

function tokens(s) {  return normalize(s)
    .split(/\s+/)
    .map((t) => (t.startsWith("ال") && t.length > 3 ? t.slice(2) : t))
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/**
 * Hand-picked heroes for roots whose own name matches no product. The
 * heuristic lands on something technically in-category but odd for a
 * storefront tile (المقاضي → clove oil, اللحوم → a burger patty), so these
 * two are curated. Everything else is scored automatically.
 */
const OVERRIDES = {
  "المقاضي": "/images/products/35ca358d826b.jpg", // سكر الاسره 10 كجم
  "اللحوم-والدواجن": "/images/products/6af50d77e50d.jpg", // دجاج اليوم مبرد 1400 جرام
};

function fileExists(imageUrl) {
  if (!imageUrl || imageUrl.startsWith("http")) return false;
  return existsSync(resolve(PUBLIC_DIR, imageUrl.replace(/^\//, "")));
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();

  const { rows: cats } = await client.query(
    `SELECT id, slug, name_ar, parent_id, icon_url, sort_order
       FROM categories WHERE is_active = TRUE
      ORDER BY sort_order, name_ar`
  );
  const { rows: prods } = await client.query(
    `SELECT id, category_id, name_ar, image_url, COALESCE(stock_qty, 0) AS stock_qty
       FROM products_unified
      WHERE is_active = TRUE
        AND image_url IS NOT NULL AND TRIM(image_url) <> ''`
  );
  await client.end();

  const childrenOf = new Map();
  for (const c of cats) {
    if (!c.parent_id) continue;
    if (!childrenOf.has(c.parent_id)) childrenOf.set(c.parent_id, []);
    childrenOf.get(c.parent_id).push(c.id);
  }
  const byCategory = new Map();
  for (const p of prods) {
    if (!byCategory.has(p.category_id)) byCategory.set(p.category_id, []);
    byCategory.get(p.category_id).push(p);
  }

  /** own products + everything beneath, tagged with depth. */
  function candidates(catId) {
    const out = [];
    const walk = (id, depth) => {
      for (const p of byCategory.get(id) || []) out.push({ ...p, depth });
      for (const kid of childrenOf.get(id) || []) walk(kid, depth + 1);
    };
    walk(catId, 0);
    return out;
  }

  // Process leaf-first so specific categories claim their best image before
  // broad parents do — parents have a much larger pool to fall back on.
  const depthOf = new Map();
  const computeDepth = (c) => {
    if (depthOf.has(c.id)) return depthOf.get(c.id);
    const parent = c.parent_id ? cats.find((x) => x.id === c.parent_id) : null;
    const d = parent ? computeDepth(parent) + 1 : 0;
    depthOf.set(c.id, d);
    return d;
  };
  cats.forEach(computeDepth);
  const order = [...cats].sort((a, b) => depthOf.get(b) - depthOf.get(a));

  const used = new Set();
  const picks = [];

  for (const cat of order) {
    if (OVERRIDES[cat.slug]) {
      const url = OVERRIDES[cat.slug];
      const match = prods.find((p) => p.image_url === url);
      used.add(url);
      picks.push({
        cat,
        product: { name_ar: match?.name_ar ?? "(curated)", image_url: url },
        score: 999,
        reason: "curated",
      });
      continue;
    }
    const catTokens = new Set(tokens(cat.name_ar));
    // Root categories rarely share a word with any product ("المقاضي" appears
    // on nothing), so also collect the names of everything beneath them.
    const subTokens = new Set();
    const collect = (id) => {
      for (const kid of childrenOf.get(id) || []) {
        const k = cats.find((c) => c.id === kid);
        if (k) for (const t of tokens(k.name_ar)) if (!catTokens.has(t)) subTokens.add(t);
        collect(kid);
      }
    };
    collect(cat.id);

    const pool = candidates(cat.id);
    if (pool.length === 0) {
      picks.push({ cat, product: null, score: 0, reason: "no-products" });
      continue;
    }

    let best = null;
    for (const p of pool) {
      let score = 0;
      const pTokens = tokens(p.name_ar);
      const hits = (set) =>
        pTokens.filter((t) => [...set].some((c) => t.includes(c) || c.includes(t))).length;
      const overlap = hits(catTokens);
      if (overlap > 0) score += 100 + overlap * 5;
      else if (hits(subTokens) > 0) score += 60;
      if (p.depth === 0) score += 40;
      else score -= p.depth * 10;
      if (fileExists(p.image_url)) score += 25;
      if (Number(p.stock_qty) > 0) score += 15;
      if (p.image_url.startsWith("http")) score -= 500;
      if (used.has(p.image_url)) score -= 60;
      // Stable tie-break so re-runs produce byte-identical migrations.
      if (!best || score > best.score || (score === best.score && p.id < best.product.id)) {
        best = { product: p, score };
      }
    }

    used.add(best.product.image_url);
    picks.push({
      cat,
      product: best.product,
      score: best.score,
      reason:
        best.score >= 140
          ? "name-match"
          : best.score >= 60
            ? "subtree-match"
            : best.product.depth === 0
              ? "own-product"
              : "descendant",
    });
  }

  picks.sort(
    (a, b) => (a.cat.sort_order ?? 0) - (b.cat.sort_order ?? 0) ||
      a.cat.name_ar.localeCompare(b.cat.name_ar, "ar")
  );

  const tsv = [
    ["slug", "category", "score", "reason", "product", "image"].join("\t"),
    ...picks.map((p) =>
      [
        p.cat.slug,
        p.cat.name_ar,
        p.score,
        p.reason,
        p.product?.name_ar ?? "-",
        p.product?.image_url ?? "-",
      ].join("\t")
    ),
  ].join("\n");

  mkdirSync(resolve(ROOT, "scripts/out"), { recursive: true });
  writeFileSync(resolve(ROOT, "scripts/out/category-image-review.tsv"), tsv + "\n");

  const usable = picks.filter((p) => p.product);
  const sql = `-- 043_category_product_images.sql
-- Replaces Material-icon keys and external Unsplash URLs in categories.icon_url
-- with a real product image drawn from each category's own catalogue.
--
-- Generated by scripts/pick-category-images.mjs — re-run that script to
-- regenerate. Keyed by slug (not id) so it survives a category reseed, and
-- guarded by an inequality check so re-running is a no-op.

BEGIN;

${usable
  .map(
    (p) =>
      `-- ${p.cat.name_ar} <- ${p.product.name_ar} (${p.reason})\n` +
      `UPDATE categories SET icon_url = ${lit(p.product.image_url)}\n` +
      ` WHERE slug = ${lit(p.cat.slug)} AND icon_url IS DISTINCT FROM ${lit(p.product.image_url)};`
  )
  .join("\n\n")}

COMMIT;
`;
  writeFileSync(resolve(ROOT, "migrations/043_category_product_images.sql"), sql);

  const nameMatched = picks.filter((p) => p.reason === "name-match").length;
  const missing = picks.filter((p) => !p.product).length;
  const broken = usable.filter((p) => !fileExists(p.product.image_url)).length;
  console.log(
    `categories=${picks.length} name-match=${nameMatched} ` +
      `descendant=${picks.filter((p) => p.reason === "descendant").length} ` +
      `no-products=${missing} image-file-missing=${broken} ` +
      `unique-images=${new Set(usable.map((p) => p.product.image_url)).size}`
  );
}

function lit(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
