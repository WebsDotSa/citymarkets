import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 text-center" dir="rtl">
      {/* 404 Icon */}
      <div className="w-24 h-24 mb-6 rounded-full bg-gray-100 flex items-center justify-center">
        <svg className="w-12 h-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-3">الصفحة غير موجودة</h1>
      
      <p className="text-gray-500 text-base mb-8 max-w-md">
        عذراً، الصفحة التي تبحث عنها غير موجودة أو تم نقلها. 
        يمكنك العودة للصفحة الرئيسية أو تصفح المنتجات.
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/"
          className="px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors"
        >
          الصفحة الرئيسية
        </Link>
        <Link
          href="/catalog"
          className="px-6 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-colors"
        >
          تصفح المنتجات
        </Link>
      </div>
    </div>
  );
}
