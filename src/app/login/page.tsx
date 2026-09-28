import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/site";

// /login is a legacy alias for /auth/login. The user-facing redirect
// lives in src/proxy.ts (Server Component `redirect()` is unreliable
// under proxy.ts — NextResponse.next() freezes the status at 200).
// This page is the fallback for crawlers that bypass the proxy: a
// canonical link + noindex tells search engines the real URL while
// the proxy.ts redirect handles real visitors.
export const metadata: Metadata = buildPageMetadata({
  title: "تسجيل الدخول",
  path: "/auth/login",
  noIndex: true,
});

export const dynamic = "force-static";

export default function LegacyLoginAliasPage() {
  return null;
}
