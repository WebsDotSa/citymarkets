import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/site";

// Wallet balances live under the loyalty program. Rather than a
// Server Component redirect (intercepted by proxy.ts), canonicalize
// to /loyalty and noindex the duplicate.
export const metadata: Metadata = buildPageMetadata({
  title: "المحفظة",
  path: "/loyalty",
  noIndex: true,
});

export default function ProfileWalletAliasPage() {
  return null;
}
