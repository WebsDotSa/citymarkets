import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutPay } from "@/components/pages/checkout/checkout-pay";
import { buildPageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = buildPageMetadata({
  title: "إتمام الدفع",
  path: "/checkout/pay",
  noIndex: true,
});

// `CheckoutPay` uses `useSearchParams()` (a CSR hook). In Next.js 16 it
// must be wrapped in a <Suspense> boundary at the parent route, otherwise
// the page bails out of static prerender and is forced into CSR-only
// rendering. Mirrors the pattern in src/app/checkout/success/page.tsx.
export default function CheckoutPayPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutPay />
    </Suspense>
  );
}