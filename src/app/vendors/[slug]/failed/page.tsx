"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { XCircle } from "lucide-react";

export default function VendorOrderFailedPage() {
  const searchParams = useSearchParams();
  const orderNumber = searchParams.get("order");

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <XCircle className="w-12 h-12 text-red-600" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          فشل الدفع
        </h1>

        <p className="text-gray-600 mb-6">
          عذراً! لم يتم إكمال عملية الدفع. يمكنك المحاولة مرة أخرى أو التواصل معنا
        </p>

        {orderNumber && (
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <p className="text-sm text-gray-500 mb-1">رقم الطلب</p>
            <p className="text-xl font-bold text-gray-700">{orderNumber}</p>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={() => window.history.back()}
            className="w-full bg-primary text-white py-3 rounded-xl font-medium hover:bg-primary-dark transition-colors"
          >
            إعادة المحاولة
          </button>

          <Link
            href="/"
            className="block w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-200 transition-colors text-center"
          >
            العودة للرئيسية
          </Link>
        </div>

        <div className="mt-6 pt-6 border-t">
          <p className="text-sm text-gray-500">
            مشكلة مستمرة؟ تواصل معنا على{" "}
            <a href="tel:+966530444976" className="text-primary font-medium">
              0530444976
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
