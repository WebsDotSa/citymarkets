/**
 * Code-Splitting Guide for Performance
 *
 * Identifies large components and modules that benefit from dynamic imports
 * (lazy loading / code-splitting) to reduce initial JavaScript bundle.
 */

/**
 * Components identified for code-splitting
 *
 * Criteria:
 * - > 500 lines of code
 * - Only needed on specific routes
 * - Not critical for initial render
 * - Can be loaded after page interactive
 */
export interface CodeSplitComponent {
  path: string;
  size: number; // lines of code
  priority: 'high' | 'medium' | 'low';
  route: string;
  reason: string;
  currentImport: string;
  optimizedImport: string;
}

export const CODE_SPLIT_CANDIDATES: CodeSplitComponent[] = [
  {
    path: 'src/components/pages/checkout/checkout-new.tsx',
    size: 1520,
    priority: 'high',
    route: '/checkout',
    reason: 'Large multi-step form, only needed on checkout page',
    currentImport: "import { Checkout } from '@/components/pages/checkout/checkout-new';",
    optimizedImport:
      "const Checkout = dynamic(() => import('@/components/pages/checkout/checkout-new').then(m => ({ default: m.Checkout })), { loading: () => <CheckoutSkeleton /> });",
  },

  {
    path: 'src/components/admin/section-editor.tsx',
    size: 938,
    priority: 'high',
    route: '/admin/home-design',
    reason: 'Admin-only editor, not needed for customer views',
    currentImport: "import { SectionEditor } from '@/components/admin/section-editor';",
    optimizedImport:
      "const SectionEditor = dynamic(() => import('@/components/admin/section-editor').then(m => ({ default: m.SectionEditor })), { ssr: false });",
  },

  {
    path: 'src/components/storefront/home/section-renderers.tsx',
    size: 893,
    priority: 'medium',
    route: '/home',
    reason: 'Renders dynamic home sections, can load asynchronously',
    currentImport: "import { renderSection } from '@/components/storefront/home/section-renderers';",
    optimizedImport:
      "const renderSection = lazy(() => import('@/components/storefront/home/section-renderers').then(m => ({ default: m.renderSection })));",
  },

  {
    path: 'src/components/admin/product-edit-form.tsx',
    size: 821,
    priority: 'high',
    route: '/admin/products/[id]/edit',
    reason: 'Admin-only form, needed only when editing products',
    currentImport: "import { ProductEditForm } from '@/components/admin/product-edit-form';",
    optimizedImport:
      "const ProductEditForm = dynamic(() => import('@/components/admin/product-edit-form').then(m => ({ default: m.ProductEditForm })), { ssr: false });",
  },

  {
    path: 'src/components/admin/admin-delivery-settings.tsx',
    size: 821,
    priority: 'medium',
    route: '/admin/settings/delivery',
    reason: 'Admin-only settings, not needed for storefront',
    currentImport:
      "import { AdminDeliverySettings } from '@/components/admin/admin-delivery-settings';",
    optimizedImport:
      "const AdminDeliverySettings = dynamic(() => import('@/components/admin/admin-delivery-settings').then(m => ({ default: m.AdminDeliverySettings })), { ssr: false });",
  },

  {
    path: 'src/components/pages/product/product-detail-page.tsx',
    size: 616,
    priority: 'medium',
    route: '/products/[id]',
    reason: 'Heavy product detail view, can load asynchronously',
    currentImport: "import { ProductDetailPage } from '@/components/pages/product/product-detail-page';",
    optimizedImport:
      "const ProductDetailPage = dynamic(() => import('@/components/pages/product/product-detail-page').then(m => ({ default: m.ProductDetailPage })), { loading: () => <ProductSkeleton /> });",
  },

  {
    path: 'src/components/pages/ai/ai-chat-page.tsx',
    size: 609,
    priority: 'low',
    route: '/ai-chat',
    reason: 'AI feature, not core to platform, used rarely',
    currentImport: "import { AIChatPage } from '@/components/pages/ai/ai-chat-page';",
    optimizedImport:
      "const AIChatPage = dynamic(() => import('@/components/pages/ai/ai-chat-page').then(m => ({ default: m.AIChatPage })), { ssr: false, loading: () => <ChatSkeleton /> });",
  },
];

/**
 * Expected bundle size reduction by priority
 */
export const EXPECTED_IMPROVEMENTS = {
  high: {
    total: '~45 KB reduction',
    percentage: '15-20%',
    impact: 'Most significant improvement',
    items: 4,
  },
  medium: {
    total: '~25 KB reduction',
    percentage: '8-12%',
    impact: 'Good improvement, secondary priority',
    items: 3,
  },
  low: {
    total: '~10 KB reduction',
    percentage: '3-5%',
    impact: 'Minor improvement',
    items: 1,
  },
  total: {
    total: '~80 KB reduction',
    percentage: '20-30%',
    impact: 'All code-splits combined',
  },
};

/**
 * Implementation pattern using Next.js dynamic()
 *
 * Benefits:
 * - Automatic code-splitting
 * - Automatic chunk loading
 * - Client-side re-rendering
 * - With loading fallback (Suspense)
 */
export const IMPLEMENTATION_EXAMPLE = `
// Before: Eager import, bundled with main.js
import { CheckoutPage } from '@/components/pages/checkout/checkout-new';

// After: Dynamic import, separate chunk loaded on demand
import dynamic from 'next/dynamic';

const CheckoutPage = dynamic(
  () => import('@/components/pages/checkout/checkout-new').then(m => ({
    default: m.CheckoutPage
  })),
  {
    loading: () => <LoadingSpinner />, // Show while loading
    ssr: false, // Only needed if not pre-renderable
  }
);

// Usage: Same as before
<CheckoutPage />
`;

/**
 * When to apply code-splitting
 *
 * Good candidates (DO split):
 * ✅ Admin-only pages (customers don't need)
 * ✅ Rarely-used features (AI chat, advanced settings)
 * ✅ Large modal dialogs (only shown on user action)
 * ✅ Heavy editors (product editor, banner designer)
 * ✅ Route-specific components (checkout, admin)
 *
 * Bad candidates (DON'T split):
 * ❌ Components rendered on every page (header, footer, nav)
 * ❌ Tiny components (< 5 KB)
 * ❌ Critical above-the-fold content
 * ❌ Components needed for interactive SSR
 */

/**
 * Verification checklist before applying code-splits
 */
export const VERIFICATION_CHECKLIST = [
  'Component is not used on home/index page',
  'Component is only used on specific route(s)',
  'Component is > 500 lines or > 20 KB minified',
  'Component doesn\'t need SSR (or ssr: false is acceptable)',
  'Loading fallback/skeleton is provided',
  'Component can be imported with .then(m => ({ default: m.ComponentName }))',
  'Tests still pass after dynamic import',
  'Bundle size reduction verified with `npm run analyze`',
];

/**
 * Measuring bundle size before/after
 *
 * ```bash
 * # Install bundle analyzer
 * npm install --save-dev @next/bundle-analyzer
 *
 * # Create .env.local
 * ANALYZE=true
 *
 * # Build and analyze
 * npm run build
 * ```
 *
 * Look for:
 * - "main" chunk size decrease
 * - New chunk files for dynamic imports
 * - Gzip size reduction
 */
