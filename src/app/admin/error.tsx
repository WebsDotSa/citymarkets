'use client';

import { useEffect } from 'react';
import Link from 'next/link';

interface AdminErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AdminError({ error, reset }: AdminErrorProps) {
  useEffect(() => {
    console.error('Admin error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center px-4 max-w-lg">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-50 flex items-center justify-center">
          <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-gray-900 mb-2">حدث خطأ</h1>
        <p className="text-gray-500 text-sm mb-6">
          حدث خطأ أثناء تحميل هذه الصفحة. يمكنك المحاولة مرة أخرى.
        </p>

        <div className="mb-6 p-3 bg-gray-100 rounded-lg text-right text-xs text-gray-600">
          <p className="font-mono">{error.message}</p>
          {error.digest && <p className="font-mono mt-1">Error ID: {error.digest}</p>}
          {process.env.NODE_ENV === 'development' && error.stack && (
            <pre className="font-mono mt-2 text-tiny whitespace-pre-wrap break-all max-h-48 overflow-auto" dir="ltr">
              {error.stack}
            </pre>
          )}
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-dark transition-colors"
          >
            حاول مرة أخرى
          </button>
          <Link
            href="/admin/dashboard"
            className="px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            لوحة التحكم
          </Link>
        </div>
      </div>
    </div>
  );
}
