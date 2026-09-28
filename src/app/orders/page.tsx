import { OrdersNew } from "@/components/pages/orders/orders-new";
import { buildPageMetadata } from "@/lib/seo/site";
import type { Metadata } from "next";

export const metadata: Metadata = buildPageMetadata({
  title: "طلباتي",
  path: "/orders",
});

export default function OrdersPageRoute() {
  return <OrdersNew />;
}
