import { query } from "@/lib/db";
import { getSiteUrl } from "@/lib/seo/site";
import { warn as logWarn } from "@/lib/logger";

export type SitemapEntry = {
  url: string;
  lastModified: Date;
  changeFrequency: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority: number;
};

const PUBLIC_STATIC_PATHS: {
  path: string;
  changeFrequency: SitemapEntry["changeFrequency"];
  priority: number;
}[] = [
  { path: "", changeFrequency: "daily", priority: 1 },
  { path: "/catalog", changeFrequency: "daily", priority: 0.95 },
  { path: "/categories", changeFrequency: "weekly", priority: 0.9 },
  { path: "/offers", changeFrequency: "daily", priority: 0.9 },
  { path: "/terms", changeFrequency: "monthly", priority: 0.4 },
  { path: "/privacy", changeFrequency: "monthly", priority: 0.4 },
  { path: "/help", changeFrequency: "monthly", priority: 0.5 },
  { path: "/employment", changeFrequency: "monthly", priority: 0.5 },
  { path: "/landing", changeFrequency: "weekly", priority: 0.7 },
  { path: "/auth/login", changeFrequency: "monthly", priority: 0.3 },
];

export function staticSitemapEntries(): SitemapEntry[] {
  const base = getSiteUrl();
  const now = new Date();
  return PUBLIC_STATIC_PATHS.map(({ path, changeFrequency, priority }) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}

export async function categorySitemapEntries(): Promise<SitemapEntry[]> {
  const base = getSiteUrl();
  const result = await query(
    `SELECT slug
     FROM categories
     WHERE slug IS NOT NULL AND TRIM(slug) <> ''
     ORDER BY sort_order ASC, name_ar ASC`
  );

  const now = new Date();
  return result.rows.map((row: { slug: string }) => ({
    url: `${base}/categories/${encodeURIComponent(row.slug)}`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.85,
  }));
}

export async function productSitemapEntries(): Promise<SitemapEntry[]> {
  const base = getSiteUrl();
  // Slice 1: sitemap reads from `products_unified` so third-party vendor
  // product pages are indexed alongside the City Markets catalog.
  const result = await query(
    `SELECT id::text AS id, updated_at
     FROM products_unified
     WHERE is_active = true
     ORDER BY updated_at DESC`
  );

  return result.rows.map((row: { id: string; updated_at: Date | string }) => ({
    url: `${base}/products/${row.id}`,
    lastModified: row.updated_at ? new Date(row.updated_at) : new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));
}

export async function offerSitemapEntries(): Promise<SitemapEntry[]> {
  const base = getSiteUrl();
  // Slice 5 — emit sitemap entries for active, in-window offers so each
  // /offers/[id] detail page is discoverable. We only emit rows that
  // are currently public-visible (is_active + valid window) — search
  // engines should not surface ended/scheduled offers.
  const result = await query(
    `SELECT id::text AS id, updated_at
       FROM offers
      WHERE is_active = TRUE
        AND NOW() BETWEEN starts_at AND ends_at
      ORDER BY updated_at DESC`
  );

  return result.rows.map((row: { id: string; updated_at: Date | string }) => ({
    url: `${base}/offers/${row.id}`,
    lastModified: row.updated_at ? new Date(row.updated_at) : new Date(),
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));
}

export async function buildFullSitemap(): Promise<SitemapEntry[]> {
  const staticEntries = staticSitemapEntries();

  try {
    const [categories, products, offers] = await Promise.all([
      categorySitemapEntries(),
      productSitemapEntries(),
      offerSitemapEntries(),
    ]);
    return [...staticEntries, ...categories, ...products, ...offers];
  } catch (error) {
    logWarn("[sitemap] DB unavailable, static URLs only", { error: error instanceof Error ? error.message : String(error) });
    return staticEntries;
  }
}
