/**
 * Regression test for PCP-87 / PCP-75.2.
 *
 * `section-renderers.tsx` previously built `/vendor/${slug}` for both
 * inline banner links and store cards. The `/vendor/*` route segment is
 * the protected vendor-admin subtree — middleware 307-redirects
 * unauthenticated visitors to `/vendor/${slug}/admin/login`. The public
 * storefront lives at `/vendors/${slug}` (plural).
 *
 * These tests pin the new behaviour: vendor banners AND store cards must
 * produce `<a href="/vendors/...">` anchors, never `/vendor/...`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock `next/link` as a plain anchor so we can read the resolved href and
// assert the URL prefix without depending on Next.js internals.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// `next/image` renders fine in jsdom but throws without a sizes config;
// just emit an <img>.
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

// lucide-react icons aren't meaningful for this regression — stub them
// as span placeholders to keep the markup readable in failures.
vi.mock("lucide-react", () => ({
  Sparkles: () => <span data-icon="sparkles" />,
  Zap: () => <span data-icon="zap" />,
  Flame: () => <span data-icon="flame" />,
  Store: () => <span data-icon="store" />,
  TicketPercent: () => <span data-icon="ticket" />,
  Megaphone: () => <span data-icon="megaphone" />,
  FileText: () => <span data-icon="file" />,
}));

// Mock design-system pieces we don't need to render — keeps the test
// focused on anchor hrefs and avoids loading CSS from @/components/design.
vi.mock("@/components/design/hero-banner", () => ({
  HeroBanner: () => <div data-testid="hero-banner" />,
  StaticHero: () => <div data-testid="static-hero" />,
  PromoStrip: () => <div data-testid="promo-strip" />,
}));

// Mock apiFetch using vi.hoisted so vitest's hoisting doesn't trip on
// top-level references. Cart-context (transitive import) pulls in
// `apiFetch`, so we must stub it from the first import of the module.
const apiMocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));
vi.mock("@/lib/catalog", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/catalog")>("@/lib/catalog");
  return {
    ...actual,
    apiFetch: apiMocks.apiFetch,
  };
});

// Helpers ─────────────────────────────────────────────────────────

function ok<T>(data: T) {
  return Promise.resolve({ success: true, data });
}

// ────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────

describe("section-renderers — vendor link routing (PCP-87)", () => {
  beforeEach(() => {
    apiMocks.apiFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a vendor banner with the public /vendors/ storefront URL", async () => {
    // No fetch needed for banners — `bannerHref` is pure.
    const { BannersRenderer } = await import("./section-renderers");

    render(
      <BannersRenderer
        settings={{
          layout: "grid_2",
          banners: [
            {
              id: "b1",
              image_url: "https://example.com/banner.jpg",
              title_ar: "متجر أبو زيد",
              link_type: "vendor",
              link_value: "abu-zayed-store",
            },
          ],
        }}
      />,
    );

    const anchor = screen.getByRole("link");
    expect(anchor.getAttribute("href")).toBe("/vendors/abu-zayed-store");
    expect(anchor.getAttribute("href")).toMatch(/^\/vendors\//);
    // Belt + braces: explicitly assert the broken prefix would be wrong.
    expect(anchor.getAttribute("href")).not.toMatch(/^\/vendor\//);
  });

  it("renders StoresRenderer cards with /vendors/<slug-or-id> URLs", async () => {
    apiMocks.apiFetch.mockImplementation(() =>
      ok([
        {
          id: "v-1",
          name_ar: "متجر أبو زيد",
          slug: "abu-zayed-store",
          cover_url: null,
          description_ar: null,
        },
        {
          id: "v-2",
          name_ar: "المتجر المميز",
          slug: "elite-shop",
          cover_url: null,
          description_ar: null,
        },
        {
          id: "v-3",
          // No slug — code must fall back to id.
          name_ar: "متجر ثالث",
          slug: undefined as unknown as string,
          cover_url: null,
          description_ar: null,
        },
      ]),
    );

    const { StoresRenderer } = await import("./section-renderers");

    render(
      <StoresRenderer
        settings={{
          title: "المتاجر",
          display: "grid",
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("link").length).toBe(3);
    });

    const anchors = screen.getAllByRole("link");
    const hrefs = anchors.map((a) => a.getAttribute("href")).sort();
    expect(hrefs).toEqual([
      "/vendors/abu-zayed-store",
      "/vendors/elite-shop",
      "/vendors/v-3",
    ]);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/vendors\//);
      expect(href).not.toMatch(/^\/vendor\//);
    }
  });

  it("renders banners + stores together with no anchor pointing at the singular /vendor/ route", async () => {
    apiMocks.apiFetch.mockImplementation(() =>
      ok([
        {
          id: "v-1",
          name_ar: "متجر واحد",
          slug: "store-one",
          cover_url: null,
          description_ar: null,
        },
      ]),
    );

    const { BannersRenderer, StoresRenderer } = await import(
      "./section-renderers"
    );

    render(
      <div>
        <BannersRenderer
          settings={{
            layout: "grid_2",
            banners: [
              {
                id: "b1",
                image_url: "https://example.com/b1.jpg",
                link_type: "vendor",
                link_value: "store-one",
              },
            ],
          }}
        />
        <StoresRenderer
          settings={{
            title: "المتاجر",
            display: "grid",
          }}
        />
      </div>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("link").length).toBe(2);
    });

    const anchors = screen.getAllByRole("link");
    expect(anchors.length).toBe(2);
    for (const a of anchors) {
      const href = a.getAttribute("href") ?? "";
      // Every vendor-related anchor must use the plural storefront route.
      expect(href.startsWith("/vendor/")).toBe(false);
      expect(href.startsWith("/vendors/")).toBe(true);
    }
  });
});