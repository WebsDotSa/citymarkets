import Link from 'next/link';

export default function AdminNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center px-4">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gray-100 flex items-center justify-center">
          <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-gray-900 mb-2">الصفحة غير موجودة</h1>
        <p className="text-gray-500 text-sm mb-6">
          الصفحة المطلوبة غير موجودة أو ليس لديك صلاحية للوصول إليها.
        </p>

        <div className="flex gap-3 justify-center">
          <Link
            href="/admin/dashboard"
            className="px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-dark transition-colors"
          >
            لوحة التحكم
          </Link>
          <Link
            href="/"
            className="px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            الموقع الرئيسي
          </Link>
        </div>
      </div>
    </div>
  );
}
