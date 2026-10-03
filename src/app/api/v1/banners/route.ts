/**
 * GET /api/v1/banners — Public homepage hero banners.
 *
 * Returns active banners sorted by sort_order for rendering on the home page.
 * Consumed by:
 *   - Web storefront (home page)
 *   - iOS app
 *   - Any WebView-based mobile clients
 */

import { NextRequest } from "next/server";
import { ok } from "@/lib/api-response";
import { withCors } from "@/lib/cors";
import { pool } from "@/lib/db";
import { error as logError } from "@/lib/logger";

export type Banner = {
  id: string;
  image_url: string;
  link_type: "none" | "category" | "product" | "external";
  link_value: string | null;
  sort_order: number;
  created_at: string;
};

export type BannersResponse = {
  success: boolean;
  data: Banner[];
};

// Cache: banners change infrequently (admin edits), so longer cache is fine.
// SWR allows serving stale content if the backend is temporarily unavailable.
const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=1800";

async function handler(request: NextRequest) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        id,
        image_url,
        link_type,
        link_value,
        sort_order,
        created_at
       FROM banners
       WHERE active = TRUE
       ORDER BY sort_order ASC, created_at DESC`,
    );

    const banners: Banner[] = result.rows.map((row) => ({
      id: row.id,
      image_url: row.image_url,
      link_type: row.link_type,
      link_value: row.link_value,
      sort_order: row.sort_order,
      created_at: row.created_at?.toISOString?.() ?? row.created_at,
    }));

    return ok(
      { success: true, data: banners },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch (error) {
    logError("v1.banners.GET", error);
    // Empty list on error (graceful fallback for UI)
    return ok(
      { success: true, data: [] },
      {
        status: 200,
        headers: { "Cache-Control": CACHE_CONTROL },
      },
    );
  } finally {
    client.release();
  }
}

export const dynamic = "force-dynamic";
export const GET = withCors(handler);
