import type { Metadata } from "next";

const DEFAULT_SITE_URL = "https://citymarkets.sa";

export const SITE_NAME = "أسواق سيتي المركزية";
export const SITE_NAME_SHORT = "أسواق سيتي";
export const DEFAULT_DESCRIPTION =
  "اكتشف أحدث العروض وأكبر تشكيلة من المنتجات الطازجة والمواد الغذائية عبر أسواق سيتي — منصة تسوّق أونلاين تجمع لك آلاف المتاجر المحلية مع توصيل سريع إلى باب بيتك في جميع مدن المملكة.";

/**
 * THE canonical site URL: NEXT_PUBLIC_SITE_URL, else SITE_URL, else the
 * production domain, without a trailing slash. `@/lib/env` re-exports this.
 */
export function getSiteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    DEFAULT_SITE_URL;
  return raw.replace(/\/$/, "");
}

export function absoluteUrl(path: string): string {
  if (!path) return getSiteUrl();
  if (/^https?:\/\//i.test(path)) return path;
  return `${getSiteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export const DEFAULT_OG_IMAGE = "/og-image.png";

export function buildPageMetadata(input: {
  title: string;
  description?: string;
  path?: string;
  image?: string | null;
  noIndex?: boolean;
}): Metadata {
  const description = input.description ?? DEFAULT_DESCRIPTION;
  const canonical = input.path ? absoluteUrl(input.path) : getSiteUrl();
  const ogImage = absoluteUrl(input.image || DEFAULT_OG_IMAGE);

  return {
    title: input.title,
    description,
    alternates: {
      canonical,
      languages: {
        "ar-SA": canonical,
        "x-default": canonical,
      },
    },
    openGraph: {
      type: "website",
      locale: "ar_SA",
      url: canonical,
      siteName: SITE_NAME,
      title: input.title,
      description,
      images: [
        { url: ogImage, width: 1200, height: 630, alt: SITE_NAME },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description,
      images: [ogImage],
    },
    robots: input.noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}

export const rootSiteMetadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: `${SITE_NAME} | منصة التسوق الذكية المتعددة المتاجر في السعودية`,
    template: `%s | ${SITE_NAME_SHORT}`,
  },
  description: DEFAULT_DESCRIPTION,
  keywords: [
    "أسواق سيتي",
    "سوبرماركت أونلاين",
    "توصيل بقالة",
    "تسوق أونلاين",
    "بقالة السعودية",
    "عروض يومية",
    "منتجات طازجة",
    "توصيل سريع",
    "متاجر محلية",
    "دليفري السعودية",
    "خضار وفواكه",
    "مواد تموينية",
  ],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  formatDetection: { telephone: true, email: false },
  alternates: {
    canonical: "/",
    languages: {
      "ar-SA": getSiteUrl(),
      "x-default": getSiteUrl(),
    },
  },
  openGraph: {
    type: "website",
    locale: "ar_SA",
    url: getSiteUrl(),
    siteName: SITE_NAME,
    title: `${SITE_NAME} | منصة التسوق الذكية المتعددة المتاجر في السعودية`,
    description: DEFAULT_DESCRIPTION,
    images: [
      {
        url: absoluteUrl(DEFAULT_OG_IMAGE),
        width: 1200,
        height: 630,
        alt: SITE_NAME,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | منصة التسوق الذكية المتعددة المتاجر في السعودية`,
    description: DEFAULT_DESCRIPTION,
    images: [absoluteUrl(DEFAULT_OG_IMAGE)],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};
