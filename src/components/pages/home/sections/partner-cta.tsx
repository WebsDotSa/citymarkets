"use client";

import Link from "next/link";
import { Store, ArrowLeft, CheckCircle2 } from "lucide-react";

/**
 * "افتح متجرك معنا" section on the home page.
 *
 * Sits below the stores showcase so merchants who land on the site
 * see the existing storefronts FIRST (social proof), then a clear
 * call-to-action to join. Mirrors the styling of the customer-facing
 * JoinCta so the page rhythm stays consistent.
 */
export function PartnerCta() {
  return (
    <section className="py-8 sm:py-10" id="become-partner">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-emerald-700 text-white p-8 sm:p-12">
          <div className="absolute top-0 left-0 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute bottom-0 right-0 w-48 h-48 rounded-full bg-amber-300/20 blur-3xl" />

          <div className="relative grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-bold mb-4">
                <Store className="w-3.5 h-3.5" />
                لشركاء النجاح
              </div>
              <h2 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight">
                افتح متجرك على
                <br />
                <span className="text-amber-200">أسواق سيتي اليوم</span>
              </h2>
              <p className="mt-3 text-white/90 text-sm sm:text-base max-w-md">
                انضم لمئات المتاجر الناجحة. بدون رسوم اشتراك شهرية،
                وبدون تكاليف إعداد. ابدأ خلال 3 أيام.
              </p>

              <ul className="mt-5 space-y-2 text-sm text-white/90">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-amber-200 shrink-0" />
                  لوحة تحكم كاملة لإدارة المنتجات والأوردرات
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-amber-200 shrink-0" />
                  شبكة توصيل جاهزة أو خيار التوصيل الذاتي
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-amber-200 shrink-0" />
                  دعم تسويقي وتحليلات لزيادة مبيعاتك
                </li>
              </ul>
            </div>

            <div className="flex flex-col gap-3 md:items-end">
              <Link
                href="/vendors/register"
                className="inline-flex items-center justify-center gap-2 px-7 py-4 rounded-2xl bg-white text-primary font-bold text-sm hover:bg-amber-50 transition shadow-lg"
              >
                سجّل متجرك الآن
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <Link
                href="/vendors"
                className="inline-flex items-center justify-center px-7 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-semibold text-sm border border-white/30 transition"
              >
                تصفح المتاجر الحالية
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}