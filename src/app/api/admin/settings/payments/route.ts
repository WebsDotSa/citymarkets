import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { getMoyasarPublishableKey, getMoyasarSecretKey, getSiteUrl } from "@/lib/env";
import { isMoyasarConfigured } from "@/lib/payments/moyasar";
import { ALL_PAYMENT_METHODS } from "@/lib/payments/payment-methods";

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
        callback_url: `${siteUrl}/api/v1/payments/webhook`,
        webhook_note:
          "أضف نفس رابط callback في لوحة ميسر مع رمز التحقق 96600 إن طُلب",
      },
      apple_pay: {
        domain: "citymarkets.sa",
        association_file: `${siteUrl}/.well-known/apple-developer-merchantid-domain-association`,
      },
      supported_methods: [...ALL_PAYMENT_METHODS],
    },
  });
}
