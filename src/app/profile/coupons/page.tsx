import { ProfileCoupons } from "@/components/pages/profile/profile-coupons";
import { buildPageMetadata } from "@/lib/seo/site";
import type { Metadata } from "next";

export const metadata: Metadata = buildPageMetadata({
  title: "الرموز الترويجية",
  path: "/profile/coupons",
});

export default function ProfileCouponsPage() {
  return <ProfileCoupons />;
}
