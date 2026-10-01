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

import { StoresRenderer } from "./section-renderers";

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