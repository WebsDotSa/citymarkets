// DNS for AI Discovery (DNS-AID) Documentation
// https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/
// https://www.rfc-editor.org/rfc/rfc9460 (SVCB/HTTPS)

// NOTE: DNS-AID records must be configured at the DNS provider level, not in application code.
// This file documents the required DNS records that should be published for agent discovery.

// DNS-AID Records Configuration
// =============================
//
// To enable AI agent discovery via DNS, publish the following records:
//
// 1. Agent Index Record (Required)
//    - Record: _index._agents.citymarkets.sa
//    - Type: SVCB
//    - Priority: 1
//    - Target: ai-discovery.citymarkets.sa
//
// 2. A2A (Agent-to-Agent) Communication Record (Optional)
//    - Record: _a2a._agents.citymarkets.sa
//    - Type: SVCB
//    - Priority: 1
//    - Target: a2a.citymarkets.sa
//
// 3. API Discovery Record (Optional)
//    - Record: _api._agents.citymarkets.sa
//    - Type: HTTPS
//    - Priority: 1
//    - Target: api-discovery.citymarkets.sa
//
// Example BIND zone file entries:
// -------------------------------
//
// ; Agent Index - points to discovery endpoint
// _index._agents.citymarkets.sa.  3600  IN  SVCB  1 ai-discovery.citymarkets.sa.
// ai-discovery.citymarkets.sa.    3600  IN  A     123.45.67.89
// ai-discovery.citymarkets.sa.    3600  IN  AAAA  2001:db8::1
//
// ; A2A Protocol (Agent-to-Agent)
// _a2a._agents.citymarkets.sa.    3600  IN  SVCB  1 a2a.citymarkets.sa.
// _a2a._agents.citymarkets.sa.    3600  IN  SVCB  1 . no-default-alpn
//                                     ; empty target with no-default-alpn for MA=...
// a2a.citymarkets.sa.             3600  IN  A     123.45.67.89
//
// ; HTTPS record for API discovery
// _api._agents.citymarkets.sa.     3600  IN  HTTPS 1 api-discovery.citymarkets.sa.
// api-discovery.citymarkets.sa.   3600  IN  A     123.45.67.89
//
// SVCB/HTTPS Parameters:
// ---------------------
// alpn: h2, http/1.1 (for HTTPS)
// port: 443
// no-default-alpn: (for raw TLS without ALPN negotiation)
// ech: (for Encrypted Client Hello - recommended for privacy)
//
// DNSSEC:
// -------
// IMPORTANT: Sign your public discovery zone with DNSSEC so validating resolvers
// can return authenticated data. This ensures agents can trust the discovery records.
//
// Verification:
// -------------
// After configuring DNS, verify with:
//   dig +short _index._agents.citymarkets.sa SVCB
//   dnssec-dsfromkey citymarkets.sa
//
// Or use online tools like:
//   https://dnssec-analyzer.verisign.com/
//   https://dnslookup.org/

export const dynamic = "force-static";

export async function GET() {
  return new Response(
    JSON.stringify(
      {
        documentation: "DNS-AID (DNS for AI Discovery) records must be configured at the DNS provider level.",
        description:
          "This endpoint documents the required DNS records for AI agent discovery via DNS.",
        required_records: [
          {
            name: "_index._agents.citymarkets.sa",
            type: "SVCB",
            priority: 1,
            target: "ai-discovery.citymarkets.sa",
            description: "Agent index - main entry point for agent discovery",
            parameters: {
              alpn: ["h2", "http/1.1"],
              port: 443,
            },
          },
          {
            name: "_a2a._agents.citymarkets.sa",
            type: "SVCB",
            priority: 1,
            target: "a2a.citymarkets.sa",
            description: "Agent-to-agent communication endpoint",
            parameters: {
              alpn: ["lerust"],
              no_default_alpn: true,
            },
          },
          {
            name: "_api._agents.citymarkets.sa",
            type: "HTTPS",
            priority: 1,
            target: "api-discovery.citymarkets.sa",
            description: "API discovery endpoint for AI agents",
            parameters: {
              alpn: ["h2"],
              port: 443,
            },
          },
        ],
        references: [
          {
            title: "DNS for AI Discovery (DNS-AID) Draft",
            url: "https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/",
          },
          {
            title: "SVCB and HTTPS DNS Records (RFC 9460)",
            url: "https://www.rfc-editor.org/rfc/rfc9460",
          },
          {
            title: "DNSSEC",
            url: "https://dnssec.net/",
          },
        ],
        instructions:
          "Configure these DNS records at your DNS provider and sign with DNSSEC for secure agent discovery.",
      },
      null,
      2
    ),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    }
  );
}
