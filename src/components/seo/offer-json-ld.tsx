// Schema.org Offer JSON-LD for /offers/[id]. Renders inside a Server
// Component so search engines pick up the structured data without
// needing client-side JS.

import { absoluteUrl } from "@/lib/seo/site";

export interface OfferJsonLdInput {
  id: string;
  title_ar: string;
  description_ar?: string | null;
  image_url: string;
  starts_at: string;
  ends_at: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
}

export function OfferJsonLd({ offer }: { offer: OfferJsonLdInput }) {
  const url = absoluteUrl(`/offers/${offer.id}`);
  const data = {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: offer.title_ar,
    description: offer.description_ar || undefined,
    image: offer.image_url,
    url,
    availabilityStarts: offer.starts_at,
    availabilityEnds: offer.ends_at,
    priceValidUntil: offer.ends_at,
    priceCurrency: "SAR",
    category: offer.discount_type === "percentage" ? "Percentage discount" : "Fixed-amount discount",
    eligibleQuantity: { "@type": "QuantitativeValue", value: 1 },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
