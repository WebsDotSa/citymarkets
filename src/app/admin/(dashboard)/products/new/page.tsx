import { Suspense } from "react";
import NewProductClient from "./NewProductClient";

// BUG FIX (PCP-145, Phase 15 Frontend Audit): `useSearchParams()` in a
// client component must be wrapped in a `<Suspense>` boundary, otherwise
// Next.js 15 throws a build-time deopt and the page falls back to
// client-side rendering for the entire route. Splitting the inner logic
// into a client child lets the outer page render a Suspense boundary
// while still letting the child use hooks.

export default function NewProductPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-4xl mx-auto flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      }
    >
      <NewProductClient />
    </Suspense>
  );
}

