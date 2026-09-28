import Script from "next/script";

/**
 * Google Analytics 4 (gtag.js) loader.
 *
 * Server component — renders directly into SSR HTML so the tags ship on first
 * paint and don't depend on hydration. Uses `afterInteractive` strategy so the
 * page doesn't block on the GA network round-trip.
 *
 * Pageviews are tracked automatically via `gtag('config', ...)`. Custom events
 * can be fired from client code via `window.gtag(...)` after this component
 * has mounted.
 *
 * SECURITY (CSP-H): `proxy.ts` issues a per-request CSP nonce. Without
 * passing it to Next.js <Script>, the inline bootstrap script would be
 * blocked by `script-src 'nonce-…'` (since `'unsafe-inline'` was
 * intentionally dropped from the per-request policy). `strict-dynamic`
 * covers the externally-loaded gtag.js (googleta­gmanager.com is in the
 * allowlist), but the inline init still needs the nonce.
 */
export function GoogleAnalytics({
  measurementId,
  nonce,
}: {
  measurementId: string;
  nonce?: string;
}) {
  return (
    <>
      <Script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
        nonce={nonce}
      />
      <Script id="ga-init" strategy="afterInteractive" nonce={nonce}>
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${measurementId}');
        `}
      </Script>
    </>
  );
}
