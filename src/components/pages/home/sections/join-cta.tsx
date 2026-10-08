"use client";

import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";

export function JoinCta() {
  return (
    <section className="py-8 sm:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-gray-900 to-gray-800 text-white p-8 sm:p-12">
          {/* decorative blobs */}
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-primary/20 blur-3xl" />
          <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full bg-primary/10 blur-3xl" />

          <div className="relative grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/20 text-primary text-xs font-bold mb-4">
                <Sparkles className="w-3 h-3" />
                عروض حصرية للعملاء
              </div>
              <h2 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight">
                انضم واطلب أول طلب
                <br />
                <span className="text-primary">بخصم 15%</span>
              </h2>
              <p className="mt-3 text-gray-300 text-sm sm:text-base max-w-md">
                سجّل برقم جوالك، اجمع نقاط ولاء، واستفد من عجلة الحظ كل يوم.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 md:justify-end">
              <Link
                href="/auth/login"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-primary text-white font-bold text-sm hover:bg-primary-dark transition-colors"
              >
                سجل الآن
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <Link
                href="/catalog"
                className="inline-flex items-center justify-center px-6 py-3.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-semibold text-sm border border-white/20 transition-colors"
              >
                تصفح بدون تسجيل
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}