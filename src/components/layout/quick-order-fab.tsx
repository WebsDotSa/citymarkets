'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Zap } from 'lucide-react';
import { BRAND } from '@/lib/brand-theme';

/**
 * Floating "طلب سريع" button.
 *
 * Sits 20px above the bottom nav (h-16 = 64px → bottom: 84px).
 * Anchored to the right edge of the viewport so it doesn't collide
 * with the bottom-nav icons. Hidden on storefront routes where the
 * page itself owns the CTA (e.g. /orders/direct, /checkout).
 */
export function QuickOrderFab() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  // Pages where the floating CTA must yield to the page's own sticky CTA.
  const suppressedRoutes = ['/orders/direct', '/checkout', '/auth/login'];
  if (suppressedRoutes.some((r) => pathname?.startsWith(r))) return null;

  return (
    <Link
      href="/orders/direct"
      aria-label="طلب سريع"
      className="fixed end-4 z-40 flex items-center gap-2 text-white font-bold rounded-full shadow-lg active:scale-95 transition-transform"
      style={{
        bottom: 84, // 64 (bottom-nav) + 20 (gap)
        backgroundColor: BRAND.brandGreen,
        padding: '12px 18px',
        boxShadow: '0 8px 24px rgba(0,147,69,0.45)',
      }}
    >
      <Zap className="w-5 h-5" fill="white" />
      <span className="text-sm">طلب سريع</span>
    </Link>
  );
}