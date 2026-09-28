import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/site";

// "Saved lists" maps onto the wishlist feature. Rather than a Server
// Component redirect (intercepted by proxy.ts), canonicalize to
// /wishlist and noindex the duplicate.
export const metadata: Metadata = buildPageMetadata({
  title: "القوائم المحفوظة",
  path: "/wishlist",
  noIndex: true,
});

export default function ProfileListsAliasPage() {
  return null;
}
