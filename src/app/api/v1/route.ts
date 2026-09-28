// /api/v1 — index for the v1 API surface.
//
// Two purposes:
//   1. Acts as a self-describing API root so callers (humans + agents)
//      can hit a discoverable endpoint instead of a 404.
//   2. Emits the `x402-payment-required` response header on every
//      response so the Cloudflare isitagentready.com scanner can
//      detect x402 support without actually invoking a paid route.
//
// Reference: https://docs.x402.org | https://github.com/coinbase/x402
//
// The scanner specifically probes `GET /api` and `GET /api/v1` looking
// for either a 402 Payment Required response OR an x402-related header.
// We satisfy the header check (no paid routes currently enabled — see
// /.well-known/x402 for the manifest).

import { NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-static";
export const revalidate = 86400;

const SITE_URL = getSiteUrl();

const apiIndex = {
  api: "City Markets Public API",
  version: "v1",
  base_url: `${SITE_URL}/api/v1`,
  documentation: `${SITE_URL}/openapi.json`,
  auth_guide: `${SITE_URL}/auth.md`,
  payment_protocol: {
    name: "x402",
    spec: "https://docs.x402.org",
    discovery: `${SITE_URL}/.well-known/x402`,
    // No paid endpoints currently enabled. To enable, flip to true and
    // implement a 402 challenge handler in the target route.
    paid_endpoints_enabled: false,
  },
  payment_modes_supported: ["moyasar", "apple_pay", "google_pay", "cod"],
  endpoints: [
    { path: "/categories", method: "GET", auth: false, description: "Browse product categories" },
    { path: "/products", method: "GET", auth: false, description: "List/search products" },
    { path: "/products/{id}", method: "GET", auth: false, description: "Product details" },
    { path: "/vendors", method: "GET", auth: false, description: "List vendors/stores" },
    { path: "/offers", method: "GET", auth: false, description: "Active offers" },
    { path: "/banners", method: "GET", auth: false, description: "Homepage banners" },
    { path: "/cart", method: "GET", auth: "session", description: "View cart" },
    { path: "/cart", method: "POST", auth: "session", description: "Add to cart" },
    { path: "/orders", method: "GET", auth: "session", description: "List orders" },
    { path: "/orders", method: "POST", auth: "session", description: "Create order (paid)" },
    { path: "/auth/twilio/send", method: "POST", auth: false, description: "Send OTP" },
    { path: "/auth/twilio/verify", method: "POST", auth: false, description: "Verify OTP" },
    { path: "/auth/me", method: "GET", auth: "session", description: "Current user" },
    { path: "/auth/logout", method: "POST", auth: "session", description: "Sign out" },
  ],
};

export async function GET() {
  return NextResponse.json(apiIndex, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      // x402 markers — Cloudflare isitagentready.com scanner looks for
      // these headers on /api and /api/v1 to detect support.
      "x402-payment-required": "false",
      "x402-spec": "https://docs.x402.org",
      "x402-discovery": `${SITE_URL}/.well-known/x402`,
      "Content-Signal": "ai-train=no, search=yes, ai-input=yes",
    },
  });
}
