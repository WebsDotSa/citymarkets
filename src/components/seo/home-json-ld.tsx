"use client";

import { absoluteUrl, getSiteUrl, SITE_NAME } from "@/lib/seo/site";

export function HomePageJsonLd() {
  const siteUrl = getSiteUrl();

  // HomePage Schema
  const homePageSchema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": siteUrl,
    url: siteUrl,
    name: "أسواق سيتي | منصة التسوق الذكية المتعددة المتاجر في السعودية",
    description:
      "اكتشف أحدث العروض وأكبر تشكيلة من المنتجات الطازجة والمواد الغذائية عبر أسواق سيتي — منصة تسوّق أونلاين تجمع لك آلاف المتاجر المحلية مع توصيل سريع إلى باب بيتك في جميع مدن المملكة.",
    isPartOf: {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: SITE_NAME,
      publisher: {
        "@type": "Organization",
        name: SITE_NAME,
        logo: {
          "@type": "ImageObject",
          url: absoluteUrl("/android-chrome-512x512.png"),
        },
      },
    },
    about: {
      "@type": "Thing",
      name: "سوبرماركت إلكتروني",
      description:
        "سوبرماركت إلكتروني يوفر خدمات توصيل المنتجات الطازجة والبقالة إلى المنازل في السعودية",
    },
    mainEntity: {
      "@type": "GroceryStore",
      name: SITE_NAME,
      url: siteUrl,
    },
  };

  // Service Schema
  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "توصيل السوبرماركت",
    description:
      "خدمة توصيل سريع للمنتجات الغذائية والبقالة إلى باب المنزل في الرياض والمناطق الأخرى",
    provider: {
      "@type": "Organization",
      name: SITE_NAME,
      url: siteUrl,
    },
    areaServed: {
      "@type": "Country",
      name: "السعودية",
    },
    serviceType: "توصيل بقالة",
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "فئات المنتجات",
      numberOfItems: 120,
    },
  };

  // VideoObject for promo (if available)
  const videoSchema = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: `${SITE_NAME} - تقديم الخدمات`,
    description:
      "فيديو توضيحي لخدمات أسواق سيتي للتوصيل السريع",
    thumbnailUrl: absoluteUrl("/android-chrome-512x512.png"),
    uploadDate: "2026-01-01",
    duration: "PT1M",
    embedUrl: `${siteUrl}/api/video/embed`,
  };

  // HowTo Schema
  const howToSchema = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "كيفية الطلب من أسواق سيتي",
    description: "خطوات بسيطة لطلب منتجاتك من أسواق سيتي",
    totalTime: "PT5M",
    step: [
      {
        "@type": "HowToStep",
        name: "اختر منتجاتك",
        text: "تصفح الكتالوج واختر المنتجات التي تريدها",
      },
      {
        "@type": "HowToStep",
        name: "أضف للسلة",
        text: "أضف المنتجات إلى سلة التسوق",
      },
      {
        "@type": "HowToStep",
        name: "أتمم الطلب",
        text: "أدخل عنوانك واختر طريقة الدفع",
      },
      {
        "@type": "HowToStep",
        name: "استلم طلبك",
        text: "نوصل طلبك خلال 30-60 دقيقة",
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homePageSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToSchema) }}
      />
    </>
  );
}
