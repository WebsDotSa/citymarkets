import Link from 'next/link';

export default function BlogNotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center" dir="rtl">
      <div className="text-6xl mb-6">📝</div>
      <h1 className="text-2xl font-bold text-gray-900 mb-3">المقال غير موجود</h1>
      <p className="text-gray-500 mb-6">
        عذراً، المقال الذي تبحث عنه غير موجود أو تم حذفه.
      </p>
      <Link
        href="/blog"
        className="px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors"
      >
        العودة للمدونة
      </Link>
    </div>
  );
}
