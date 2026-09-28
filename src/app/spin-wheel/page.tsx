import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/site";

// The real spin/wheel-of-fortune page is /spin. /spin-wheel was a
// placeholder kept around for old marketing links. Rather than a
// Server Component redirect (intercepted by proxy.ts), canonicalize
// to /spin and noindex the duplicate.
export const metadata: Metadata = buildPageMetadata({
  title: "عجلة الحظ",
  path: "/spin",
  noIndex: true,
});

export default function SpinWheelAliasPage() {
  return null;
}
