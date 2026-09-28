import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo/site";
import {
  getCategoryForSeo,
  getCategoryByNameAr,
} from "@/lib/seo/product";
import { CategoryJsonLd } from "@/components/seo/category-json-ld";
import { CategoryDetailClient } from "@/components/pages/categories/category-detail-client";
import { query } from "@/lib/db";
import type { CategoryRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

function normalizeSlug(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Resolve the canonical slug for this URL. If the user landed on the Arabic
 * name (which used to be matched by `slug OR name_ar`), we still try to find
 * a category and expose its canonical slug via `<link rel="canonical">` and
 * a 301-style path in metadata.robots — but we don't redirect via Server
 * Component `redirect()` because proxy.ts (middleware) overrides the response
 * status in this Next.js setup.
 *
 * Returns:
 *   - the canonical slug + the matched row (for rendering)
 *   - null if no category matches (caller should call notFound())
 */
async function resolveCategoryBySlugOrName(
  rawSlug: string
): Promise<{ canonicalSlug: string; meta: Awaited<ReturnType<typeof getCategoryForSeo>> } | null> {
  const slug = normalizeSlug(rawSlug);

  // Happy path: the URL is the canonical slug.
  const meta = await getCategoryForSeo(slug);
  if (meta) {
    return { canonicalSlug: meta.slug, meta };
  }

  // The URL is the Arabic name. We don't redirect (Server Component
  // redirects are intercepted by proxy.ts and return 200 instead of 307
  // in this Next.js 16 setup). Instead, the canonical URL in metadata
  // + `<link rel="canonical">` will consolidate ranking signals.
  const byName = await getCategoryByNameAr(slug);
  if (byName) {
    return { canonicalSlug: byName.slug, meta: byName };
  }

  return null;
}

const loadCategory = cache(async (canonicalSlug: string) => {
  const slug = normalizeSlug(canonicalSlug);
  const meta = await getCategoryForSeo(slug);
  if (!meta) return null;

  const all = await query(
    `SELECT id, name_ar, name_en, slug, icon_url, parent_id, sort_order,
            description_ar, description_en, is_active,
            -- Slice 1: count vendor listings alongside the legacy
            -- catalog so the per-category product_count shown in the
            -- sidebar reflects the unified store.
            (SELECT COUNT(*) FROM products_unified p
             WHERE p.category_id = c.id AND p.is_active = TRUE)::int AS product_count,
            (SELECT COUNT(*) FROM categories ch
             WHERE ch.parent_id = c.id AND ch.is_active = TRUE)::int AS child_count
     FROM categories c
     WHERE c.is_active = TRUE
     ORDER BY c.sort_order ASC, c.name_ar ASC`,
    []
  );
  const rows = ((all.rows ?? []) as unknown as CategoryRow[]).map((r) => ({
    ...r,
    is_active: r.is_active ?? true,
    product_count: Number(r.product_count ?? 0),
    child_count: Number(r.child_count ?? 0),
  }));

  const self = rows.find((r) => String(r.id) === String(meta.id)) ?? null;
  if (!self) return null;

  // Look up parent INDEPENDENTLY of the active-only filter above so a
  // temporarily hidden parent still appears in the breadcrumb.
  let parent: CategoryRow | null = null;
  if (self.parent_id) {
    const parentRow = await query(
      `SELECT id, name_ar, name_en, slug, icon_url, parent_id, sort_order,
              description_ar, description_en, is_active
       FROM categories WHERE id = $1 LIMIT 1`,
      [self.parent_id]
    );
    if (parentRow.rows[0]) {
      const r = parentRow.rows[0] as Record<string, unknown>;
      const activeRow = rows.find((x) => String(x.id) === String(self.parent_id));
      parent = {
        id: String(r.id),
        name_ar: String(r.name_ar ?? ""),
        name_en: (r.name_en as string | null) ?? null,
        slug: String(r.slug ?? ""),
        icon_url: (r.icon_url as string | null) ?? null,
        parent_id: (r.parent_id as string | null) ?? null,
        sort_order: Number(r.sort_order ?? 0),
        description_ar: (r.description_ar as string | null) ?? null,
        description_en: (r.description_en as string | null) ?? null,
        is_active: Boolean(r.is_active),
        product_count: Number(activeRow?.product_count ?? 0),
        child_count: Number(activeRow?.child_count ?? 0),
      };
    }
  }

  const children = rows
    .filter((r) => String(r.parent_id) === String(self.id))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const siblings = parent
    ? rows.filter(
        (r) =>
          String(r.parent_id) === String(parent!.id) &&
          String(r.id) !== String(self.id)
      )
    : rows.filter((r) => !r.parent_id && String(r.id) !== String(self.id));

  return { meta, self, parent, children, siblings };
});

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolveCategoryBySlugOrName(slug);
  if (!resolved) {
    return buildPageMetadata({
      title: "القسم غير موجود",
      description: "تعذّر العثور على هذا القسم.",
      path: `/categories/${encodeURIComponent(normalizeSlug(slug))}`,
      noIndex: true,
    });
  }
  const { canonicalSlug, meta } = resolved;
  // Mark non-canonical URLs (user landed via Arabic name) for exclusion —
  // canonical link in metadata will consolidate ranking to the slug URL.
  const isCanonical = normalizeSlug(slug) === canonicalSlug;
  return buildPageMetadata({
    title: `${meta?.name_ar ?? "قسم"} — تسوق أونلاين | أسواق سيتي`,
    description:
      meta?.description_ar ??
      `تصفح ${meta?.name_ar ?? "القسم"} في أسواق سيتي — توصيل سريع وعروض يومية.`,
    path: `/categories/${encodeURIComponent(canonicalSlug)}`,
    image: meta?.icon_url ?? null,
    noIndex: !isCanonical,
  });
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const resolved = await resolveCategoryBySlugOrName(slug);
  if (!resolved) notFound();
  const { canonicalSlug } = resolved;
  const data = await loadCategory(canonicalSlug);
  if (!data) notFound();

  const { self, parent, children, siblings } = data;
  const breadcrumb: Array<{ name: string; href: string }> = [
    { name: "الرئيسية", href: "/" },
    { name: "الأقسام", href: "/categories" },
  ];
  if (parent) {
    breadcrumb.push({
      name: parent.name_ar,
      href: `/categories/${encodeURIComponent(parent.slug)}`,
    });
  }
  breadcrumb.push({
    name: self.name_ar,
    href: `/categories/${encodeURIComponent(self.slug)}`,
  });

  return (
    <>
      <CategoryJsonLd
        name={self.name_ar}
        slug={self.slug}
        description={self.description_ar ?? undefined}
        image={self.icon_url ?? undefined}
        breadcrumb={breadcrumb}
        canonicalPath={`/categories/${encodeURIComponent(self.slug)}`}
      />
      <CategoryDetailClient
        slug={self.slug}
        category={self}
        parent={parent}
        children={children}
        siblings={siblings}
      />
    </>
  );
}
