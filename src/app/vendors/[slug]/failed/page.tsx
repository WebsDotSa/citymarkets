import { Suspense } from "react";
import VendorOrderFailedClient from "./VendorOrderFailedClient";

// BUG FIX (PCP-145, Phase 15 Frontend Audit): `useSearchParams()` in a
// client component must be wrapped in a `<Suspense>` boundary, otherwise
// Next.js 15 throws a build-time deopt and the page falls back to
// client-side rendering for the entire route. Wrapping the inner client
// component in `<Suspense>` here keeps the page renderable and lets Next
// statically prerender the outer shell.

export default function VendorOrderFailedPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen bg-gray-50 flex items-center justify-center p-4"
          dir="rtl"
        >
          <div className="text-gray-500">جاري التحميل...</div>
        </div>
      }
    >
      <VendorOrderFailedClient />
    </Suspense>
  );
}

