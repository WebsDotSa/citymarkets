import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/site";
import { query } from "@/lib/db";
import { buildCategoryTree, type CategoryTreeNode } from '@/lib/catalog';
import { CategoriesBrowserV2 } from "@/components/pages/categories/categories-browser-v2";

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildPageMetadata({
  title: "الأقسام",
  description:
    "تصفح كل أقسام السوبرماركت — ألبان، مخبوزات، مشروبات، لحوم، خضار، فواكه، ومستلزمات منزلية في أسواق سيتي.",
  path: "/categories",
});

type CategoryDbRow = {
  id: number | string;
  name_ar: string;
  name_en: string | null;
  slug: string;
  icon_url: string | null;
  parent_id: string | null;
  description_ar: string | null;
  description_en: string | null;
  is_active: boolean | null;
  product_count: number | string | null;
  child_count: number | string | null;
  descendant_count: number | string | null;
  sort_order: number | null;
  parent_slug: string | null;
  parent_name_ar: string | null;
};

/**
 * Marketing display order for the 11 root categories. Fresh foods first
 * (vegetables, dairy, meat, frozen, bakery), then shelf-stable pantry
 * (groceries, snacks, drinks), then non-food. Slug-based so it survives
 * re-runs even if `categories.id` is reseeded.
 */
const MARKETING_ORDER = [
  "الخضروات-والفواكه",
  "اللحوم-والدواجن",
  "الالبان-والاجبان",
  "الأطعمة-المجمدة",
  "المخبوزات",
  "المقاضي",
  "السناكات-والحلويات",
  "المشروبات",
  "العناية-بالمنزل",
  "مستلزمات-المنزل",
  "العناية-الشخصية",
] as const;

function applyMarketingOrder(tree: CategoryTreeNode[]): CategoryTreeNode[] {
  const bySlug = new Map(tree.map((r) => [r.slug, r]));
  const ordered: CategoryTreeNode[] = [];
  const seen = new Set<string>();
  for (const slug of MARKETING_ORDER) {
    const root = bySlug.get(slug);
    if (root) {
      ordered.push(root);
      seen.add(slug);
    }
  }
  const tail = tree
    .filter((r) => !seen.has(r.slug))
    .sort((a, b) => {
      const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (so !== 0) return so;
      return a.name_ar.localeCompare(b.name_ar, "ar");
    });
  return [...ordered, ...tail];
}

export default async function Page() {
  const result = await query(
    `WITH RECURSIVE descendants AS (
       SELECT c.id
       FROM categories c
       WHERE c.is_active = TRUE
       UNION ALL
       SELECT ch.id
       FROM categories ch
       JOIN descendants d ON ch.parent_id = d.id
       WHERE ch.is_active = TRUE
     ),
     per_cat AS (
       SELECT d.id, COALESCE(SUM(
         (SELECT COUNT(*) FROM products_unified p
          WHERE p.category_id = d.id AND p.is_active = TRUE)
       ), 0)::int AS descendant_count
       FROM descendants d
       GROUP BY d.id
     )
     SELECT
       c.id,
       c.name_ar,
       c.name_en,
       c.slug,
       c.icon_url,
       c.parent_id,
       c.description_ar,
       c.description_en,
       c.is_active,
       c.sort_order,
       (SELECT COUNT(*) FROM products_unified p
        WHERE p.category_id = c.id AND p.is_active = TRUE)::int AS product_count,
       (SELECT COUNT(*) FROM categories ch
        WHERE ch.parent_id = c.id AND ch.is_active = TRUE)::int AS child_count,
       COALESCE((SELECT MAX(descendant_count) FROM per_cat WHERE id = c.id), 0)::int
         AS descendant_count,
       p.slug  AS parent_slug,
       p.name_ar AS parent_name_ar
     FROM categories c
     LEFT JOIN categories p ON c.parent_id = p.id
     WHERE c.is_active = TRUE
     ORDER BY c.sort_order ASC, c.name_ar ASC`,
    []
  );

  const rows = ((result.rows ?? []) as unknown as CategoryDbRow[]).map((r) => ({
    ...r,
    is_active: r.is_active ?? true,
    sort_order: r.sort_order ?? 0,
    product_count: Number(r.product_count ?? 0),
    child_count: Number(r.child_count ?? 0),
    descendant_count: Number(r.descendant_count ?? 0),
  }));

  const rawTree: CategoryTreeNode[] = buildCategoryTree(rows);
  const tree = applyMarketingOrder(rawTree);

  const totalChildren = tree.reduce((acc, r) => acc + r.children.length, 0);
  const totalProducts = tree.reduce((acc, n) => acc + n.descendantCount, 0);

  return (
    <CategoriesBrowserV2
      initialTree={tree}
      totalRoots={tree.length}
      totalChildren={totalChildren}
      totalProducts={totalProducts}
    />
  );
}
