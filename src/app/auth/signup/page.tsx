import { LoginPage } from "@/components/auth/login-page";
import { buildPageMetadata } from "@/lib/seo/site";
import type { Metadata } from "next";

export const metadata: Metadata = buildPageMetadata({
  title: "إنشاء حساب",
  description:
    "أنشئ حسابك في أسواق سيتي برقم جوالك فقط — لا تحتاج لكلمة مرور. توصيل سريع إلى الرياض.",
  path: "/auth/signup",
});

export const dynamic = "force-dynamic";

/**
 * Signup is the same OTP flow as login — we auto-create the user on the
 * first successful OTP verification. Routing /auth/signup → LoginPage
 * keeps the URL discoverable from marketing pages without duplicating UI.
 */
export default function AuthSignupPage() {
  return <LoginPage />;
}
