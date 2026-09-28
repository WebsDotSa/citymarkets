import { ProfileNew } from "@/components/pages/profile/profile-new";
import { buildPageMetadata } from "@/lib/seo/site";
import type { Metadata } from "next";

// Profile is always per-user — must never be statically prerendered.
export const dynamic = "force-dynamic";

export const metadata: Metadata = buildPageMetadata({
  title: "حسابي",
  path: "/profile",
});

export default function ProfilePageRoute() {
  return <ProfileNew />;
}
