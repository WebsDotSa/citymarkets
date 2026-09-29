/**
 * Public API: home layout composition.
 *
 *   GET /api/v1/home-layout?device=mobile|desktop
 *
 * Consumed by:
 *   - the web storefront (DynamicHomeLayout) — picked up via the same
 *     `<HomePage>` entry. The store is on a short cache so admin edits
 *     propagate within ~60s.
 *   - the iOS app (out-of-repo) — deserializes the JSON natively and
 *     maps each `Section` to its matching SwiftUI renderer.
 *
 * CORS-enabled so native WebView shells (Capacitor / Ionic) and the
 * `citymarkets://` custom-scheme origin can fetch it. The cache key
 * includes the device type and the schema version (`v1`) so a future
 * breaking change to the section contract auto-busts old entries.
 */
import { NextRequest } from "next/server";
import { ok } from "@/lib/api-response";
import { withCors } from "@/lib/cors";
import { pool } from "@/lib/db";
import { error as logError } from "@/lib/logger";
import {
  DEFAULT_DEVICE,
  DEVICE_TYPES,
  HOME_LAYOUT_VERSION,
  type DeviceType,
  type PublicHomeLayout,
  type Section,
} from '@/lib/catalog/home-layout-types';
import { getCachedHomeLayout } from '@/lib/catalog/home-layout-cache';

// Cache-Control: short so admin edits propagate fast even if the in-process
// cache invalidation missed (e.g. across multiple instances).
const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

function parseDevice(raw: string | null | undefined): DeviceType {
  if (raw && (DEVICE_TYPES as string[]).includes(raw)) {
    return raw as DeviceType;
  }
  return DEFAULT_DEVICE;
}

async function fetchLayout(device: DeviceType): Promise<PublicHomeLayout | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT sections, updated_at FROM home_layouts
       WHERE device_type = $1 AND is_active = TRUE
       LIMIT 1`,
      [device],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    const sections = Array.isArray(row.sections) ? (row.sections as Section[]) : [];
    return {
      device_type: device,
      sections,
      version: HOME_LAYOUT_VERSION,
      updated_at: new Date(row.updated_at).toISOString(),
    };
  } finally {
    client.release();
  }
}

async function handler(request: NextRequest) {
  const device = parseDevice(request.nextUrl.searchParams.get("device"));
  try {
    const layout = await getCachedHomeLayout(device, HOME_LAYOUT_VERSION, () =>
      fetchLayout(device),
    );
    // Empty layout is a valid response — the storefront falls back to
    // HomeRedesign. Don't 404 here; that breaks the SPA's boot path.
    return ok(
      layout ?? {
        device_type: device,
        sections: [],
        version: HOME_LAYOUT_VERSION,
        updated_at: new Date().toISOString(),
      },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch (error) {
    logError("v1.home-layout.GET", error);
    return ok(
      {
        device_type: device,
        sections: [],
        version: HOME_LAYOUT_VERSION,
        updated_at: new Date().toISOString(),
      },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }
}

export const dynamic = "force-dynamic";
export const GET = withCors(handler);