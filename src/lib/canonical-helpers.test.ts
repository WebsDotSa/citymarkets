/**
 * Regression coverage for helpers introduced by the 2026-09-30 duplication
 * remediation. Each replaced several byte-identical local copies; these tests
 * pin the behaviour the copies had.
 */
import { describe, expect, it } from "vitest";
import { UUID_RE, isUuid } from "./uuid";
import { requireIdParam } from "./request-params";
import { hhmmToMinutes, toRiyadhHhmm, validHhmmOr, RIYADH_OFFSET_MIN } from "./delivery/riyadh-time";
import { getSiteUrl as envSiteUrl } from "./env";
import { getSiteUrl as seoSiteUrl } from "./seo/site";
import { MAX_WISHLIST_SIZE as serviceMax } from "./identity/wishlist-service";
import { MAX_WISHLIST_SIZE as sharedMax } from "./identity/wishlist-constants";

describe("uuid", () => {
  it("accepts any-case UUIDs and rejects others", () => {
    expect(isUuid("3F2504E0-4F89-11D3-9A0C-0305E82C3301")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(UUID_RE.flags).toContain("i");
  });
});

describe("requireIdParam", () => {
  it("returns the id or a 400 with the legacy body", async () => {
    expect(requireIdParam(new URL("http://x/a?id=abc"))).toBe("abc");
    const res = requireIdParam(new URL("http://x/a"));
    expect(typeof res).not.toBe("string");
    const r = res as Response;
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ success: false, error: "المعرّف مطلوب" });
  });
});

describe("riyadh-time", () => {
  it("is fixed UTC+3", () => {
    expect(RIYADH_OFFSET_MIN).toBe(180);
    expect(toRiyadhHhmm(new Date("2026-01-01T21:30:00Z"))).toBe("00:30");
    expect(hhmmToMinutes("13:45")).toBe(825);
  });
  it("validHhmmOr falls back on malformed input", () => {
    expect(validHhmmOr("08:00", "09:00")).toBe("08:00");
    expect(validHhmmOr("24:00", "09:00")).toBe("09:00");
    expect(validHhmmOr(undefined, "09:00")).toBe("09:00");
  });
});

describe("single definitions", () => {
  it("env and seo expose the same getSiteUrl", () => {
    expect(envSiteUrl).toBe(seoSiteUrl);
  });
  it("wishlist cap is shared between server and client", () => {
    expect(serviceMax).toBe(sharedMax);
  });
});
