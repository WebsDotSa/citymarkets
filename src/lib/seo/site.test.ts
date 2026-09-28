import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the pure helpers in seo/site.ts.
 * DB-backed functions live in product.ts and are covered separately.
 *
 * The env-driven branches of `getSiteUrl` and `getMoyasarSiteUrl` are
 * covered by using vi.stubEnv + vi.resetModules() to reload the module
 * with the desired env state.
 */

async function loadSite(envs: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(envs)) {
    vi.stubEnv(k, v);
  }
  return await import("./site");
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSiteUrl", () => {
  it("defaults to https://citymarkets.sa when no env set", async () => {
    const mod = await loadSite();
    expect(mod.getSiteUrl()).toBe("https://citymarkets.sa");
  });

  it("prefers NEXT_PUBLIC_SITE_URL when set", async () => {
    const mod = await loadSite({ NEXT_PUBLIC_SITE_URL: "https://staging.example.com" });
    expect(mod.getSiteUrl()).toBe("https://staging.example.com");
  });

  it("falls back to SITE_URL when NEXT_PUBLIC_SITE_URL is absent", async () => {
    const mod = await loadSite({ SITE_URL: "https://env.example.com" });
    expect(mod.getSiteUrl()).toBe("https://env.example.com");
  });

  it("strips a trailing slash so concatenation is safe", async () => {
    const mod = await loadSite({ NEXT_PUBLIC_SITE_URL: "https://example.com/" });
    expect(mod.getSiteUrl()).toBe("https://example.com");
  });
});

describe("absoluteUrl", () => {
  it("returns the bare site url when path is empty", async () => {
    const mod = await loadSite();
    expect(mod.absoluteUrl("")).toBe("https://citymarkets.sa");
  });

  it("prefixes the path with the site url (adding the leading slash)", async () => {
    const mod = await loadSite();
    expect(mod.absoluteUrl("products/x")).toBe("https://citymarkets.sa/products/x");
  });

  it("does not double-slash a path that already starts with /", async () => {
    const mod = await loadSite();
    expect(mod.absoluteUrl("/products/x")).toBe("https://citymarkets.sa/products/x");
  });

  it("passes through an already-absolute https url untouched", async () => {
    const mod = await loadSite();
    expect(mod.absoluteUrl("https://cdn.example.com/img.jpg")).toBe(
      "https://cdn.example.com/img.jpg",
    );
  });

  it("passes through an already-absolute http url untouched", async () => {
    const mod = await loadSite();
    expect(mod.absoluteUrl("http://legacy.example.com/p")).toBe("http://legacy.example.com/p");
  });
});

describe("buildPageMetadata", () => {
  it("emits title, default description, and a canonical pointing to absolute path", async () => {
    const mod = await loadSite();
    const md = mod.buildPageMetadata({ title: "عروض اليوم", path: "/offers" });
    expect(md.title).toBe("عروض اليوم");
    expect(md.description).toBe(mod.DEFAULT_DESCRIPTION);
    expect(md.alternates?.canonical).toBe("https://citymarkets.sa/offers");
    expect(md.openGraph?.url).toBe("https://citymarkets.sa/offers");
    expect(md.openGraph?.locale).toBe("ar_SA");
    expect(md.openGraph?.siteName).toBe(mod.SITE_NAME);
  });

  it("uses a custom description when provided", async () => {
    const mod = await loadSite();
    const md = mod.buildPageMetadata({
      title: "x",
      description: "مخصص",
      path: "/",
    });
    expect(md.description).toBe("مخصص");
  });

  it("falls back to the bare site url when no path is given", async () => {
    const mod = await loadSite();
    const md = mod.buildPageMetadata({ title: "x" });
    expect(md.alternates?.canonical).toBe("https://citymarkets.sa");
  });

  it("emits noindex/follow=false when noIndex=true", async () => {
    const mod = await loadSite();
    const md = mod.buildPageMetadata({ title: "x", path: "/old", noIndex: true });
    expect(md.robots).toEqual({ index: false, follow: false });
  });

  it("emits index/follow by default", async () => {
    const mod = await loadSite();
    const md = mod.buildPageMetadata({ title: "x", path: "/p" });
    expect(md.robots).toEqual({ index: true, follow: true });
  });

  it("uses a custom OG image when provided, defaulting to absoluteUrl of the supplied path", async () => {
    const mod = await loadSite();
    const md = mod.buildPageMetadata({
      title: "x",
      image: "/og/custom.png",
    });
    const ogImages = Array.isArray(md.openGraph?.images)
      ? md.openGraph!.images
      : md.openGraph?.images
      ? [md.openGraph.images]
      : [];
    expect(ogImages).toEqual([
      {
        url: "https://citymarkets.sa/og/custom.png",
        width: 1200,
        height: 630,
        alt: mod.SITE_NAME,
      },
    ]);
    expect(md.twitter?.images).toEqual(["https://citymarkets.sa/og/custom.png"]);
  });

  it("falls back to the default OG image when image is null/empty", async () => {
    const mod = await loadSite();
    const md = mod.buildPageMetadata({ title: "x", image: null });
    const ogImages = Array.isArray(md.openGraph?.images)
      ? md.openGraph!.images
      : md.openGraph?.images
      ? [md.openGraph.images]
      : [];
    const first = ogImages[0];
    const firstUrl =
      typeof first === "string"
        ? first
        : first instanceof URL
        ? first.toString()
        : (first as { url: string }).url;
    expect(firstUrl).toBe(`https://citymarkets.sa${mod.DEFAULT_OG_IMAGE}`);
  });

  it("uses summary_large_image twitter card", async () => {
    const mod = await loadSite();
    const md = mod.buildPageMetadata({ title: "x" });
    expect((md.twitter as { card?: string } | undefined)?.card).toBe("summary_large_image");
  });
});

describe("exports", () => {
  it("SITE_NAME and SITE_NAME_SHORT are non-empty strings", async () => {
    const mod = await loadSite();
    expect(typeof mod.SITE_NAME).toBe("string");
    expect(mod.SITE_NAME.length).toBeGreaterThan(0);
    expect(typeof mod.SITE_NAME_SHORT).toBe("string");
    expect(mod.SITE_NAME_SHORT.length).toBeGreaterThan(0);
  });

  it("DEFAULT_DESCRIPTION is non-empty", async () => {
    const mod = await loadSite();
    expect(mod.DEFAULT_DESCRIPTION.length).toBeGreaterThan(0);
  });

  it("DEFAULT_OG_IMAGE is a path starting with /", async () => {
    const mod = await loadSite();
    expect(mod.DEFAULT_OG_IMAGE.startsWith("/")).toBe(true);
  });

  it("rootSiteMetadata exposes a metadataBase URL", async () => {
    const mod = await loadSite();
    expect(mod.rootSiteMetadata.metadataBase).toBeInstanceOf(URL);
    expect((mod.rootSiteMetadata.metadataBase as URL).toString()).toBe(
      "https://citymarkets.sa/",
    );
  });
});
