import type { Metadata } from "next";
import { Suspense } from "react";
import { CatalogPage } from "@/components/pages/catalog/catalog-page";
import { getCategoryForSeo } from '@/lib/catalog/seo/product';
import { buildPageMetadata, absoluteUrl, SITE_NAME } from "@/lib/seo/site";
import { CategoryJsonLd } from "@/components/seo/category-json-ld";
import { query } from "@/lib/db";

type PageProps = {
  searchParams: Promise<{ category?: string; q?: string; deals?: string }>;
};

export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const slug = params.category?.trim();
  if (slug) {
    const category = await getCategoryForSeo(slug);
    if (category) {
      return {
        ...buildPageMetadata({
          title: `تسوق ${category.name_ar}`,
          description: `تصفح منتجات ${category.name_ar} في أسواق سيتي — توصيل سريع وعروض يومية.`,
          // Path here is the canonical, but the URL we render is still the legacy
          // /catalog?category= form so the page can mount. We point robots to
          // the canonical /categories/[slug] page and mark the legacy view noindex.
          path: `/categories/${encodeURIComponent(category.slug)}`,
          image: category.icon_url,
        }),
        robots: { index: false, follow: true },
        alternates: {
          canonical: `/categories/${encodeURIComponent(category.slug)}`,
        },
      };
    }
  }

  if (params.deals) {
    return buildPageMetadata({
      title: "العروض والتخفيضات",
      description: "أفضل عروض وتخفيضات السوبرماركت — وفر على مشترياتك مع أسواق سيتي.",
      path: "/catalog?deals=1",
    });
  }

  if (params.q?.trim()) {
    const q = params.q.trim();
    return buildPageMetadata({
      title: `نتائج البحث: ${q}`,
      description: `نتائج البحث عن «${q}» في كتالوج أسواق سيتي.`,
      path: `/catalog?q=${encodeURIComponent(q)}`,
      noIndex: true,
    });
  }

  return buildPageMetadata({
    title: "كتالوج المنتجات",
    description:
      "تصفح آلاف المنتجات — بقالة، ألبان، فواكه، لحوم، ومستلزمات المنزل مع توصيل سريع.",
    path: "/catalog",
  });
}

/**
 * ItemList JSON-LD for the catalog grid. Google uses ItemList (not
 * Product[]) to render product carousels in search. We emit the top 50
 * active products in the current category/deals context so each result
 * page has a discoverable list structure.
 *
 * `force-dynamic` already set on the catalog route, so this query runs on
 * every render — which is fine because `products_unified` is indexed.
 */
async function CatalogItemListJsonLd({
  categorySlug,
  dealsOnly,
  searchTerm,
}: {
  categorySlug?: string;
  dealsOnly?: boolean;
  searchTerm?: string;
}) {
  const params: unknown[] = [];
  const where: string[] = ["p.is_active = TRUE"];
  if (categorySlug) {
    params.push(categorySlug);
    where.push(`c.slug = $${params.length}`);
  }
  if (dealsOnly) {
    where.push("p.discount_price IS NOT NULL AND p.discount_price < p.price");
  }
  if (searchTerm) {
    params.push(`%${searchTerm}%`);
    where.push(`(p.name_ar ILIKE $${params.length} OR p.name_en ILIKE $${params.length})`);
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const result = await query(
    `SELECT p.id::text AS id, p.name_ar, p.name_en,
            p.price, p.discount_price, p.image_url,
            c.slug AS category_slug, c.name_ar AS category_name
     FROM products_unified p
     LEFT JOIN categories c ON c.id = p.category_id
     ${whereClause}
     ORDER BY p.is_featured DESC NULLS LAST, p.updated_at DESC NULLS LAST
     LIMIT 50`,
    params
  );

  if (!result.rows || result.rows.length === 0) return null;

  const items = result.rows.map(
    (
      row: {
        id: string;
        name_ar: string;
        name_en: string | null;
        price: number | string;
        discount_price: number | string | null;
        image_url: string | null;
        category_slug: string | null;
      },
      idx: number,
    ) => {
      const price = Number(row.discount_price ?? row.price ?? 0);
      return {
        "@type": "ListItem",
        position: idx + 1,
        url: absoluteUrl(`/products/${row.id}`),
        name: row.name_ar,
        item: {
          "@type": "Product",
          "@id": absoluteUrl(`/products/${row.id}`),
          name: row.name_ar,
          image: row.image_url ? absoluteUrl(row.image_url) : undefined,
          url: absoluteUrl(`/products/${row.id}`),
          offers: {
            "@type": "Offer",
            priceCurrency: "SAR",
            price: price.toFixed(2),
            availability: "https://schema.org/InStock",
          },
        },
      };
    },
  );

  const schema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: categorySlug
      ? `منتجات ${result.rows[0]?.category_name ?? categorySlug} — ${SITE_NAME}`
      : dealsOnly
        ? `عروض وتخفيضات ${SITE_NAME}`
        : `كتالوج ${SITE_NAME}`,
    itemListOrder: "https://schema.org/ItemListUnordered",
    numberOfItems: result.rows.length,
    itemListElement: items,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export default async function CatalogPageRoute({ searchParams }: PageProps) {
  const params = await searchParams;
  const slug = params.category?.trim();
  const deals = !!params.deals;
  const q = params.q?.trim();
  return (
    <Suspense fallback={
      <div className="max-w-7xl mx-auto px-4 py-12 text-center">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-500">جاري التحميل...</p>
      </div>
    }>
      <CatalogItemListJsonLd
        categorySlug={slug}
        dealsOnly={deals}
        searchTerm={q}
      />
      <CatalogPage />
    </Suspense>
  );
}
