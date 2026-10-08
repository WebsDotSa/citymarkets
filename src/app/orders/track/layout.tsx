import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "تتبع طلبك | أسواق سيتي",
  description:
    "أدخل رقم جوالك ورمز التتبع لمعرفة حالة طلبك في أسواق سيتي بدون تسجيل دخول.",
  robots: { index: true, follow: true },
};

export default function TrackOrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}