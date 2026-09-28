import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/site";
import { query } from "@/lib/db";
import { OffersBrowser } from "@/components/pages/offers/offers-browser";

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildPageMetadata({
  title: "العروض والتخفيضات",
  description:
    "تصفّح أحدث العروض والتخفيضات على المنتجات في أسواق سيتي — خصومات يومية، عروض موسمية، وصفقات مميزة.",
  path: "/offers",
});

interface OfferDbRow {
  id: string;
  title_ar: string;
  title_en: string | null;
  description_ar: string | null;
  description_en: string | null;
  image_url: string;
  discount_type: "percentage" | "fixed";
  discount_value: string | number;
  max_discount: string | number | null;
  min_order: string | number | null;
  starts_at: string;
  ends_at: string;
  is_featured: boolean;
  sort_order: number;
  applies_to: "catalog" | "vendor" | "mixed";
  product_count: string | number;
}

const offerSelectSQL = `
  SELECT o.id, o.title_ar, o.title_en, o.description_ar, o.description_en,
         o.image_url, o.discount_type, o.discount_value,
         o.max_discount, o.min_order,
         o.starts_at, o.ends_at, o.is_featured, o.sort_order, o.applies_to,
         (
           SELECT COUNT(DISTINCT p.id)
             FROM offer_targets ot
             JOIN products_unified_with_offers p
               ON ( (ot.target_type = 'product'  AND ot.target_id = p.id)
                  OR (ot.target_type = 'category' AND ot.target_id = p.category_id)
                  OR (ot.target_type = 'vendor'   AND ot.target_id = p.vendor_id)
                  OR (ot.target_type = 'all') )
            WHERE ot.offer_id = o.id
         )::int AS product_count
    FROM offers o
   WHERE o.is_active = TRUE
     AND NOW() BETWEEN o.starts_at AND o.ends_at
   ORDER BY o.is_featured DESC, o.sort_order ASC, o.ends_at ASC
`;

function toNumberOrZero(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function toNumber(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export default async function OffersLandingPage() {
  const result = await query(offerSelectSQL, []);
  const rows = (result.rows ?? []) as unknown as OfferDbRow[];

  const offers = rows.map((r) => ({
    id: r.id,
    title_ar: r.title_ar,
    image_url: r.image_url,
    discount_type: r.discount_type,
    discount_value: toNumberOrZero(r.discount_value),
    max_discount: toNumber(r.max_discount),
    min_order: toNumber(r.min_order),
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    is_featured: r.is_featured,
    product_count: toNumberOrZero(r.product_count),
  }));

  const featured = offers.filter((o) => o.is_featured).slice(0, 3);
  const rest = offers;

  return (
    <OffersBrowser
      featured={featured}
      offers={rest}
      totalCount={offers.length}
    />
  );
}
