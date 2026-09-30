import { toNumberOrNull, toNumberOrZero } from "@/lib/format";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo/site";
import { query } from "@/lib/db";
import { OfferDetail } from "@/components/pages/offers/offer-detail";
import { OfferJsonLd } from "@/components/seo/offer-json-ld";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface OfferDetailRow {
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
}

async function loadOffer(id: string) {
  const res = await query(
    `SELECT o.id, o.title_ar, o.title_en, o.description_ar, o.description_en,
            o.image_url, o.discount_type, o.discount_value, o.max_discount,
            o.min_order, o.starts_at, o.ends_at, o.is_featured
       FROM offers o
      WHERE o.id = $1
        AND o.is_active = TRUE
        AND NOW() BETWEEN o.starts_at AND o.ends_at`,
    [id],
  );
  if (res.rows.length === 0) return null;
  return res.rows[0] as OfferDetailRow;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const offer = await loadOffer(id);
  if (!offer) {
    return buildPageMetadata({
      title: "العرض غير متوفر",
      path: `/offers/${id}`,
      noIndex: true,
    });
  }
  const desc =
    offer.description_ar ||
    `عرض حصري من أسواق سيتي — خصم ${offer.discount_type === "percentage" ? `${offer.discount_value}٪` : `${offer.discount_value} ر.س`} على ${offer.title_ar}`;
  return buildPageMetadata({
    title: `${offer.title_ar} | العروض | أسواق سيتي`,
    description: desc,
    path: `/offers/${offer.id}`,
    image: offer.image_url,
  });
}

export default async function OfferDetailPage({ params }: PageProps) {
  const { id } = await params;
  const offer = await loadOffer(id);
  if (!offer) notFound();

  // Use the existing public products endpoint, filtered by this offer.
  // We invoke the DB directly to avoid a same-server HTTP hop and to
  // match the canonical projection from products_unified_with_offers.
  const productsRes = await query(
    `SELECT p.id, p.name_ar, p.price::float AS price,
            p.discount_price::float AS discount_price,
            p.image_url, p.stock_qty,
            p.active_offer_id, p.active_offer_title_ar, p.active_offer_type,
            p.active_offer_value::float AS active_offer_value,
            p.active_offer_max_discount::float AS active_offer_max_discount,
            p.active_offer_min_order::float AS active_offer_min_order,
            p.active_offer_starts_at, p.active_offer_ends_at,
            v.name_ar AS vendor_name, v.slug AS vendor_slug
       FROM products_unified_with_offers p
       LEFT JOIN vendors v ON v.id = p.vendor_id
      WHERE p.active_offer_id = $1
        AND p.is_active = TRUE
      ORDER BY p.name_ar ASC
      LIMIT 60`,
    [offer.id],
  );

  const products = productsRes.rows.map((r: any) => {
    const listPrice = Number(r.price) || 0;
    const legacy = r.discount_price == null ? null : Number(r.discount_price);
    let offerEffective = listPrice;
    if (r.active_offer_id) {
      const value = Number(r.active_offer_value) || 0;
      const maxDisc = r.active_offer_max_discount == null ? null : Number(r.active_offer_max_discount);
      let savings: number;
      if (r.active_offer_type === "percentage") {
        savings = (listPrice * value) / 100;
        if (maxDisc != null) savings = Math.min(savings, maxDisc);
      } else {
        savings = Math.min(value, listPrice);
      }
      savings = Math.min(Math.max(savings, 0), listPrice);
      offerEffective = Math.round((listPrice - savings) * 100) / 100;
    }
    let unitPrice = listPrice;
    if (offerEffective < listPrice) unitPrice = offerEffective;
    if (legacy != null && legacy < listPrice && legacy < unitPrice) unitPrice = legacy;
    const effectivePrice = unitPrice < listPrice ? unitPrice : null;
    return {
      id: r.id,
      name_ar: r.name_ar,
      price: listPrice,
      discount_price: legacy,
      image_url: r.image_url,
      stock_qty: r.stock_qty,
      category_id: r.category_id ?? null,
      vendor_id: r.vendor_id ?? null,
      vendor_name: r.vendor_name ?? null,
      vendor_slug: r.vendor_slug ?? null,
      active_offer: r.active_offer_id
        ? {
            offer_id: r.active_offer_id,
            title_ar: r.active_offer_title_ar ?? "",
            discount_type: r.active_offer_type,
            discount_value: Number(r.active_offer_value) || 0,
            max_discount:
              r.active_offer_max_discount == null
                ? null
                : Number(r.active_offer_max_discount),
            min_order:
              r.active_offer_min_order == null
                ? null
                : Number(r.active_offer_min_order),
            starts_at: r.active_offer_starts_at ?? "",
            ends_at: r.active_offer_ends_at ?? "",
          }
        : null,
      effective_price: effectivePrice,
    };
  });

  const offerForClient = {
    id: offer.id,
    title_ar: offer.title_ar,
    title_en: offer.title_en,
    description_ar: offer.description_ar,
    description_en: offer.description_en,
    image_url: offer.image_url,
    discount_type: offer.discount_type,
    discount_value: toNumberOrZero(offer.discount_value),
    max_discount: toNumberOrNull(offer.max_discount),
    min_order: toNumberOrNull(offer.min_order),
    starts_at: offer.starts_at,
    ends_at: offer.ends_at,
    is_featured: offer.is_featured,
  };

  return (
    <>
      <OfferJsonLd
        offer={{
          id: offer.id,
          title_ar: offer.title_ar,
          description_ar: offer.description_ar,
          image_url: offer.image_url,
          starts_at: offer.starts_at,
          ends_at: offer.ends_at,
          discount_type: offer.discount_type,
          discount_value: toNumberOrZero(offer.discount_value),
        }}
      />
      <OfferDetail offer={offerForClient} products={products} />
    </>
  );
}
