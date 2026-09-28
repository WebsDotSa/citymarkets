'use client';

import { useEffect } from 'react';
import { error as logError } from '@/lib/logger';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    logError('Global boundary error', {
      digest: error?.digest ?? null,
      name: error?.name ?? null,
    });
  }, [error]);

  return (
    <html dir="rtl" lang="ar">
      <body>
        <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center bg-white">
          <div className="w-24 h-24 mb-6 rounded-full bg-red-50 flex items-center justify-center">
            <svg className="w-12 h-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-3">حدث خطأ في التطبيق</h1>
          
          <p className="text-gray-500 text-base mb-8 max-w-md">
            عذراً، حدث خطأ في تحميل التطبيق. يرجى تحديث الصفحة.
          </p>

          <button
            onClick={reset}
            className="px-8 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors"
          >
            تحديث الصفحة
          </button>
        </div>
      </body>
    </html>
  );
}
