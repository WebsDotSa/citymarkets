import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Get device info from User-Agent
 */
function getDeviceInfo(userAgent: string) {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);

  return { isMobile, isIOS, isAndroid };
}

/**
 * Get iOS app scheme URL
 */
function getIOSAppURL() {
  const appID = process.env.NEXT_PUBLIC_IOS_APP_ID || 'com.citymarkets.app';
  return `citymarkets://`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userAgent = request.headers.get('user-agent') || '';
  const device = getDeviceInfo(userAgent);
  const appURL = getIOSAppURL();

  // Dynamic manifest based on device
  const manifest = {
    name: 'أسواق سيتي المركزية',
    short_name: 'سيتي مارت',
    description: 'توصيل سوبرماركت ذكي - توصيل خلال ساعة',
    start_url: '/?utm_source=pwa',
    display: device.isMobile ? 'standalone' : 'standalone',
    orientation: device.isMobile ? 'portrait' : 'any',
    background_color: '#009345',
    theme_color: '#009345',
    dir: 'rtl',
    lang: 'ar',
    categories: ['shopping', 'food'],
    shortcuts: [
      {
        name: 'السلة',
        short_name: 'السلة',
        url: '/cart?utm_source=pwa',
        icons: [{ src: '/android-chrome-192x192.png', sizes: '192x192' }],
      },
      {
        name: 'طلباتي',
        short_name: 'طلباتي',
        url: '/orders?utm_source=pwa',
        icons: [{ src: '/android-chrome-192x192.png', sizes: '192x192' }],
      },
    ],
    icons: [
      {
        src: '/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    screenshots: [
      {
        src: '/screenshots/home.png',
        sizes: '1280x720',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'الصفحة الرئيسية',
      },
      {
        src: '/screenshots/catalog.png',
        sizes: '1280x720',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'تصفح المنتجات',
      },
      {
        src: '/screenshots/cart.png',
        sizes: '1280x720',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'السلة',
      },
    ],
    related_applications: device.isIOS
      ? []
      : [
          {
            platform: 'play',
            url: 'https://play.google.com/store/apps/details?id=com.citymarkets.app',
            id: 'com.citymarkets.app',
          },
        ],
    prefer_related_applications: false,
  };

  return NextResponse.json(manifest);
}
