import type { ProductSeoRow } from '@/lib/catalog/seo/product';
import { absoluteUrl, SITE_NAME } from "@/lib/seo/site";

interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Default FAQ for the city-market store. Page-level FAQs can override.
 * Schema.org/FAQPage is accepted by Google for rich results when at least 3
 * Q&A pairs are present.
 */
const DEFAULT_FAQS: FaqItem[] = [
  {
    question: "كيف أطلب من أسواق سيتي؟",
    answer:
      "اختر المنتجات من الأقسام أو ابحث باسم المنتج، أضفها إلى السلة، ثم أكمل بيانات التوصيل واختر طريقة الدفع. نوصّل خلال 30-60 دقيقة في أغلب المدن.",
  },
  {
    question: "كم رسوم التوصيل؟",
    answer:
      "التوصيل مجاني للطلبات فوق 150 ر.س. تحته تكون الرسوم 15 ر.س داخل المدينة و25 ر.س للأطراف.",
  },
  {
    question: "ما هي مناطق التوصيل؟",
    answer:
      "نغطي حالياً الرياض، جدة، الدمام، الخبر، الظهران، مكة، المدينة المنورة. نتوسع باستمرار. تحقق من منطقة التوصيل في صفحة المنتج لمعرفة التغطية لمنطقتك.",
  },
  {
    question: "ما هي طرق الدفع المتاحة؟",
    answer:
      "نقبل: مدى، Apple Pay، فيزا/ماستركارد، الدفع عند الاستلام، الدفع عبر STC Pay. كل المدفوعات الإلكترونية آمنة عبر مزوّد معتمد (Moyasar/Tap).",
  },
  {
    question: "هل المنتجات طازجة؟",
    answer:
      "نعم. الخضار والفواكه واللحوم والدواجن والأسماك تُسلَّم من المورد يوميًا. نضمن جودة المنتج عند التسليم — إذا لم يعجبك المنتج، نرجعه بدون سؤال.",
  },
  {
    question: "ما هي سياسة الإرجاع؟",
    answer:
      "لديك 7 أيام من تاريخ الاستلام للإرجاع أو الاستبدال. المنتجات الفاسدة أو غير المطابقة تُستبدل فوراً بدون تكلفة. تواصل مع خدمة العملاء في التطبيق.",
  },
];

export function FaqJsonLd({ faqs = DEFAULT_FAQS, pageUrl }: { faqs?: FaqItem[]; pageUrl?: string }) {
  if (faqs.length < 3) return null;

  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": pageUrl ? absoluteUrl(pageUrl) + "#faq" : absoluteUrl("/") + "#faq",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer,
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function BreadcrumbJsonLd({
  items,
}: {
  items: { name: string; url: string }[];
}) {
  if (items.length === 0) return null;
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: absoluteUrl(it.url),
    })),
  };
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export type { FaqItem };
// Re-export for product page (no-op but keeps tree-shake happy)
export type _S = ProductSeoRow;
export const _SITE = SITE_NAME;
