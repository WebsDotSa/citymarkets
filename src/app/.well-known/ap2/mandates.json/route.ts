// AP2 (Agent Payments Protocol) — Mandate discovery endpoint.
// Spec: https://www.agenticcommerce.dev (AP2 layer)
// Path: /.well-known/ap2/mandates.json
//
// AP2 is the cryptographic trust layer above UCP/ACP. We declare what
// mandate types this merchant accepts from agent issuers. (Stripe and
// Google are the canonical issuers; we accept signed payment mandates
// via the same Moyasar PSP integration.)

import { getSiteUrl } from "@/lib/seo/site";
import { NextResponse } from "next/server";

export const dynamic = "force-static";
export const revalidate = 86400;

const SITE_URL = getSiteUrl();

const ap2Mandates = {
  protocol: "ap2",
  protocol_version: "2026-01",
  spec: "https://www.agenticcommerce.dev",

  organization: {
    name: "City Markets Co.",
    url: SITE_URL,
    contact_email: "ap2@citymarkets.sa",
    locale: "ar-SA",
    country: "SA",
    currency: "SAR",
  },

  // Mandate types this merchant accepts
  accepted_mandates: [
    {
      type: "cart_mandate",
      description:
        "Signed authorization for an agent to add items to a buyer's cart.",
      issuer_compatibility: ["stripe", "google", "visa", "mastercard"],
      max_value_sar: 5000,
      requires_user_confirmation: false,
    },
    {
      type: "payment_mandate",
      description:
        "Signed authorization to charge a stored payment instrument on file.",
      issuer_compatibility: ["stripe", "moyasar"],
      max_value_sar: 20000,
      requires_user_confirmation: true,
    },
    {
      type: "intent_mandate",
      description:
        "Long-lived signed intent for an agent to autonomously purchase " +
        "specified product types when they become available.",
      issuer_compatibility: ["stripe"],
      max_value_sar: 50000,
      requires_user_confirmation: true,
      ttl_days: 30,
    },
  ],

  // Cryptographic verification setup
  verification: {
    signing_algorithms: ["ES256", "EdDSA", "RS256"],
    public_key_jwks: `${SITE_URL}/.well-known/ap2/jwks.json`,
    revocation_endpoint: `${SITE_URL}/.well-known/ap2/revocations`,
  },

  // Audit trail
  audit: {
    endpoint: `${SITE_URL}/api/v1/ap2/audit`,
    retention_days: 365,
  },

  // Discovery
  discovery: {
    agent_card: `${SITE_URL}/.well-known/agent-card.json`,
    ucp: `${SITE_URL}/.well-known/ucp/manifest.json`,
    acp: `${SITE_URL}/.well-known/acp/config.json`,
    api_catalog: `${SITE_URL}/.well-known/api-catalog`,
    auth_guide: `${SITE_URL}/auth.md`,
  },
};

export async function GET() {
  return NextResponse.json(ap2Mandates, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      Link: [
        `<${SITE_URL}/.well-known/agent-card.json>; rel="alternate"`,
        `<${SITE_URL}/.well-known/ucp/manifest.json>; rel="alternate"`,
        `<${SITE_URL}/.well-known/acp/config.json>; rel="alternate"`,
      ].join(", "),
    },
  });
}
