import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/site";

// Inventory is admin-only. The user-facing profile has no inventory
// surface yet. Rather than a Server Component redirect (intercepted by
// proxy.ts in this Next.js setup), emit a canonical to /profile and
// noindex the duplicate so any backlinks resolve cleanly.
export const metadata: Metadata = buildPageMetadata({
  title: "المخزون",
  path: "/profile",
  noIndex: true,
});

export default function ProfileInventoryAliasPage() {
  return null;
}
