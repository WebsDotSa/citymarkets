"use client";

import Link from "next/link";
import { WifiOff, RefreshCw, ShoppingBag } from "lucide-react";

export default function OfflinePage() {
  return (
    <main className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
          <WifiOff className="w-10 h-10 text-primary" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          ما عندنا نت الحين
        </h1>
        <p className="text-gray-600 mb-6">
          تحتاج اتصال بالإنترنت لتتصفح المنتجات. اللي تشوفه كان آخر
          تحديث للموقع.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => location.reload()}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white font-medium hover:bg-primary-dark transition-colors"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            حاول مرة ثانية
          </button>
          <Link
            href="/orders/track"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gray-100 text-gray-900 font-medium hover:bg-gray-200 transition-colors"
          >
            <ShoppingBag className="w-4 h-4" aria-hidden="true" />
            تتبع طلبك
          </Link>
        </div>
      </div>
    </main>
  );
}
