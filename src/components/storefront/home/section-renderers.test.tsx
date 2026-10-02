/**
 * Regression test for PCP-87 / PCP-75.2.
 *
 * `section-renderers.tsx` previously built `/vendor/${slug}` for both
 * inline banner links and store cards. The `/vendor/*` route segment is
 * the protected vendor-admin subtree — middleware 307-redirects
 * unauthenticated visitors to `/vendor/${slug}/admin/login`. The public
 * storefront lives at `/vendors/${slug}` (plural).
 *
 * This test pins the new behaviour: store card hrefs must produce
 * `/vendors/...` anchors, never `/vendor/...`. (Banner rendering is
 * non-trivial due to HeroBanner sub-components — covered by manual QA
 * via the admin editor's preview pane.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock `next/link` as a plain anchor so we can read the resolved href.
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

// Mock `next/image` to a plain <img>.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    ...rest
  }: React.ImgHTMLAttributes<HTMLImageElement> & { src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt ?? ""} {...rest} />
  ),
}));

// Mock the API so StoresRenderer fetches our fixture. apiFetch unwraps
// the {success, data} envelope — return our fixture as `data`.
vi.mock("@/lib/catalog", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/catalog")>("@/lib/catalog");
  return {
    ...actual,
    apiFetch: vi.fn(async () => ({
      success: true,
      data: [
        {
          id: "v-1",
          slug: "aamiz-kafeh",
          name: "أميز كافية",
          logo_url: null,
          product_count: 36,
          is_active: true,
        },
      ],
    })),
  };
});

import { StoresRenderer, HtmlBlockRenderer } from "./section-renderers";

describe("PCP-87 — vendor link paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("store card: href uses /vendors/<slug>, not /vendor/<slug>", async () => {
    render(
      <StoresRenderer
        settings={{
          title: "Featured stores",
          display: "grid",
        }}
      />,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      const vendorLink = links.find((l) =>
        (l.getAttribute("href") ?? "").includes("aamiz-kafeh"),
      );
      expect(vendorLink).toBeDefined();
      const href = vendorLink?.getAttribute("href") ?? "";
      // Critical PCP-87 assertions:
      expect(href).toMatch(/^\/vendors\//);
      expect(href).not.toMatch(/^\/vendor\//);
    });
  });
});

/**
 * PCP-135 — HtmlBlockRenderer XSS regression.
 *
 * The pre-fix renderer stripped ONLY `<script>` tags via a regex. That
 * left `<iframe>`, `<object>`, `<svg onload=...>`, `<img onerror=...>`,
 * and `javascript:` URIs wide open. After the fix the renderer pipes
 * `content_html` through the central allowlist sanitizer
 * (`src/lib/sanitize-html.ts`).
 */
describe("PCP-135 — HtmlBlockRenderer XSS sanitization", () => {
  it("strips <script> tags (legacy regex behavior preserved)", () => {
    const { container } = render(
      <HtmlBlockRenderer
        settings={{
          content_html: "<p>hello</p><script>alert(1)</script>",
          background_color: "#fff",
          text_color: "#000",
        }}
      />,
    );
    expect(container.innerHTML).not.toContain("<script");
    expect(container.innerHTML).toContain("hello");
  });

  it("strips <iframe>, <object>, <embed>, <svg>", () => {
    const { container } = render(
      <HtmlBlockRenderer
        settings={{
          content_html:
            '<iframe src="https://evil.example/"></iframe>' +
            '<object data="x"></object>' +
            '<embed src="x">' +
            '<svg onload="alert(1)"><circle r="5"/></svg>',
          background_color: "#fff",
          text_color: "#000",
        }}
      />,
    );
    expect(container.innerHTML).not.toContain("<iframe");
    expect(container.innerHTML).not.toContain("<object");
    expect(container.innerHTML).not.toContain("<embed");
    expect(container.innerHTML).not.toContain("<svg");
    expect(container.innerHTML).not.toContain("onload");
  });

  it("strips <img onerror=...> handlers", () => {
    const { container } = render(
      <HtmlBlockRenderer
        settings={{
          content_html: '<img src="x" onerror="alert(1)">',
          background_color: "#fff",
          text_color: "#000",
        }}
      />,
    );
    expect(container.innerHTML).not.toContain("onerror");
    expect(container.innerHTML).not.toContain("alert");
  });

  it("blocks javascript: and vbscript: URIs in <a href>", () => {
    const { container } = render(
      <HtmlBlockRenderer
        settings={{
          content_html:
            '<a href="javascript:alert(1)">click me</a>' +
            '<a href="vbscript:msgbox(1)">click me</a>',
          background_color: "#fff",
          text_color: "#000",
        }}
      />,
    );
    expect(container.innerHTML).not.toMatch(/href\s*=\s*["']?javascript:/i);
    expect(container.innerHTML).not.toMatch(/href\s*=\s*["']?vbscript:/i);
    // Anchor tag rendered (text preserved) but with safe attrs.
    expect(container.innerHTML).toContain("click me");
  });

  it("preserves safe formatting (p, strong, ul, li, a with http href)", () => {
    const { container } = render(
      <HtmlBlockRenderer
        settings={{
          content_html:
            '<p>Hello <strong>world</strong></p>' +
            '<ul><li>one</li><li>two</li></ul>' +
            '<a href="https://example.com/">link</a>',
          background_color: "#fff",
          text_color: "#000",
        }}
      />,
    );
    expect(container.innerHTML).toContain("<p>");
    expect(container.innerHTML).toContain("<strong>world</strong>");
    expect(container.innerHTML).toContain("<li>one</li>");
    expect(container.innerHTML).toContain('href="https://example.com/"');
  });

  it("returns null when content_html is empty", () => {
    const { container } = render(
      <HtmlBlockRenderer
        settings={{
          content_html: "",
          background_color: "#fff",
          text_color: "#000",
        }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});