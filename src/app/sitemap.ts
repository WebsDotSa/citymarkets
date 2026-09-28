import type { MetadataRoute } from "next";
import { buildFullSitemap, productSitemapEntries } from "@/lib/seo/sitemap-sources";
import { absoluteUrl } from "@/lib/seo/site";
import { query } from "@/lib/db";
import { warn as logWarn } from "@/lib/logger";

/** يُحدَّث كل ساعة من قاعدة البيانات — منتجات + أقسام + صفحات ثابتة */
export const dynamic = "force-dynamic";
export const revalidate = 3600;

/**
 * Google Image Sitemap extension:
 *   <url>
 *     <loc>https://citymarkets.sa/products/abc</loc>
 *     <image:image>
 *       <image:loc>https://citymarkets.sa/uploads/x.jpg</image:loc>
 *       <image:title>اسم المنتج</image:title>
 *       <image:caption>وصف مختصر</image:caption>
 *     </image:image>
 *   </url>
 *
 * Image sitemap helps Google Images index product photos and surface them
 * in `site:citymarkets.sa` image search. We only emit products that have a
 * non-null `image_url` so we never link to a placeholder.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const entries = await buildFullSitemap();

    // Image extension lookup: pull every product URL + its primary image.
    // Single query, joined to keep N+1 cost out of the build.
    let imagesByUrl = new Map<string, Array<{ loc: string; title: string; caption: string }>>();
    try {
      const imageRows = await query<{
        id: string;
        name_ar: string;
        description_ar: string | null;
        image_url: string | null;
      }>(
        `SELECT id::text AS id, name_ar, description_ar, image_url
         FROM products_unified
         WHERE is_active = TRUE AND image_url IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT 5000`
      );
      imagesByUrl = new Map(
        imageRows.rows
          .filter((row) => row.image_url)
          .map((row) => [
            absoluteUrl(`/products/${row.id}`),
            [
              {
                loc: row.image_url!.startsWith("http")
                  ? row.image_url!
                  : absoluteUrl(row.image_url!),
                title: row.name_ar,
                caption: row.description_ar?.slice(0, 160) ?? row.name_ar,
              },
            ],
          ]),
      );
    } catch (imageErr) {
      logWarn("[sitemap] image lookup failed, falling back to plain URLs", {
        error: imageErr instanceof Error ? imageErr.message : String(imageErr),
      });
    }

    void productSitemapEntries; // referenced to keep tree-shaking honest

    return entries.map((entry) => {
      const imgs = imagesByUrl.get(entry.url);
      // MetadataRoute.Sitemap entries don't carry images, so the image
      // sitemap lives in /sitemap-images.xml (see app/sitemap-images.xml).
      // We still expose this for completeness and to keep the type contract.
      return {
        url: entry.url,
        lastModified: entry.lastModified,
        changeFrequency: entry.changeFrequency,
        priority: entry.priority,
        ...(imgs && imgs.length > 0
          ? {
              // Next.js typings don't yet include `images` but the runtime
              // accepts the property and it serialises into <image:image>.
              // Cast to any to avoid `as unknown as MetadataRoute.Sitemap[number]`
              // noise across the codebase.
              ...({
                images: imgs.map((i) => ({
                  loc: i.loc,
                  title: i.title,
                  caption: i.caption,
                })),
              } as Record<string, unknown>),
            }
          : {}),
      } as MetadataRoute.Sitemap[number];
    });
  } catch (error) {
    logWarn("[sitemap] failed to build sitemap", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
