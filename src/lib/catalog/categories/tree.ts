/**
 * Category tree helpers — used by /categories, /categories/[slug], catalog.
 *
 * Categories in this app are stored in a flat `categories` table with a
 * `parent_id` self-reference. Depth up to 3 in production (root → child →
 * grandchild). This module builds, walks, and queries that tree client-side
 * after the API returns a flat row list.
 */

import type { Category, CategoryRow } from "@/lib/types";

export type CategoryTreeNode = Category & {
  children: CategoryTreeNode[];
  descendantCount: number;
};

function asStringId(id: number | string): string {
  return String(id);
}

/**
 * Build a tree of root categories with their nested children.
 * Roots = `parent_id` is null. Sorts roots and children by `sort_order`,
 * then by `name_ar` as a tiebreaker.
 */
export function buildCategoryTree(rows: CategoryRow[]): CategoryTreeNode[] {
  const childrenByParent = new Map<string, CategoryRow[]>();
  const roots: CategoryRow[] = [];

  for (const row of rows) {
    if (row.is_active === false) continue;
    if (row.parent_id == null) {
      roots.push(row);
    } else {
      const key = asStringId(row.parent_id);
      const list = childrenByParent.get(key) ?? [];
      list.push(row);
      childrenByParent.set(key, list);
    }
  }

  const sortFn = (a: CategoryRow, b: CategoryRow) => {
    const ao = a.sort_order ?? 0;
    const bo = b.sort_order ?? 0;
    if (ao !== bo) return ao - bo;
    return a.name_ar.localeCompare(b.name_ar, "ar");
  };

  const buildNode = (row: CategoryRow): CategoryTreeNode => {
    const id = asStringId(row.id);
    const kids = (childrenByParent.get(id) ?? []).sort(sortFn);
    const children = kids.map(buildNode);
    const ownCount = typeof row.product_count === "number" ? row.product_count : 0;
    const descendantCount = ownCount + children.reduce((acc, c) => acc + c.descendantCount, 0);
    return {
      ...row,
      children,
      descendantCount,
    };
  };

  return roots.sort(sortFn).map(buildNode);
}

/** Find a category row by its slug (case-insensitive, URL-decoded). */
export function findCategory(
  rows: CategoryRow[],
  slug: string
): CategoryRow | null {
  if (!slug) return null;
  const needle = decodeURIComponent(slug).trim();
  return rows.find((r) => r.slug === needle) ?? null;
}

/** Build the ancestor chain for a category, from root → self. */
export function getAncestors(
  rows: CategoryRow[],
  slug: string
): CategoryRow[] {
  const self = findCategory(rows, slug);
  if (!self) return [];

  const byId = new Map(rows.map((r) => [asStringId(r.id), r]));
  const chain: CategoryRow[] = [self];
  let current: CategoryRow | undefined = self;
  while (current && current.parent_id != null) {
    const parent = byId.get(asStringId(current.parent_id));
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

/** Siblings of a category (same parent_id), excluding the row itself. */
export function getSiblings(rows: CategoryRow[], slug: string): CategoryRow[] {
  const self = findCategory(rows, slug);
  if (!self) return [];
  return rows.filter(
    (r) =>
      r.id !== self.id &&
      (self.parent_id == null
        ? r.parent_id == null
        : String(r.parent_id) === String(self.parent_id))
  );
}

/** Direct children of a category, sorted by sort_order. */
export function getChildren(rows: CategoryRow[], slug: string): CategoryRow[] {
  const self = findCategory(rows, slug);
  if (!self) return [];
  return rows
    .filter((r) => String(r.parent_id) === String(self.id))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}
