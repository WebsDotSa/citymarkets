import { describe, it, expect } from "vitest";
import { getClientIp } from "./request-ip";

function mockRequest(headers: Record<string, string | null>): Request {
  return {
    headers: {
      get: (k: string) =>
        k.toLowerCase() in headers
          ? headers[k.toLowerCase()] ?? null
          : null,
    },
  } as unknown as Request;
}

describe("getClientIp", () => {
  it("returns the first hop of x-forwarded-for when present", () => {
    const req = mockRequest({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("trims whitespace around the first hop", () => {
    const req = mockRequest({ "x-forwarded-for": "  9.9.9.9  , 10.0.0.1" });
    expect(getClientIp(req)).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = mockRequest({ "x-real-ip": "5.6.7.8" });
    expect(getClientIp(req)).toBe("5.6.7.8");
  });

  it("falls back to x-real-ip when x-forwarded-for is an empty string", () => {
    const req = mockRequest({ "x-forwarded-for": "", "x-real-ip": "5.6.7.8" });
    expect(getClientIp(req)).toBe("5.6.7.8");
  });

  it("returns the literal 'unknown' when both headers are missing", () => {
    const req = mockRequest({});
    expect(getClientIp(req)).toBe("unknown");
  });

  it("prefers x-forwarded-for over x-real-ip when both are present", () => {
    const req = mockRequest({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" });
    expect(getClientIp(req)).toBe("1.1.1.1");
  });

  it("treats a single-hop x-forwarded-for the same as a chain", () => {
    const req = mockRequest({ "x-forwarded-for": "1.2.3.4" });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });
});
