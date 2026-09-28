import type { Metadata } from "next";
import { CartV2 } from "@/components/pages/cart/cart-v2";
import { buildPageMetadata } from "@/lib/seo/site";

// Cart is per-session — never statically prerender or we leak one user's
// cart to the next.
export const dynamic = "force-dynamic";

export const metadata: Metadata = buildPageMetadata({
  title: "سلة التسوق",
  path: "/cart",
  noIndex: true,
});

export default function CartPageRoute() {
  return <CartV2 />;
}
