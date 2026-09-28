import { ProfileEdit } from "@/components/pages/profile/profile-edit";
import { buildPageMetadata } from "@/lib/seo/site";
import type { Metadata } from "next";

export const metadata: Metadata = buildPageMetadata({
  title: "تعديل المعلومات",
  path: "/profile/edit",
});

export default function ProfileEditPage() {
  return <ProfileEdit />;
}