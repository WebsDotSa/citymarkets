import { absoluteUrl, SITE_NAME } from "@/lib/seo/site";
import type { ProductSeoRow } from '@/lib/catalog';
import { productDescription } from '@/lib/catalog';

interface ProductJsonLdProps {
  product: ProductSeoRow;
  reviews?: {
    averageRating: number;
    reviewCount: number;
  };
}

export function ProductJsonLd({ product, reviews }: ProductJsonLdProps) {
  const siteUrl = absoluteUrl("/");

  // Main Product Schema
  const price =
    product.discount_price != null && product.discount_price < product.price
      ? product.discount_price
      : product.price;

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": absoluteUrl(`/products/${product.id}`),
    name: product.name_ar,
    alternateName: product.name_en ?? undefined,
    description: productDescription(product),
    image: product.image_url ? [absoluteUrl(product.image_url)] : undefined,
    sku: product.id,
    gtin13: product.sku ?? undefined,
    brand: {
      "@type": "Brand",
      name: SITE_NAME,
    },
    category: product.category_name ?? "منتجات السوبرماركت",
    manufacturer: {
      "@type": "Organization",
      name: SITE_NAME,
    },
    ...(reviews && {
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: reviews.averageRating.toFixed(1),
        reviewCount: reviews.reviewCount,
        bestRating: "5",
        worstRating: "1",
      },
    }),
    offers: {
      "@type": "Offer",
      url: absoluteUrl(`/products/${product.id}`),
      priceCurrency: "SAR",
      price: price.toFixed(2),
      priceValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      availability: product.is_active
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: {
        "@type": "Organization",
        name: SITE_NAME,
      },
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: {
          "@type": "MonetaryAmount",
          value: "0",
          currency: "SAR",
        },
        deliveryTime: {
          "@type": "ShippingDeliveryTime",
          handlingTime: {
            "@type": "QuantitativeValue",
            minValue: "0",
            maxValue: "0",
            unitCode: "MIN",
          },
          transitTime: {
            "@type": "QuantitativeValue",
            minValue: "30",
            maxValue: "60",
            unitCode: "MIN",
          },
        },
        shipsTo: ["SA"],
      },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: "SA",
        returnPolicyCategory: "https://schema.org/MerchantReturnable",
        merchantReturnDays: 7,
        returnMethod: "https://schema.org/ReturnByMail",
        returnFees: "https://schema.org/FreeReturn",
      },
    },
  };

  // BreadcrumbList for Product
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "الرئيسية",
        item: siteUrl,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "الكتالوج",
        item: `${siteUrl}/catalog`,
      },
      ...(product.category_slug
        ? [
            {
              "@type": "ListItem" as const,
              position: 3,
              name: product.category_name ?? "المنتجات",
              item: `${siteUrl}/categories/${encodeURIComponent(product.category_slug)}`,
            },
          ]
        : []),
      {
        "@type": "ListItem",
        position: product.category_slug ? 4 : 3,
        name: product.name_ar,
        item: absoluteUrl(`/products/${product.id}`),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
    </>
  );
}
