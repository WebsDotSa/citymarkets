/** @type {import('next').NextConfig} */
const nextConfig = {
  // TypeScript errors will now block the build (security/quality)
  // Only ignore in CI if needed: typescript: { ignoreBuildErrors: true }

  serverExternalPackages: ['@supabase/supabase-js', '@supabase/ssr'],

  // Runtime-writable upload subdirectories are populated by the API routes
  // (see src/app/api/admin/upload/route.ts and
  // src/app/api/v1/upload/place-images/route.ts). They are never known at
  // build time, so excluding them from file tracing keeps Turbopack from
  // enumerating thousands of user-uploaded files during `next build`.
  //
  // After the 2026-08-17 R2 migration, all catalog + vendor + banner
  // images live in `r2:citymarkets/`, so these local directories no
  // longer exist. We keep the exclude list defensive in case a future
  // upload endpoint writes here, and so old Docker layers don't try to
  // trace missing paths.
  outputFileTracingExcludes: {
    '*': [
      'public/images/products',
      'public/images/uploads',
      'public/images/place-images',
      'public/images/vendor',
      'public/images/banners',
      'public/images/categories',
      'public/images/offers',
    ],
  },

  // Enable compression
  compress: true,

  // Disable X-Powered-By header
  poweredByHeader: false,

  images: {
    // Enable modern formats
    formats: ['image/avif', 'image/webp'],

    // Remote patterns for external images
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.thawaniapp.com',
      },
      {
        protocol: 'https',
        hostname: '**.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'cdnjs.cloudflare.com',
      },
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
      },
      // Cloudflare R2 — citymarkets product image bucket via custom
      // CDN domain. `cdn.citymarkets.sa` is the public R2 dev URL
      // bound through a Cloudflare-for-SaaS custom hostname, so all
      // product/banner/category icons flow through our own domain
      // without leaking the bucket URL.
      {
        protocol: 'https',
        hostname: 'cdn.citymarkets.sa',
      },
    ],

    // Image optimization settings
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],

    // Minimum cache for optimized images — bumped from 30 days to 1 year
    // because URLs are content-hashed and never reused for different
    // content. Lighthouse flagged 4h cache as "inefficient". (2026-08-17)
    minimumCacheTTL: 31536000,
  },

  // Disable legacy JS polyfills. Modern browsers have Array.at/flat/flatMap,
  // Object.fromEntries/hasOwn, String.trimEnd/trimStart natively — skipping
  // the polyfills saves ~14 KiB on the initial JS download (Lighthouse
  // "Legacy JavaScript" audit). (2026-08-17 PageSpeed Performance fix.)
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns'],
  },

  // Locale-prefix redirect: Next.js 16 automatic locale detection redirects
  // non-API routes to /ar/<path>, but the project has no [locale] segment
  // so those 307s always 404. Strip the /ar/ and /en/ prefix transparently
  // so the user lands on the real route regardless of detected locale.
  async redirects() {
    return [
      // Locale prefix stripping.
      { source: '/ar/:path*', destination: '/:path*', permanent: false, has: [{ type: 'header', key: 'accept', value: '(?!text/markdown).*' }] },
      { source: '/en/:path*', destination: '/:path*', permanent: false, has: [{ type: 'header', key: 'accept', value: '(?!text/markdown).*' }] },
      // Legacy aliases (/login, /auth/register, /direct-order) → canonical
      // routes. The proxy (src/middleware.ts) also handles these at runtime
      // via the in-memory alias map; this layer is the build-time fallback
      // for environments where the proxy is bypassed. Belt-and-braces —
      // removing it should not change observed redirects.
      { source: '/login', destination: '/auth/login', permanent: true },
      { source: '/login/', destination: '/auth/login', permanent: true },
      { source: '/auth/register', destination: '/auth/signup', permanent: true },
      { source: '/auth/register/', destination: '/auth/signup', permanent: true },
      { source: '/direct-order', destination: '/orders/direct', permanent: true },
      { source: '/direct-order/', destination: '/orders/direct', permanent: true },
    ];
  },

  // Headers for caching, security, and AI agent discovery
  async headers() {
    const SITE_URL = 'https://citymarkets.sa';
    
    // Link headers for RFC 8288 agent discovery
    const linkHeaders = [
      `<${SITE_URL}/.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"`,
      `<${SITE_URL}/.well-known/openid-configuration>; rel="oauth-authorization-server"`,
      `<${SITE_URL}/.well-known/oauth-protected-resource>; rel="protected-resource"`,
      `<${SITE_URL}/.well-known/ucp>; rel="alternate"`,
      `<${SITE_URL}/.well-known/acp.json>; rel="alternate"`,
      `<${SITE_URL}/.well-known/mcp/server-card.json>; rel="alternate"`,
      `<${SITE_URL}/.well-known/agent-skills/index.json>; rel="skill-index"`,
      `<${SITE_URL}/auth.md>; rel="service-doc"; type="text/markdown"`,
      `<${SITE_URL}/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"`,
      `<${SITE_URL}/docs/api>; rel="service-doc"`,
      `<${SITE_URL}/sitemap.xml>; rel="sitemap"`,
    ].join(', ');

    return [
      // Security headers for all routes
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: [
              // Sensors and input devices — disabled unless explicitly
              // needed by a route. The site is e-commerce, so it has no
              // legitimate reason to ask for camera/mic/USB/etc.
              'camera=()',
              'microphone=()',
              'geolocation=()',
              'accelerometer=()',
              'gyroscope=()',
              'magnetometer=()',
              // Payment API: not used (Moyasar loads its own iframe
              // server-side; no PaymentRequest on this site).
              'payment=()',
              // USB / serial / HID — never needed.
              'usb=()',
              'serial=()',
              'hid=()',
              // Bluetooth — only useful for hardware integrations.
              'bluetooth=()',
              // Idle detection — leaks user presence patterns.
              'idle-detection=()',
              // Screen capture — can be misused for phishing.
              'display-capture=()',
              // Legacy features that should always be off.
              'document-domain=()',
              'window-placement=()',
              // Allow self only for autoplay + fullscreen (mobile
              // product video, PWA install prompt).
              'autoplay=(self)',
              'fullscreen=(self)',
              // Picture-in-picture — keep enabled (some pages embed
              // instructional videos).
              'picture-in-picture=(self)',
            ].join(', '),
          },
          // Content-Signal header (RFC Content Signals draft)
          // Declares AI content usage preferences
          {
            key: 'Content-Signal',
            value: 'ai-train=no, search=yes, ai-input=yes',
          },
          // Link headers for AI agent discovery (RFC 8288)
          {
            key: 'Link',
            value: linkHeaders,
          },
          // Content-Security-Policy (C1 hardening).
          //
          // For HTML responses, src/proxy.ts OVERRIDES this header with a
          // per-request nonce-injected policy that drops 'unsafe-inline'
          // and 'unsafe-eval' from script-src entirely. This static
          // policy is the fallback used by the CDN edge for non-HTML
          // responses (images, fonts, static assets) and by API routes
          // that don't go through the proxy, so it should be a strict
          // baseline.
          //
          // style-src still allows 'unsafe-inline' for Tailwind runtime
          // styles. A future tracked upgrade is to switch to nonce-based
          // styles as well.
          //
          // report-to (Reporting API v1) sends violations to the
          // configured endpoint group; report-uri is kept as a fallback
          // for browsers that don't implement Reporting API v1.
          // Set NEXT_PUBLIC_CSP_REPORT_URI in env to enable; otherwise
          // the directives are omitted (no point sending to nowhere).
          ...(process.env.NEXT_PUBLIC_CSP_REPORT_URI ? [{
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://www.googletagmanager.com https://connect.facebook.net",
              "script-src-elem 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://www.googletagmanager.com https://connect.facebook.net",
              "script-src-attr 'none'",
              "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.googleapis.com",
              "img-src 'self' data: blob: https://images.unsplash.com https://*.thawaniapp.com https://cdnjs.cloudflare.com https://raw.githubusercontent.com https://*.tile.openstreetmap.org https://www.openstreetmap.org https://cdn.citymarkets.sa https://www.facebook.com https://connect.facebook.net",
              "font-src 'self' data: https://cdnjs.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com",
              "connect-src 'self' https://api.citymarkets.sa https://*.moyasar.com https://api.moyasar.com https://www.google-analytics.com https://*.analytics.google.com https://connect.facebook.net https://*.facebook.com https://*.fbcdn.net",
              "frame-src 'self' https://api.moyasar.com",
              "worker-src 'self' blob:",
              "manifest-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'self'",
              "upgrade-insecure-requests",
              "block-all-mixed-content",
              `report-uri ${process.env.NEXT_PUBLIC_CSP_REPORT_URI}`,
              `report-to csp-endpoint`,
            ].join('; '),
          }, {
            // Reporting API v1 endpoint group. Browsers send CSP
            // violations here in addition to report-uri.
            key: 'Report-To',
            value: JSON.stringify({
              group: 'csp-endpoint',
              max_age: 10886400,
              endpoints: [{ url: process.env.NEXT_PUBLIC_CSP_REPORT_URI }],
            }),
          }, {
            // Reporting API v0 (legacy, used by report-uri).
            key: 'Reporting-Endpoints',
            value: `csp-endpoint="${process.env.NEXT_PUBLIC_CSP_REPORT_URI}"`,
          }] : [{
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://www.googletagmanager.com https://connect.facebook.net",
              "script-src-elem 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://www.googletagmanager.com https://connect.facebook.net",
              "script-src-attr 'none'",
              "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.googleapis.com",
              "img-src 'self' data: blob: https://images.unsplash.com https://*.thawaniapp.com https://cdnjs.cloudflare.com https://raw.githubusercontent.com https://*.tile.openstreetmap.org https://www.openstreetmap.org https://cdn.citymarkets.sa https://www.facebook.com https://connect.facebook.net",
              "font-src 'self' data: https://cdnjs.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com",
              "connect-src 'self' https://api.citymarkets.sa https://*.moyasar.com https://api.moyasar.com https://www.google-analytics.com https://*.analytics.google.com https://connect.facebook.net https://*.facebook.com https://*.fbcdn.net",
              "frame-src 'self' https://api.moyasar.com",
              "worker-src 'self' blob:",
              "manifest-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'self'",
              "upgrade-insecure-requests",
              "block-all-mixed-content",
            ].join('; '),
          }]),
          // Additional security headers
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-origin',
          },
          {
            // COEP=credentialless: allows cross-origin payment iframes
            // (Moyasar) to load without us having to demand CORP headers
            // from every upstream. Requests are sent without cookies /
            // client certs so an embedded origin cannot impersonate the
            // user. Stronger than `unsafe-none` (the previous default)
            // and weaker than `require-corp` (which would break Moyasar).
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },
          // Vary header for content negotiation
          {
            key: 'Vary',
            value: 'Accept',
          },
          // Markdown negotiation support
          {
            key: 'X-Markdown-Negotiation',
            value: 'supported',
          },
        ],
      },

      // Static assets caching (1 year)
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },

      // Images caching — bumped from 30 days to 1 year because the
      // URLs are content-hashed (the source URL is part of the cache
      // key), so a URL change happens whenever the image content
      // changes. (2026-08-17 PageSpeed Performance fix.)
      {
        source: '/_next/image/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },

      // Public static assets in /images, /fonts, etc — long cache too.
      // /_next/static already gets 1y above; this covers content-hashed
      // images / SVGs served from /public directly. (2026-08-17)
      {
        source: '/images/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2592000, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/fonts/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // Favicons — long cache (URL changes when icon changes).
      {
        source: '/favicon.ico',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2592000, immutable',
          },
        ],
      },
      {
        source: '/apple-touch-icon.png',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2592000, immutable',
          },
        ],
      },

      // API routes - short caching
      {
        source: '/api/v1/banners',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=300, s-maxage=600',
          },
          {
            key: 'Content-Signal',
            value: 'ai-train=no, search=yes, ai-input=yes',
          },
        ],
      },
      {
        source: '/api/v1/categories',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, s-maxage=86400',
          },
          {
            key: 'Content-Signal',
            value: 'ai-train=no, search=yes, ai-input=yes',
          },
        ],
      },
      
      // Markdown negotiation for API endpoints
      {
        source: '/api/v1/products',
        headers: [
          {
            key: 'Content-Signal',
            value: 'ai-train=no, search=yes, ai-input=yes',
          },
        ],
      },
      
      // .well-known endpoints caching
      {
        source: '/.well-known/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
          {
            key: 'Content-Signal',
            value: 'ai-train=no, search=yes, ai-input=yes',
          },
        ],
      },
      
      // robots.txt and sitemap caching
      {
        source: '/robots.txt',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
          },
          {
            key: 'Content-Type',
            value: 'text/plain; charset=utf-8',
          },
          {
            // Content-Signals: declared on robots.txt response so agent
            // scanners can detect AI usage preferences even when they
            // don't parse the body (Cloudflare Radar / isitagentready.com
            // look for the header specifically). (2026-08-17)
            key: 'Content-Signal',
            value: 'ai-train=no, search=yes, ai-input=yes',
          },
        ],
      },
      {
        source: '/sitemap.xml',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
          },
        ],
      },
      
      // OpenAPI spec caching
      {
        source: '/openapi.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
          {
            key: 'Content-Signal',
            value: 'ai-train=no, search=yes, ai-input=yes',
          },
        ],
      },
      
      // auth.md caching
      {
        source: '/auth.md',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
          {
            key: 'Content-Signal',
            value: 'ai-train=no, search=yes, ai-input=yes',
          },
        ],
      },

      // Authenticated API routes — never cache responses. PII like
      // addresses, orders, payment status, profile, and the auth
      // session must not be persisted by browsers or intermediaries.
      {
        source: '/api/v1/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, private',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
