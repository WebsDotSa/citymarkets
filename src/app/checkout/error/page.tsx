"use client";

import Link from "next/link";
import { AlertCircle } from "lucide-react";

export default function CheckoutErrorPage() {
  return (
    <div className="max-w-lg mx-auto px-4 py-16 text-center">
      <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <AlertCircle className="w-12 h-12 text-red-600" />
      </div>
      <h1 className="text-2xl font-bold text-secondary mb-2">
        تعذّر إتمام الدفع
      </h1>
      <p className="text-gray-500 mb-8">
        لم تتم عملية الدفع. يمكنك المحاولة مرة أخرى أو اختيار الدفع عند الاستلام.
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        <Link
          href="/checkout"
          className="px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors"
        >
          إعادة المحاولة
        </Link>
        <Link
          href="/cart"
          className="px-6 py-3 border border-gray-200 text-secondary font-semibold rounded-xl hover:bg-gray-50 transition-colors"
        >
          السلة
        </Link>
      </div>
    </div>
  );
}
