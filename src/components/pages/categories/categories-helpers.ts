/**
 * Shared helpers for /categories.
 *
 * Pure functions + types extracted from the original
 * categories-browser-v2.tsx so the main page component stays under
 * the 800-line soft cap.
 *
 * Nothing in this file imports React — safe to consume from both
 * server and client modules.
 */

import type { Product } from "@/lib/types";
import type { CategoryTreeNode } from "@/lib/categories/tree";
import { emojiForCategoryName } from "@/lib/dynamic-category-groups";

/* ------------------------------------------------------------------------- */
/* Local product shape returned by /api/v1/products — minimum fields the   */
/* inline products panel needs to render a row + card.                       */
/* ------------------------------------------------------------------------- */

export interface ProductsApiItem {
  id: string;
  name_ar: string;
  name_en?: string | null;
  image_url: string | null;
  price: number | string;
  discount_price: number | string | null;
  stock_qty: number;
  category_name?: string | null;
  category_slug?: string | null;
  vendor_id?: string | null;
  vendor_slug?: string | null;
  vendor_name?: string | null;
}

/* ------------------------------------------------------------------------- */
/* Product shape returned by /api/v1/products (just the fields the         */
/* instant-search panel needs to render a row).                             */
/* ------------------------------------------------------------------------- */

export interface SearchedProduct {
  id: string;
  name_ar: string;
  image_url: string | null;
  price: number;
  discount_price: number | null;
  category_name: string | null;
  category_slug: string | null;
  in_stock: boolean;
}

/* ------------------------------------------------------------------------- */
/* Card helpers (kept in sync with the legacy browser so colors don't drift) */
/* ------------------------------------------------------------------------- */

export function bgForCategoryName(name: string): {
  bg: string;
  ring: string;
} {
  const n = name.trim();
  if (/(حليب|لبن|زبادي|ألبان|جبن|زبدة|سمن|قشطة|بيض)/i.test(n)) {
    return { bg: "from-sky-50 to-blue-50", ring: "ring-sky-100" };
  }
  if (/(لحم|دجاج|سمك|روبيان|كباب|برجر|شاورما|مرتديلا|نقانق)/i.test(n)) {
    return { bg: "from-rose-50 to-orange-50", ring: "ring-rose-100" };
  }
  if (/(خبز|مخبوز|كرواسون|توست|كيك|كعك|بسكويت|معمول|فطير)/i.test(n)) {
    return { bg: "from-amber-50 to-yellow-50", ring: "ring-amber-100" };
  }
  if (/(تفاح|برتقال|موز|عنب|بطيخ|شمام|خوخ|مانجو|تمر|رمان|تين|ليمون|فراولة|كرز|خضار|خس|جرجير|نعناع|بقدونس|كزبرة|سبانخ|ملوخية|بامية|كوسة|باذنجان|فلفل|جزر|طماطم|خيار|بصل|ثوم|بطاطس)/i.test(n)) {
    return { bg: "from-lime-50 to-emerald-50", ring: "ring-lime-100" };
  }
  if (/(قهوة|شاي|كاكاو|نسكافيه|كابتشينو|إسبريسو|لاتيه|كرك|زنجبيل|هيل|قرفة|يانسون|بابونج)/i.test(n)) {
    return { bg: "from-orange-50 to-amber-50", ring: "ring-orange-100" };
  }
  if (/(شوكولا|شوكولاتة|حلوى|chips|شيبس|علك|مكسرات|فشار|بونبون|كاكاو|بسكويت|كوكيز|نوجا|كستر|توفي|كريب|حلاوة|طحينية|بسبوسة|لقيمات|كنافة|جاتو|دونات|وافل)/i.test(n)) {
    return { bg: "from-fuchsia-50 to-pink-50", ring: "ring-fuchsia-100" };
  }
  if (/(عصير|مشروب|مياه|كولا|صودا|طاقة)/i.test(n)) {
    return { bg: "from-cyan-50 to-sky-50", ring: "ring-cyan-100" };
  }
  if (/(مجمدة|مجمد|آيس كريم|مثلجات|بوظة)/i.test(n)) {
    return { bg: "from-indigo-50 to-blue-50", ring: "ring-indigo-100" };
  }
  if (/(أرز|معكرونة|مكسرات|سكر|ملح|صلصة|صوص|بهارات|زيت|تونة|معجون|شعيرية|شوربة|فطر|مرتديلا|خردل|مايونيز|كاتشب|شطة|عسل|تمر)/i.test(n)) {
    return { bg: "from-yellow-50 to-amber-50", ring: "ring-yellow-100" };
  }
  if (/(تنظيف|منظف|صابون|كلوركس|ديتول|مسحوق|مناديل|فوط|أكياس|فرشاة|إسفنجة|معطر|جو|مبيد|حشرات|شموع|ملمع)/i.test(n)) {
    return { bg: "from-violet-50 to-purple-50", ring: "ring-violet-100" };
  }
  if (/(شخصية|شعر|بشرة|جسم|عناية|شامبو|بلسم|كريم|لوشن|مكياج|عطر|حلاقة|فرشاة أسنان|معجون|حفائض|واقي شمس|مرطب)/i.test(n)) {
    return { bg: "from-pink-50 to-rose-50", ring: "ring-pink-100" };
  }
  return { bg: "from-slate-50 to-gray-50", ring: "ring-slate-100" };
}

/* ------------------------------------------------------------------------- */
/* Search helpers                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Walk the category tree once and return all matches (roots + children) so
 * the hero results panel and the sidebar share a single ordered list.
 *   - Roots first, then alphabetical.
 *   - Returns plain object literals — caller can map to React nodes.
 */
export function collectCategoryMatches(
  tree: CategoryTreeNode[],
  q: string
): Array<{
  id: string;
  name_ar: string;
  slug: string;
  emoji: string;
  kind: "root" | "child";
}> {
  const ql = q.toLowerCase();
  const out: Array<{
    id: string;
    name_ar: string;
    slug: string;
    emoji: string;
    kind: "root" | "child";
  }> = [];
  for (const root of tree) {
    if (root.name_ar.toLowerCase().includes(ql)) {
      out.push({
        id: String(root.id),
        name_ar: root.name_ar,
        slug: root.slug,
        emoji: emojiForCategoryName(root.name_ar),
        kind: "root",
      });
    }
    for (const child of root.children) {
      if (child.name_ar.toLowerCase().includes(ql)) {
        out.push({
          id: String(child.id),
          name_ar: child.name_ar,
          slug: child.slug,
          emoji: emojiForCategoryName(child.name_ar),
          kind: "child",
        });
      }
    }
  }
  // Roots first, then alphabetical.
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "root" ? -1 : 1;
    return a.name_ar.localeCompare(b.name_ar, "ar");
  });
  return out;
}

/* ------------------------------------------------------------------------- */
/* Product mappers                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Map an API row from /api/v1/products to the strongly-typed Product shape
 * consumed by the storefront `ProductCard`. Fields the API doesn't return
 * are filled with placeholders — the card renders without them.
 */
export function mapApiItemToProduct(p: ProductsApiItem): Product {
  return {
    id: p.id,
    category_id: "",
    name_ar: p.name_ar,
    name_en: p.name_en ?? null,
    barcode: null,
    description: null,
    image_url: p.image_url,
    images: [],
    price: Number(p.price) || 0,
    discount_price:
      p.discount_price != null ? Number(p.discount_price) : null,
    stock_qty: Number(p.stock_qty) || 0,
    unit: "قطعة",
    is_featured: false,
    is_active: true,
    category_name: p.category_name ?? undefined,
    category_slug: p.category_slug ?? undefined,
    category_icon: null,
    vendor_id: p.vendor_id ?? null,
    vendor_slug: p.vendor_slug ?? null,
    vendor_name: p.vendor_name ?? null,
    created_at: "",
    updated_at: "",
  };
}

/** De-duplicate by id, preserving first-occurrence order. */
export function dedupeById(items: Product[]): Product[] {
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
