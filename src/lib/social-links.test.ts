import { describe, it, expect } from "vitest";
import { SOCIAL_LINKS, STORE_ADDRESS_AR } from "./social-links";

describe("SOCIAL_LINKS", () => {
  it("exports a non-empty list of platform entries", () => {
    expect(SOCIAL_LINKS.length).toBeGreaterThan(0);
  });

  it("contains entries for every platform the brand uses", () => {
    const platforms = SOCIAL_LINKS.map((l) => l.platform);
    expect(platforms).toContain("tiktok");
    expect(platforms).toContain("x");
    expect(platforms).toContain("snapchat");
    expect(platforms).toContain("instagram");
    expect(platforms).toContain("whatsapp");
  });

  it("every entry has a valid https URL and non-empty label + handle", () => {
    for (const link of SOCIAL_LINKS) {
      expect(link.href.startsWith("https://")).toBe(true);
      expect(link.label.length).toBeGreaterThan(0);
      expect(link.handle.length).toBeGreaterThan(0);
    }
  });

  it("does not contain duplicate platforms", () => {
    const platforms = SOCIAL_LINKS.map((l) => l.platform);
    expect(new Set(platforms).size).toBe(platforms.length);
  });

  it("snapchat URL points at the @<handle> profile page", () => {
    const snap = SOCIAL_LINKS.find((l) => l.platform === "snapchat");
    expect(snap?.href).toContain("snapchat.com/@");
    expect(snap?.href).toContain("@city_markets");
  });

  it("X.com and Instagram use the city_markets1 handles", () => {
    const x = SOCIAL_LINKS.find((l) => l.platform === "x");
    const ig = SOCIAL_LINKS.find((l) => l.platform === "instagram");
    expect(x?.href).toBe("https://x.com/city_markets1");
    expect(ig?.href).toBe("https://www.instagram.com/city_markets1");
  });

  it("WhatsApp entry is the broadcast channel (not a wa.me chat)", () => {
    const wa = SOCIAL_LINKS.find((l) => l.platform === "whatsapp");
    expect(wa?.href).toContain("whatsapp.com/channel/");
    expect(wa?.href).not.toContain("wa.me/");
  });
});

describe("STORE_ADDRESS_AR", () => {
  it("is a non-empty Arabic string", () => {
    expect(typeof STORE_ADDRESS_AR).toBe("string");
    expect(STORE_ADDRESS_AR.length).toBeGreaterThan(0);
    expect(STORE_ADDRESS_AR).toMatch(/[\u0600-\u06FF]/);
  });
});
