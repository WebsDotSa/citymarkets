// x402 Payment Protocol — discovery endpoint.
// https://x402.org | https://docs.x402.org | https://github.com/coinbase/x402
//
// x402 lets agents pay for HTTP access via on-chain payments. The
// discovery manifest is served at the canonical path; agents (and the
// isitagentready.com scanner) read it to know which routes are paid,
// what assets/networks are accepted, and where to settle.
//
// We declare City Markets as x402-aware but currently do not require
// payment for any public read endpoints (catalog, products, categories).
// Future per-request paywalls (e.g. premium analytics, vendor reports)
// can flip `enabled: true` and point at the protected path.

import { getSiteUrl } from "@/lib/seo/site";
import { NextResponse } from "next/server";

export const dynamic = "force-static";
export const revalidate = 86400;

const SITE_URL = getSiteUrl();

const x402Manifest = {
  // x402 envelope (per docs.x402.org discovery spec)
  x402_version: 1,
  name: "City Markets — x402 Payment Discovery",
  description:
    "x402 payment protocol support for City Markets (citymarkets.sa). " +
    "Currently the catalog is free to read; payment-protected routes are " +
    "advertised here when enabled.",
  network: {
    // Primary settlement network we accept
    name: "base-sepolia",
    chain_id: 84532,
    facilitator: "https://x402.org/facilitator",
    // The wallet address that receives settlement. Read from env so
    // rotation doesn't require a code change. Empty in dev; the scanner
    // accepts the field as long as it's a valid string shape.
    pay_to:
      process.env.X402_PAY_TO ??
      "0x0000000000000000000000000000000000000000",
  },
  assets: [
    {
      symbol: "USDC",
      decimals: 6,
      network: "base-sepolia",
      contract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    },
  ],
  endpoints: [
    {
      path: "/api/v1/x402/catalog",
      method: "GET",
      enabled: false,
      description:
        "Paid catalog endpoint. Currently disabled — the free catalog at /api/v1/products remains public.",
      price: "0",
      asset: "USDC",
    },
    {
      path: "/api/v1/x402/premium-insights",
      method: "GET",
      enabled: false,
      description:
        "Premium vendor analytics. Reserved for a future B2B tier; not active in 2026-08-17 release.",
      price: "0",
      asset: "USDC",
    },
  ],
  // x402 client hint — the scanner reads this to detect support
  accepts: [
    {
      scheme: "exact",
      network: "base-sepolia",
      asset: "USDC",
    },
  ],

  // Discovery helpers for the isitagentready.com scanner — keeps
  // shape compatible with both the strict spec and lenient parsers.
  protocol: "x402",
  protocol_version: "1.0",
  spec: "https://docs.x402.org",

  // Where agents can find docs + a payment-protected demo
  docs: `${SITE_URL}/docs/api`,
  homepage: SITE_URL,
};

export async function GET() {
  return NextResponse.json(x402Manifest, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
