/**
 * Tests for src/lib/cors.ts — the CORS allowlist helper.
 */
import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  isCorsAllowedOrigin,
  applyCorsHeaders,
  handlePreflight,
  withCors,
} from "@/lib/cors";

function makeRequest(method: string, origin: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (origin) headers["origin"] = origin;
  return new NextRequest("https://citymarkets.sa/api/v1/products", {
    method,
    headers,
  });
}

describe("cors — isCorsAllowedOrigin", () => {
  it("accepts the canonical production origin", () => {
    expect(isCorsAllowedOrigin("https://citymarkets.sa")).toBe(true);
    expect(isCorsAllowedOrigin("https://www.citymarkets.sa")).toBe(true);
  });

  it("accepts the native custom scheme", () => {
    expect(isCorsAllowedOrigin("citymarkets://")).toBe(true);
  });

  it("accepts the Capacitor plain localhost origin", () => {
    expect(isCorsAllowedOrigin("capacitor://localhost")).toBe(true);
  });

  it("rejects unknown origins", () => {
    expect(isCorsAllowedOrigin("https://evil.example.com")).toBe(false);
    expect(isCorsAllowedOrigin("null")).toBe(false);
    expect(isCorsAllowedOrigin(null)).toBe(false);
  });

  it("rejects absurdly long origins", () => {
    expect(isCorsAllowedOrigin("https://citymarkets.sa/" + "a".repeat(2100))).toBe(false);
  });
});

describe("cors — applyCorsHeaders", () => {
  it("emits Access-Control-Allow-Origin when origin is allowed", () => {
    const req = makeRequest("GET", "https://citymarkets.sa");
    const res = NextResponse.json({});
    const out = applyCorsHeaders(req, res);
    expect(out.headers.get("Access-Control-Allow-Origin")).toBe("https://citymarkets.sa");
    expect(out.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(out.headers.get("Vary")).toContain("Origin");
  });

  it("omits Access-Control-Allow-Origin when origin is not allowed", () => {
    const req = makeRequest("GET", "https://evil.example.com");
    const res = NextResponse.json({});
    const out = applyCorsHeaders(req, res);
    expect(out.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(out.headers.get("Vary")).toContain("Origin");
  });

  it("still appends Vary: Origin when no Origin header is sent", () => {
    const req = makeRequest("GET", null);
    const res = NextResponse.json({});
    const out = applyCorsHeaders(req, res);
    expect(out.headers.get("Vary")).toContain("Origin");
    expect(out.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("cors — handlePreflight", () => {
  it("returns 204 for an allowed OPTIONS preflight", () => {
    const req = makeRequest("OPTIONS", "https://citymarkets.sa");
    const res = handlePreflight(req);
    expect(res?.status).toBe(204);
    expect(res?.headers.get("Access-Control-Allow-Origin")).toBe("https://citymarkets.sa");
  });

  it("returns 403 for a disallowed OPTIONS preflight", () => {
    const req = makeRequest("OPTIONS", "https://evil.example.com");
    const res = handlePreflight(req);
    expect(res?.status).toBe(403);
  });

  it("returns null for non-OPTIONS", () => {
    const req = makeRequest("POST", "https://citymarkets.sa");
    const res = handlePreflight(req);
    expect(res).toBeNull();
  });
});

describe("cors — withCors wrapper", () => {
  it("short-circuits OPTIONS preflight before calling the handler", async () => {
    const seen = { hits: 0 };
    const wrapped = withCors(async (req) => {
      seen.hits += 1;
      return NextResponse.json({ ok: true });
    });
    const req = makeRequest("OPTIONS", "https://citymarkets.sa");
    const res = await wrapped(req);
    expect(res.status).toBe(204);
    expect(seen.hits).toBe(0);
  });

  it("applies CORS headers to handler responses", async () => {
    const wrapped = withCors(async () => NextResponse.json({ x: 1 }));
    const req = makeRequest("GET", "https://citymarkets.sa");
    const res = await wrapped(req);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://citymarkets.sa");
  });
});
