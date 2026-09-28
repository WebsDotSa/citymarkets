import type { Metadata } from 'next';

/**
 * Admin route group layout.
 *
 * The root layout in app/layout.tsx renders StoreChrome + Footer for the
 * public storefront. This layout wraps all /admin/* routes (including login)
 * with NO storefront chrome — admin pages should never show the site header,
 * bottom nav, or marketing footer.
 *
 * Note: the (dashboard) nested layout still provides the AdminLayout (sidebar +
 * header). This layout's job is just to suppress the storefront chrome.
 */

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}