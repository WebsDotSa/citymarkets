/**
 * `/api/v1/mobile-config` — runtime configuration for native mobile clients.
 *
 * A native shell (iOS / Android) calls this endpoint once at launch and
 * again on the foreground to know:
 *   - which API version is live
 *   - which payment provider to integrate
 *   - which features are enabled (Twilio, Apple Pay, etc.)
 *   - which locale bundles / supported regions are bundled
 *   - VAPID public key for direct Web-Push registration (legacy path)
 *   - minimum-supported app version (for force-update UX)
 *
 * Sensitive secrets (Moyasar private keys, Twilio auth tokens,
 * DB credentials) are NEVER shipped here. The native client uses the
 * public publishable keys only.
 *
 * Cache directives: 60 s public + 5 min SWR — the config changes rarely
 * but a stale mojibake or missing provider for 5 min is fine.
 */
import { NextRequest } from "next/server";
import { ok } from "@/lib/api-response";
import { withCors } from "@/lib/cors";
import {
  getIOSBundleId,
  getMoyasarPublishableKey,
  getOpenAIApiKey,
  getPaymentProvider,
  getSiteUrl,
  getVapidPublicKey,
  isApnsConfigured,
  isFcmConfigured,
} from "@/lib/env";
import { isTwilioMessagingConfigured } from "@/lib/twilio-messaging";
import { isTwilioVerifyConfigured } from "@/lib/twilio-verify";

export const dynamic = "force-dynamic";

const API_VERSION = "1.0.0";
const MIN_APP_VERSION = "1.0.0"; // bump when native APIs change shape

const handler = async (_request: NextRequest) => {
  const config = {
    apiVersion: API_VERSION,
    minAppVersion: MIN_APP_VERSION,
    site: {
      name: "City Markets",
      nameAr: "أسواق سيتي المركزية",
      url: getSiteUrl(),
      locale: "ar",
      direction: "rtl",
      currency: "SAR",
      timezone: "Asia/Riyadh",
    },
    auth: {
      twilioOtp: isTwilioVerifyConfigured(),
      twilioMessaging: isTwilioMessagingConfigured(),
      // Native clients must send `Authorization: Bearer <jwt>` on mutating
      // requests. Web clients keep using the `customer_session` cookie.
      bearerScheme: true,
      cookieScheme: true,
    },
    payments: {
      provider: getPaymentProvider(),
      // Public publishable key only — never the secret.
      publishableKey: getMoyasarPublishableKey(),
      // Apple Pay domain verification file path. Native shells fetch
      // this through the universal-link redirect.
      applePayDomain: "citymarkets.sa",
      // webview-based fallback if SDK is not configured
      webviewFallback: true,
    },
    push: {
      // VAPID public key for direct Web-Push subscription (legacy).
      // APNs/FCM tokens use the dedicated /api/v1/push/apns-register
      // endpoint instead.
      vapidPublicKey: getVapidPublicKey(),
      apnsEnabled: isApnsConfigured(),
      fcmEnabled: isFcmConfigured(),
      bundleId: getIOSBundleId(),
    },
    features: {
      loyalty: true,
      spinWheel: true,
      multiVendor: true,
      guestCheckout: true,
      applePay: true,
      coupons: true,
      blog: true,
      aiAssistant: getOpenAIApiKey() !== null,
      voiceOrder: true,
      deliveryTracking: true,
    },
    // Stable list of supported BCP-47 locales. Native shells pick the
    // best match in order of preference.
    locales: [
      { code: "ar", dir: "rtl", name: "العربية", nameEn: "Arabic" },
      { code: "en", dir: "ltr", name: "English", nameEn: "English" },
    ],
    // Pagination defaults so the client can render without per-route config.
    pagination: {
      defaultLimit: 20,
      maxLimit: 100,
    },
    contact: {
      email: "support@citymarkets.sa",
      phone: "+966500000000",
    },
  };

  return ok(config, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
};

export const GET = withCors(handler);
