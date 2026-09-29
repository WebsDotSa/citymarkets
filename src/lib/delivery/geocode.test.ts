import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reverseGeocode } from "./geocode";

describe("reverseGeocode", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns Nominatim's display_name on success", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ display_name: "Riyadh, Saudi Arabia" }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const out = await reverseGeocode(24.7136, 46.6753);
    expect(out).toBe("Riyadh, Saudi Arabia");
  });

  it("builds the URL with lat, lon, format=json, accept-language=ar,en", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ display_name: "x" }), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await reverseGeocode(24.7136, 46.6753);
    const calledUrl = (fetchSpy.mock.calls[0][0] as unknown as string).toString();
    expect(calledUrl).toMatch(/nominatim\.openstreetmap\.org\/reverse/);
    expect(calledUrl).toMatch(/lat=24\.7136/);
    expect(calledUrl).toMatch(/lon=46\.6753/);
    expect(calledUrl).toMatch(/format=json/);
    expect(calledUrl).toMatch(/accept-language=ar/);
  });

  it("falls back to 'lat, lng' when display_name is missing", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    ) as unknown as typeof fetch;
    const out = await reverseGeocode(24.7136, 46.6753);
    expect(out).toBe("24.71360, 46.67530");
  });

  it("falls back to 'lat, lng' on non-200 HTTP status", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("error", { status: 500 }),
    ) as unknown as typeof fetch;
    const out = await reverseGeocode(24.7136, 46.6753);
    expect(out).toBe("24.71360, 46.67530");
  });

  it("falls back to 'lat, lng' when fetch throws (network error)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const out = await reverseGeocode(24.7136, 46.6753);
    expect(out).toBe("24.71360, 46.67530");
  });

  it("falls back when JSON parsing fails", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("not json", { status: 200 }),
    ) as unknown as typeof fetch;
    const out = await reverseGeocode(24.7136, 46.6753);
    expect(out).toBe("24.71360, 46.67530");
  });

  it("sends a User-Agent header identifying the app (Nominatim policy)", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ display_name: "x" }), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await reverseGeocode(0, 0);
    const init = fetchSpy.mock.calls[0][1] as unknown as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toContain("CityMarketsSA");
  });
});