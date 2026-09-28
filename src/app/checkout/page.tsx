import type { Metadata } from "next";
import { CheckoutNew } from "@/components/pages/checkout/checkout-new";
import { buildPageMetadata } from "@/lib/seo/site";

// Checkout is per-session — never statically prerender (would leak one
// user's cart/address/payment intent into the next visitor's HTML).
export const dynamic = "force-dynamic";

export const metadata: Metadata = buildPageMetadata({
  title: "إتمام الطلب",
  path: "/checkout",
  noIndex: true,
});

export default function CheckoutPage() {
  return <CheckoutNew />;
}
