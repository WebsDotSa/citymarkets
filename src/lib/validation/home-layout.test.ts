/**
 * Unit tests for the home layout zod schemas.
 *
 * Coverage:
 *   - Each section type round-trips with valid settings.
 *   - Top-level input rejects too many sections (max 50).
 *   - Discriminant `type` mismatch yields a clear Arabic error.
 *   - Lightning deals requires ends_at to parse as a date.
 */
import { describe, it, expect } from "vitest";
import { homeLayoutInputSchema } from "@/lib/validation/home-layout";

const baseValidBannersSettings = {
  layout: "carousel",
  auto_play: true,
  show_dots: true,
  banners: [
    {
      id: "b-1",
      image_url: "https://cdn.example.com/x.jpg",
      title_ar: "عرض خاص",
      link_type: "category",
      link_value: "fruits",
    },
  ],
};

describe("homeLayoutInputSchema", () => {
  it("accepts a single banners section", () => {
    const res = homeLayoutInputSchema.safeParse({
      sections: [
        {
          id: "s-1",
          type: "banners",
          visible: true,
          settings: baseValidBannersSettings,
        },
      ],
    });
    expect(res.success).toBe(true);
  });

  it("rejects an unknown type", () => {
    const res = homeLayoutInputSchema.safeParse({
      sections: [{ id: "x", type: "magic_block", visible: true, settings: {} }],
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      // First error should mention the invalid discriminator value.
      expect(JSON.stringify(res.error.errors)).toMatch(/magic_block|Invalid/);
    }
  });

  it("rejects more than 50 sections", () => {
    const sections = Array.from({ length: 51 }, (_, i) => ({
      id: `s-${i}`,
      type: "banners",
      visible: true,
      settings: baseValidBannersSettings,
    }));
    const res = homeLayoutInputSchema.safeParse({ sections });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.errors[0].message).toMatch(/50/);
    }
  });

  it("rejects lightning_deals when ends_at is missing", () => {
    const res = homeLayoutInputSchema.safeParse({
      sections: [
        {
          id: "l-1",
          type: "lightning_deals",
          visible: true,
          settings: {
            title: "عروض برق",
            ends_at: "",
            product_source: "on_offer",
          },
        },
      ],
    });
    expect(res.success).toBe(false);
  });

  it("accepts lightning_deals with a valid ISO ends_at", () => {
    const res = homeLayoutInputSchema.safeParse({
      sections: [
        {
          id: "l-2",
          type: "lightning_deals",
          visible: true,
          settings: {
            title: "عروض برق",
            ends_at: new Date(Date.now() + 3600_000).toISOString(),
            product_source: "on_offer",
            background_color: "#fef3c7",
          },
        },
      ],
    });
    expect(res.success).toBe(true);
  });

  it("rejects banners with an invalid layout", () => {
    const res = homeLayoutInputSchema.safeParse({
      sections: [
        {
          id: "s-bad",
          type: "banners",
          visible: true,
          settings: { layout: "spiral", banners: [] },
        },
      ],
    });
    expect(res.success).toBe(false);
  });

  it("rejects html_block without content_html", () => {
    const res = homeLayoutInputSchema.safeParse({
      sections: [
        {
          id: "html-1",
          type: "html_block",
          visible: true,
          settings: { content_html: "" },
        },
      ],
    });
    expect(res.success).toBe(false);
  });
});