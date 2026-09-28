import { ProfileReviews } from "@/components/pages/profile/profile-reviews";
import { buildPageMetadata } from "@/lib/seo/site";
import type { Metadata } from "next";

export const metadata: Metadata = buildPageMetadata({
  title: "مراجعاتي",
  path: "/profile/reviews",
});

export default function ProfileReviewsPage() {
  return <ProfileReviews />;
}
