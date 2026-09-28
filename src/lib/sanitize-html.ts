/**
 * Minimal HTML sanitizer for trusted-author rich-text content (e.g. blog
 * posts authored by admins and rendered via dangerouslySetInnerHTML).
 *
 * SECURITY (F9): The proxy's CSP (`script-src 'nonce-...' 'strict-dynamic'`,
 * `script-src-attr 'none'`) blocks classic `<script>` and `<img onerror>`
 * payloads in modern browsers. However, CSP does not block
 * `javascript:` URI in `href`, older WebView quirks, or
 * same-origin authenticated API calls from a victim browser. This
 * sanitizer is defense-in-depth: we strip the dangerous patterns at
 * the write boundary so they can never reach the DOM.
 *
 * This is intentionally a conservative allowlist-based sanitizer. It
 * does NOT aim to be a general-purpose HTML parser — it operates on
 * the raw string with regex patterns tuned for the patterns we
 * actually see in our admin authoring tool. If you need richer HTML
 * support, install a battle-tested library (DOMPurify / sanitize-html)
 * and replace this module.
 */

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'blockquote',
  'code',
  'pre',
  'a',
  'img',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
  'div',
]);

const STRIP_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'style',
  'link',
  'meta',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'base',
  'frame',
  'frameset',
  'noframes',
  'noscript',
  'svg',
  'math',
  'video',
  'audio',
  'source',
  'track',
  'applet',
];

// Attributes we allow on every tag (href/src specifically apply to <a>/<img>).
const ALLOWED_ATTRS = new Set([
  'href',
  'src',
  'alt',
  'title',
  'class',
  'id',
  'lang',
  'dir',
  'target',
  'rel',
  'width',
  'height',
  'colspan',
  'rowspan',
  'datetime',
  'cite',
  'loading',
]);

const DANGEROUS_PROTOCOLS = /^(?:javascript|vbscript|data\s*:[^,]*text\/html|file|mocha|livescript):/i;
const SAFE_IMAGE_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i;

function stripDangerousTags(html: string): string {
  let out = html;
  for (const tag of STRIP_TAGS) {
    // Open + close + self-closing variants, case-insensitive, non-greedy.
    const re = new RegExp(`<\\s*/?\\s*${tag}\\b[^>]*>`, 'gi');
    out = out.replace(re, '');
  }
  return out;
}

function stripEventHandlers(html: string): string {
  // Remove any on*="..." attribute (single or double quoted) — CSP blocks
  // these in modern browsers, but we strip them anyway.
  return html.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

function sanitizeAttributes(html: string): string {
  // Match tag openings: <tagname attrs>. Walk each attribute and keep
  // only the allowlist. Anything else gets removed.
  return html.replace(/<([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (match, tag: string, attrs: string) => {
    const lower = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) {
      // Unknown tag — strip it but keep inner text. Drop the angle brackets
      // and attributes, keep the tag name so the text remains readable.
      return '';
    }
    // Walk attrs string and keep allowed ones; rewrite dangerous protocols.
    const kept: string[] = [];
    const attrRe = /([a-zA-Z_:][a-zA-Z0-9_:.\\-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(attrs)) !== null) {
      const name = m[1].toLowerCase();
      const raw = m[2] ?? m[3] ?? m[4] ?? '';
      if (!ALLOWED_ATTRS.has(name)) continue;
      if ((name === 'href' || name === 'src') && DANGEROUS_PROTOCOLS.test(raw)) {
        // Allow data: only for images on src.
        if (name === 'src' && SAFE_IMAGE_DATA_URI.test(raw)) {
          kept.push(`${name}="${raw.replace(/"/g, '&quot;')}"`);
        }
        continue;
      }
      // Force rel="noopener noreferrer" on external <a>.
      let cleaned = raw.replace(/"/g, '&quot;');
      if (name === 'href' && /^https?:/i.test(cleaned)) {
        kept.push('rel="noopener noreferrer"');
      }
      kept.push(`${name}="${cleaned}"`);
    }
    // Force external links to open in a new tab safely.
    if (lower === 'a') {
      if (!kept.some((k) => k.startsWith('rel='))) {
        kept.push('rel="noopener noreferrer"');
      }
      if (!kept.some((k) => k.startsWith('target='))) {
        kept.push('target="_blank"');
      }
    }
    return kept.length ? `<${lower} ${kept.join(' ')}>` : `<${lower}>`;
  });
}

export function sanitizeHtml(input: string, maxLength = 50_000): string {
  if (typeof input !== 'string') return '';
  let html = input.slice(0, maxLength);
  html = stripDangerousTags(html);
  html = stripEventHandlers(html);
  html = sanitizeAttributes(html);
  return html;
}