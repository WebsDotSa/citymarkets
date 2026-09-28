'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { error as logError } from '@/lib/logger';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Route through the project logger so LOG_LEVEL gate + Sentry transport
    // (added later) work consistently. Use a redacted meta tag so we never
    // echo the full error message into the dev console / Sentry breadcrumbs
    // for non-actionable boundary hits.
    logError('Page boundary error', {
      digest: error?.digest ?? null,
      name: error?.name ?? null,
    });
  }, [error]);

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 text-center" dir="rtl">
      {/* Error Icon */}
      <div className="w-24 h-24 mb-6 rounded-full bg-red-50 flex items-center justify-center">
        <svg className="w-12 h-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-3">حدث خطأ غير متوقع</h1>
      
      <p className="text-gray-500 text-base mb-6 max-w-md">
        عذراً، حدث خطأ أثناء تحميل الصفحة. يمكنك المحاولة مرة أخرى أو العودة للصفحة الرئيسية.
      </p>

      {process.env.NODE_ENV === 'development' && (
        <div className="mb-6 p-4 bg-gray-100 rounded-xl text-right text-xs text-gray-600 max-w-lg overflow-auto">
          <p className="font-mono">{error.message}</p>
          {error.digest && (
            <p className="font-mono mt-2">Error ID: {error.digest}</p>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={reset}
          className="px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors"
        >
          حاول مرة أخرى
        </button>
        <Link
          href="/"
          className="px-6 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-colors"
        >
          الصفحة الرئيسية
        </Link>
      </div>
    </div>
  );
}
