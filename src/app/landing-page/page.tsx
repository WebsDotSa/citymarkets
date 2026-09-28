import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CityMarketsLogo } from "@/components/brand/city-markets-logo";
import { buildPageMetadata } from "@/lib/seo/site";
import { SOCIAL_LINKS, STORE_ADDRESS_AR } from "@/lib/social-links";

const SOCIAL_ICONS: Record<string, ReactNode> = {
  tiktok: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.1z" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
  snapchat: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
      <path d="M12.206.793c.99 0 4.347.276 5.93 3.812.529 1.193.405 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301.165-.088.344-.104.464-.104.182 0 .359.029.509.09.45.149.734.479.734.838.015.449-.39.839-1.213 1.168-.089.029-.209.075-.344.119-.45.135-1.139.36-1.333.81-.09.224-.061.524.12.868l.015.015c.06.136 1.526 3.475 4.791 4.014.255.044.435.27.42.509 0 .075-.015.149-.045.225-.24.569-1.273.988-3.146 1.272-.059.091-.12.375-.164.57-.029.179-.074.36-.134.553-.076.271-.27.405-.555.405h-.03c-.135 0-.313-.031-.538-.074-.36-.075-.765-.135-1.273-.135-.3 0-.599.015-.913.074-.6.104-1.123.464-1.722.884-.853.599-1.826 1.288-3.293 1.288-.06 0-.119-.015-.18-.015h-.149c-1.467 0-2.427-.675-3.279-1.288-.599-.42-1.107-.78-1.707-.884-.314-.045-.629-.074-.928-.074-.54 0-.958.089-1.272.149-.211.043-.391.074-.54.074-.374 0-.523-.224-.583-.42-.061-.192-.09-.389-.135-.567-.046-.181-.105-.494-.166-.57-1.918-.222-2.95-.642-3.189-1.226-.031-.062-.052-.13-.055-.196-.015-.243.165-.465.42-.509 3.264-.54 4.73-3.879 4.791-4.02l.016-.029c.18-.345.224-.645.119-.869-.195-.434-.884-.658-1.332-.809-.121-.029-.24-.074-.346-.119-1.107-.435-1.257-.93-1.197-1.273.09-.479.674-.793 1.168-.793.146 0 .27.029.383.074.42.194.789.299 1.104.299.234 0 .384-.06.465-.105l-.046-.569c-.098-1.626-.225-3.651.307-4.837C7.392 1.077 10.739.802 11.654.802l.419-.009h.13z" />
    </svg>
  ),
  instagram: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163C8.741 0 8.333.014 7.053.072 2.695.272.273 2.694.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.622 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  ),
  whatsapp: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  ),
};

const SOCIALS = SOCIAL_LINKS.map((s) => ({
  name: s.label,
  ...s,
  icon: SOCIAL_ICONS[s.platform],
}));

export const metadata: Metadata = buildPageMetadata({
  title: "أسواق سيتي المركزية | توصيل سوبرماركت ذكي",
  description:
    "توصيل سوبرماركت ذكي — منتجات طازجة وتموينية لباب بيتك خلال ٣٠ دقيقة. تابعنا على TikTok و X و Snapchat و Instagram و WhatsApp.",
  path: "/landing-page",
});


const FEATURES = [
  { icon: "🚚", title: "توصيل سريع", desc: "خلال ٣٠ دقيقة" },
  { icon: "💰", title: "عروض يومية", desc: "خصومات حصرية" },
  { icon: "🥬", title: "منتجات طازجة", desc: "خضروات وفواكه يومياً" },
  { icon: "📱", title: "طلب سهل", desc: "عبر التطبيق أو الموقع" },
];

const STEPS = [
  { icon: "🛒", title: "١. اختار المنتجات", desc: "تصفح الفئات واختر ما تريد" },
  { icon: "📱", title: "٢. اطلب", desc: "أضف للسلة وأرسل الطلب" },
  { icon: "🚚", title: "٣. استلم", desc: "يوصل لبيتك خلال ٣٠ دقيقة" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* ===== HERO ===== */}
      <section className="bg-gradient-to-br from-primary via-primary to-primary-dark py-8 md:py-10">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="inline-block mb-2">
            <CityMarketsLogo height={48} priority href={null} />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">
            أسواق سيتي المركزية
          </h1>
          <p className="text-white/80 text-sm md:text-base mb-5">
            توصيل سوبرماركت ذكي — لباب بيتك خلال ٣٠ دقيقة
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href="/categories"
              className="bg-white text-primary px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-gray-100 transition-colors inline-block shadow-lg"
            >
              تصفح المنتجات
            </a>
            <a
              href="/ai-chat"
              className="bg-white/20 text-white border-2 border-white/50 px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-white/30 transition-colors inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />
              </svg>
              المساعد الذكي
            </a>
            <a
              href="https://apps.apple.com/sa/app/%D8%A3%D8%B3%D9%88%D8%A7%D9%82-%D8%B3%D9%8A%D8%AA%D9%8A/id6799888123?l=ar"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="حمّل التطبيق من App Store"
              className="inline-flex items-center gap-2 bg-black text-white px-5 py-2 rounded-xl font-semibold text-sm hover:bg-gray-900 transition-colors shadow-lg border border-white/20"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25" />
              </svg>
              <span className="flex flex-col items-start leading-tight">
                <span className="text-[10px] opacity-80">حمّله من</span>
                <span className="text-sm font-bold -mt-0.5">App Store</span>
              </span>
            </a>
          </div>
        </div>
      </section>

      {/* ===== SOCIAL MEDIA ===== */}
      <section className="bg-gradient-to-br from-primary to-primary-dark border-t border-white/10 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h2 className="text-xl font-bold text-white mb-1">تابعنا على التواصل الاجتماعي</h2>
          <p className="text-white/70 mb-6 text-sm">ابق على اطلاع بأحدث العروض والمنتجات</p>
          <div className="grid grid-cols-2 md:flex md:flex-wrap justify-center gap-3 md:gap-4 max-w-2xl mx-auto">
            {SOCIALS.map((s) => (
              <a
                key={s.name}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2.5 bg-white/15 hover:bg-white/25 backdrop-blur-sm px-5 py-3 rounded-2xl transition-all hover:scale-105"
              >
                <span className="text-white transition-transform group-hover:scale-110">{s.icon}</span>
                <span className="text-white font-semibold text-sm">{s.name}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ===== SNAPCHAT QR ===== */}
      <section className="bg-gradient-to-br from-primary to-primary-dark border-t border-white/10 pb-10 pt-2">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-white/70 text-sm mb-4">امسح الكود واضفنا على سناب شات</p>
          <a
            href="https://www.snapchat.com/@city_markets"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-3xl overflow-hidden shadow-2xl ring-4 ring-white/20 hover:ring-white/40 transition-all hover:scale-105"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://cdn.citymarkets.sa/static/snapchat-qr.jpg"
              alt="أضفنا على سناب شات - city_markets"
              width={220}
              height={220}
              className="w-[220px] h-auto block"
            />
          </a>
          <p className="text-white/60 text-xs mt-3">@city_markets</p>
        </div>
      </section>

      {/* ===== FEATURES ===== */}
      <section className="py-8 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="text-center p-4 bg-primary-light/50 rounded-2xl">
                <div className="text-3xl mb-1.5">{f.icon}</div>
                <h3 className="font-bold text-gray-800 text-sm">{f.title}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section className="py-10 bg-[#f5f5f7]">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-xl font-bold text-center text-gray-800 mb-6">كيفية الطلب</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {STEPS.map((s) => (
              <div key={s.title} className="text-center p-6 bg-white rounded-2xl border border-gray-100 shadow-sm">
                <div className="w-14 h-14 bg-primary-light rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl">{s.icon}</span>
                </div>
                <h3 className="font-bold text-gray-800 mb-1">{s.title}</h3>
                <p className="text-gray-500 text-sm">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CONTACT ===== */}
      <section className="py-8 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h2 className="text-lg font-bold text-gray-800 mb-3">تواصل معنا</h2>
              <div className="space-y-2.5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-primary-light rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </div>
                  <span className="text-gray-600 text-sm">{STORE_ADDRESS_AR}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-primary-light rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </div>
                  <span className="text-gray-600 text-sm">السبت - الخميس: ٦ص - ١٢ص</span>
                </div>
              </div>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800 mb-3">ابدأ التسوق الآن</h2>
              <p className="text-gray-500 text-sm mb-3">اطلب منتجاتك المفضلة ووصلك خلال ٣٠ دقيقة</p>
              <a
                href="/categories"
                className="inline-flex items-center gap-2 bg-primary text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-primary-dark transition-colors"
              >
                تسوق الآن
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
