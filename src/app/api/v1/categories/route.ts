import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { cache, CACHE_TTL } from "@/lib/cache";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export const dynamic = "force-dynamic";

// GET /api/v1/categories - Get all active categories (public)
//
// Additive changes vs v1 (key bumped to categories:v2):
//  - parent_slug, parent_name_ar via LEFT JOIN self
//  - product_count cast to ::int
//  - descendant_count via recursive CTE (sums product_count across all descendants)
//
// Slice 1 (multi-vendor marketplace): product_count, descendant_count, and
// the fallback category icon now read from `products_unified` instead of
// `products` so third-party vendor listings are counted alongside the
// City Markets catalog. Cache key bumped to v4 to invalidate pre-Slice-1
// payloads.
export async function GET() {
  try {
    const cacheKey = "categories:all:v7";

    const cached = cache.get<unknown[]>(cacheKey);
    if (cached) {
      return NextResponse.json({ success: true, data: cached, cached: true });
    }

    const activeFilter = "AND ch.is_active = TRUE";

    const result = await query(
      `WITH RECURSIVE visible AS (
         SELECT c.id
         FROM categories c
         WHERE c.parent_id IS NULL AND c.is_active = TRUE
         UNION ALL
         SELECT ch.id
         FROM categories ch
         JOIN visible v ON ch.parent_id = v.id
         WHERE ch.is_active = TRUE
       ),
       descendants AS (
         SELECT v.id AS root_id, v.id AS descendant_id
         FROM visible v
         UNION ALL
         SELECT d.root_id, ch.id
         FROM descendants d
         JOIN categories ch ON ch.parent_id = d.descendant_id
         WHERE ch.is_active = TRUE
       ),
       per_cat AS (
         SELECT d.root_id AS id, COUNT(p.id)::int AS descendant_count
         FROM descendants d
         LEFT JOIN products_unified p
           ON p.category_id = d.descendant_id
          AND p.is_active = TRUE
         GROUP BY d.root_id
       )
       SELECT
         c.id,
         c.name_ar,
         c.name_en,
         c.slug,
         c.parent_id,
         c.sort_order,
         c.is_active,
         c.description_ar,
         c.description_en,
         p.slug         AS parent_slug,
         p.name_ar      AS parent_name_ar,
         (SELECT COUNT(*) FROM products_unified p2
          WHERE p2.category_id = c.id AND p2.is_active = TRUE)::int AS product_count,
         COALESCE((SELECT MAX(descendant_count) FROM per_cat WHERE id = c.id), 0)::int
           AS descendant_count,
         (SELECT COUNT(*) FROM categories ch
          WHERE ch.parent_id = c.id ${activeFilter})::int AS child_count,
         COALESCE(
           CASE
             WHEN c.icon_url LIKE '/images/%'
               OR c.icon_url LIKE 'http://%'
               OR c.icon_url LIKE 'https://%'
               OR c.icon_url ~* '\\.(jpg|jpeg|png|webp|gif|svg)(\\?.*)?$'
             THEN c.icon_url
           END,
           fp.image_url
         ) AS icon_url
       FROM categories c
       JOIN visible v ON v.id = c.id
       LEFT JOIN categories p ON c.parent_id = p.id
       LEFT JOIN LATERAL (
         SELECT pr.image_url
         FROM products_unified pr
         WHERE pr.category_id = c.id
           AND pr.image_url IS NOT NULL
           AND TRIM(pr.image_url) <> ''
         ORDER BY pr.is_active DESC, pr.sort_order DESC, pr.id
         LIMIT 1
       ) fp ON true
       WHERE c.is_active = TRUE
       ORDER BY c.sort_order ASC, c.name_ar ASC`,
      []
    );

    cache.set(cacheKey, result.rows, CACHE_TTL.LONG);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    logError("Error fetching categories:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch categories" },
      { status: 500 }
    );
  }
}
