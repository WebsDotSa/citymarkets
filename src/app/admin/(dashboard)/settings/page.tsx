import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/site";

// /admin/settings is a group index with no page of its own. Rather
// than a Server Component redirect (intercepted by proxy.ts even on
// admin routes), canonicalize to /admin/settings/profile and noindex
// the duplicate.
export const metadata: Metadata = buildPageMetadata({
  title: "إعدادات الإدارة",
  path: "/admin/settings/profile",
  noIndex: true,
});

export default function AdminSettingsAliasPage() {
  return null;
}
