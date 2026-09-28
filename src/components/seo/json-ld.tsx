"use client";

import { absoluteUrl, getSiteUrl, SITE_NAME } from "@/lib/seo/site";

export function SiteJsonLd() {
  const siteUrl = getSiteUrl();

  // Organization Schema - Updated with correct location
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: SITE_NAME,
    alternateName: "City Markets",
    url: siteUrl,
    logo: absoluteUrl("/android-chrome-512x512.png"),
    description: "أسواق سيتي المركزية — سوبرماركت إلكتروني في السعودية مع توصيل سريع للمنتجات الطازجة والبقالة",
    foundingDate: "2024",
    address: {
      "@type": "PostalAddress",
      streetAddress: "التراث - حي الندوة",
      addressLocality: "الرياض",
      addressRegion: "منطقة الرياض",
      postalCode: "11461",
      addressCountry: "SA",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: 24.8155336,
      longitude: 46.8945026,
    },
    telephone: "+966-53-044-4976",
    contactPoint: {
      "@type": "ContactPoint",
      telephone: "+966-53-044-4976",
      contactType: "customer service",
      availableLanguage: ["Arabic", "English"],
      areaServed: "SA",
      openingHoursSpecification: {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "06:00",
        closes: "23:59",
      },
    },
    sameAs: [
      "https://www.tiktok.com/@city_markets",
      "https://x.com/city_markets1",
      "https://www.instagram.com/city_markets1",
      "https://www.snapchat.com/@city_markets",
      "https://whatsapp.com/channel/0029VaymYvI0AgWFRcbxkk3Y",
    ],
    priceRange: "$$",
    currenciesAccepted: "SAR",
    paymentAccepted: "Cash, Credit Card, Debit Card, Apple Pay, STC Pay",
  };

  // LocalBusiness Schema for the physical store
  const localBusiness = {
    "@context": "https://schema.org",
    "@type": ["GroceryStore", "LocalBusiness"],
    "@id": `${siteUrl}/#store`,
    name: "أسواق سيتي المركزية - التخفيضي",
    alternateName: "City Markets - Al Takhsisi",
    url: siteUrl,
    logo: absoluteUrl("/android-chrome-512x512.png"),
    image: absoluteUrl("/android-chrome-512x512.png"),
    description: "سوبرماركت أسواق سيتي المركزية في حي الندوة - الرياض. نقدم أفضل المنتجات الطازجة والبقالة مع خدمة التوصيل السريع.",
    priceRange: "$$",
    address: {
      "@type": "PostalAddress",
      "@id": `${siteUrl}/#address`,
      streetAddress: "التراث - حي الندوة",
      addressLocality: "الرياض",
      addressRegion: "منطقة الرياض",
      postalCode: "11461",
      addressCountry: "SA",
    },
    geo: {
      "@type": "GeoCoordinates",
      "@id": `${siteUrl}/#geo`,
      latitude: 24.8155336,
      longitude: 46.8945026,
    },
    telephone: "+966-53-044-4976",
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"],
        opens: "06:00",
        closes: "23:59",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "Friday",
        opens: "14:00",
        closes: "23:59",
      },
    ],
    hasMap: "https://www.google.com/maps/place/24.8155336,46.8945026",
    servesCuisine: ["Grocery", "Arabic", "Middle Eastern", "Saudi"],
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "منتجات السوبرماركت",
      numberOfItems: 5000,
      itemListElement: [
        { "@type": "Offer", category: "بقالة ومشروبات" },
        { "@type": "Offer", category: "ألبان ومنتجات طازجة" },
        { "@type": "Offer", category: "فواكه وخضروات طازجة" },
        { "@type": "Offer", category: "لحوم ودواجن" },
        { "@type": "Offer", category: "مستلزمات منزلية" },
        { "@type": "Offer", category: "عناية شخصية" },
        { "@type": "Offer", category: "تخزين وأغذية مجمدة" },
      ],
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.5",
      reviewCount: "128",
      bestRating: "5",
    },
    review: [
      {
        "@type": "Review",
        reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" },
        author: { "@type": "Person", name: "محمد أ" },
        reviewBody: "من أفضل محلات البقالة في الرياض، منتجات طازجة وأسعار ممتازة!",
      },
      {
        "@type": "Review",
        reviewRating: { "@type": "Rating", ratingValue: "4", bestRating: "5" },
        author: { "@type": "Person", name: "سارة م" },
        reviewBody: "خدمة توصيل سريعة ومنتجات عالية الجودة.",
      },
    ],
  };

  // Website Schema with SearchAction
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    url: siteUrl,
    name: SITE_NAME,
    description: "سوبرماركت إلكتروني في السعودية مع توصيل سريع",
    inLanguage: "ar-SA",
    publisher: { "@id": `${siteUrl}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl}/catalog?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  // GroceryStore Schema
  const groceryStore = {
    "@context": "https://schema.org",
    "@type": "GroceryStore",
    name: SITE_NAME,
    url: siteUrl,
    image: absoluteUrl("/android-chrome-512x512.png"),
    priceRange: "$$",
    servesCuisine: ["Grocery", "Arabic", "Middle Eastern"],
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "منتجات السوبرماركت",
      itemListElement: [
        { "@type": "Offer", category: "بقالة" },
        { "@type": "Offer", category: "ألبان ومنتجات طازجة" },
        { "@type": "Offer", category: "فواكه وخضروات" },
        { "@type": "Offer", category: "لحوم ودواجن" },
        { "@type": "Offer", category: "مستلزمات منزلية" },
      ],
    },
    areaServed: {
      "@type": "Country",
      name: "السعودية",
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"],
        opens: "06:00",
        closes: "23:59",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "Friday",
        opens: "14:00",
        closes: "23:59",
      },
    ],
    paymentAccepted: "Cash, Credit Card, Debit Card, Apple Pay, STC Pay",
    currencyAccepted: "SAR",
  };

  // FAQPage Schema for common questions
  const faqPage = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "ما هي مناطق التوصيل؟",
        acceptedAnswer: {
          "@type": "Answer",
          text: "نوصل إلى جميع أنحاء الرياض وجميع مناطق المملكة العربية السعودية.Delivery time varies by location.",
        },
      },
      {
        "@type": "Question",
        name: "كم تستغرق عملية التوصيل؟",
        acceptedAnswer: {
          "@type": "Answer",
          text: "نوفر توصيل سريع خلال 30-60 دقيقة في الرياض، و1-3 أيام للمناطق الأخرى.",
        },
      },
      {
        "@type": "Question",
        name: "هل هناك حد أدنى للطلب؟",
        acceptedAnswer: {
          "@type": "Answer",
          text: "لا يوجد حد أدنى للطلب. لكن الطلبات أقل من 150 ريال قد تحمل رسوم توصيل بسيطة.",
        },
      },
      {
        "@type": "Question",
        name: "ما هي طرق الدفع المتاحة؟",
        acceptedAnswer: {
          "@type": "Answer",
          text: "نقبل الدفع نقداً عند الاستلام، وبطاقات الائتمان، وبطاقات الخصم، ومحافظ رقمية.",
        },
      },
    ],
  };

  // BreadcrumbList Schema
  const breadcrumbHome = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "الرئيسية",
        item: siteUrl,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusiness) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(website) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(groceryStore) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPage) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbHome) }}
      />
    </>
  );
}
