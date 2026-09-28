/**
 * Google Image Sitemap.
 *
 * Spec: https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps
 *
 * We extend the standard URL sitemap with <image:image> nodes for every
 * active product so Google Images can index product photography directly.
 * The XML namespace declares the image extension so crawlers parse it
 * without falling back to a custom parser.
 */
import { query } from "@/lib/db";
import { absoluteUrl, getSiteUrl } from "@/lib/seo/site";
import { warn as logWarn } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const siteUrl = getSiteUrl();

  let rows: Array<{
    id: string;
    name_ar: string;
    description_ar: string | null;
    image_url: string;
    updated_at: Date | string | null;
  }> = [];

  try {
    const result = await query<{
      id: string;
      name_ar: string;
      description_ar: string | null;
      image_url: string;
      updated_at: Date | string | null;
    }>(
      `SELECT id::text AS id, name_ar, description_ar, image_url, updated_at
       FROM products_unified
       WHERE is_active = TRUE AND image_url IS NOT NULL
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 5000`
    );
    rows = result.rows;
  } catch (err) {
    logWarn("[sitemap-images] DB unavailable", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const urls = rows
    .map((row) => {
      const imageLoc = row.image_url.startsWith("http")
        ? row.image_url
        : absoluteUrl(row.image_url);
      const pageLoc = `${siteUrl}/products/${row.id}`;
      const caption = (row.description_ar ?? row.name_ar).slice(0, 160);
      return `  <url>
    <loc>${escapeXml(pageLoc)}</loc>
    <image:image>
      <image:loc>${escapeXml(imageLoc)}</image:loc>
      <image:title>${escapeXml(row.name_ar)}</image:title>
      <image:caption>${escapeXml(caption)}</image:caption>
    </image:image>
  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
