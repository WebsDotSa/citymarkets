import Script from "next/script";

/**
 * Meta Pixel (Facebook Pixel) loader — citymarkets.sa.
 *
 * Server component — renders directly into SSR HTML so the pixel fires on
 * first paint and doesn't depend on hydration. Uses `afterInteractive`
 * strategy so the page doesn't block on the Facebook network round-trip.
 *
 * PageViews are tracked automatically via `fbq('track', 'PageView')`.
 * Custom events (Purchase, Lead, AddToCart, etc.) can be fired from client
 * code via `window.fbq(...)` after this component has mounted. The
 * `useAnalytics` hook is the recommended entry point so events stay
 * consistent across GA4 and Meta.
 *
 * SECURITY (CSP-H): `proxy.ts` issues a per-request CSP nonce. Without
 * passing it to Next.js <Script>, the inline `fbq('init', ...)` bootstrap
 * would be blocked by `script-src 'nonce-…'` (since `'unsafe-inline'` was
 * intentionally dropped from the per-request policy). The external
 * `fbevents.js` is allowlisted under `script-src-elem
 * https://connect.facebook.net` in proxy.ts and next.config.mjs.
 *
 * NOSCRIPT IMG: rendered as a plain <img> outside the React tree because
 * Next.js <Script> doesn't natively produce a `<noscript>` tag and Meta
 * recommends a hard pixel fallback for crawlers / JS-disabled browsers.
 * The image src must be allowlisted in `img-src` (proxy.ts +
 * next.config.mjs include `https://www.facebook.com`).
 */
export function MetaPixel({
  pixelId,
  nonce,
}: {
  pixelId: string;
  nonce?: string;
}) {
  return (
    <>
      <Script
        id="meta-pixel-init"
        strategy="afterInteractive"
        nonce={nonce}
      >{`
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '${pixelId}');
        fbq('track', 'PageView');
      `}</Script>
      <noscript>
        <img
          height={1}
          width={1}
          className="hidden"
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}