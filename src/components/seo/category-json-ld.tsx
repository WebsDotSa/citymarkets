import { absoluteUrl } from "@/lib/seo/site";

interface CategoryJsonLdProps {
  name: string;
  slug: string;
  description?: string;
  image?: string;
  /**
   * Override the canonical URL emitted into JSON-LD. Defaults to
   * `/categories/{slug}` so JSON-LD points at the semantic URL even when
   * the page is also reachable via `/catalog?category=`.
   */
  canonicalPath?: string;
  /**
   * Custom breadcrumb chain. If omitted, the component emits a default
   * الرئيسية → الأقسام → name chain.
   */
  breadcrumb?: Array<{ name: string; href: string }>;
}

export function CategoryJsonLd({
  name,
  slug,
  description,
  image,
  canonicalPath,
  breadcrumb,
}: CategoryJsonLdProps) {
  const siteUrl = absoluteUrl("/");
  const canonical =
    canonicalPath ?? `/categories/${encodeURIComponent(slug)}`;
  const canonicalAbs = absoluteUrl(canonical);

  const categorySchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": canonicalAbs,
    name: `تسوق ${name}`,
    description:
      description ??
      `تصفح منتجات ${name} في أسواق سيتي — توصيل سريع وعروض يومية.`,
    url: canonicalAbs,
    ...(image && { image: absoluteUrl(image) }),
    publisher: {
      "@type": "Organization",
      name: "أسواق سيتي المركزية",
      url: siteUrl,
    },
  };

  const chain =
    breadcrumb && breadcrumb.length > 0
      ? breadcrumb
      : [
          { name: "الرئيسية", href: "/" },
          { name: "الأقسام", href: "/categories" },
          { name, href: canonical },
        ];

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: chain.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.href),
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(categorySchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
    </>
  );
}
