import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api-auth";
import { getMoyasarPublishableKey, getMoyasarSecretKey, getSiteUrl } from "@/lib/env";
import { isMoyasarConfigured } from "@/lib/payments/moyasar";

export async function GET(request: Request) {
  const gate = await requireAdminApi(request as import("next/server").NextRequest, "manage_roles");
  if (gate instanceof NextResponse) return gate;

  const siteUrl = getSiteUrl();

  return NextResponse.json({
    success: true,
    config: {
      site_url: siteUrl,
      moyasar: {
        configured: isMoyasarConfigured(),
        publishable_key_set: getMoyasarPublishableKey() !== null,
        secret_key_set: getMoyasarSecretKey() !== null,
        callback_url: `${siteUrl}/api/v1/payments/moyasar/callback`,
        webhook_note:
          "أضف نفس رابط callback في لوحة ميسر مع رمز التحقق 96600 إن طُلب",
      },
      apple_pay: {
        domain: "citymarkets.sa",
        association_file: `${siteUrl}/.well-known/apple-developer-merchantid-domain-association`,
      },
      supported_methods: [
        "mada",
        "visa",
        "mastercard",
        "amex",
        "apple_pay",
        "wallet",
        "bank_transfer",
      ],
    },
  });
}
