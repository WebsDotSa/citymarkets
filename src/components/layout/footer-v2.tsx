"use client";

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { useState } from "react";
import { CityMarketsLogo } from "@/components/brand/city-markets-logo";
import {
  SOCIAL_LINKS,
  STORE_PHONE_E164,
  STORE_PHONE_DISPLAY,
  type SocialPlatform,
} from "@/lib/social-links";
import {
  Phone,
  Mail,
  MapPin,
  Truck,
  Shield,
  CreditCard,
  Clock,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Bike,
} from "lucide-react";

/**
 * Icons are kept local to the footer because lucide-style SVGs are coupled
 * to the layout's sizing. URLs come from the central SOCIAL_LINKS list.
 */
const SOCIAL_ICONS: Record<SocialPlatform, ReactNode> = {
  tiktok: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.1z" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
  snapchat: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12.206.793c.99 0 4.347.276 5.93 3.812.529 1.193.405 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301.165-.088.344-.104.464-.104.182 0 .359.029.509.09.45.149.734.479.734.838.015.449-.39.839-1.213 1.168-.089.029-.209.075-.344.119-.45.135-1.139.36-1.333.81-.09.224-.061.524.12.868l.015.015c.06.136 1.526 3.475 4.791 4.014.255.044.435.27.42.509 0 .075-.015.149-.045.225-.24.569-1.273.988-3.146 1.272-.059.091-.12.375-.164.57-.029.179-.074.36-.134.553-.076.271-.27.405-.555.405h-.03c-.135 0-.313-.031-.538-.074-.36-.075-.765-.135-1.273-.135-.3 0-.599.015-.913.074-.6.104-1.123.464-1.722.884-.853.599-1.826 1.288-3.293 1.288-.06 0-.119-.015-.18-.015h-.149c-1.467 0-2.427-.675-3.279-1.288-.599-.42-1.107-.78-1.707-.884-.314-.045-.629-.074-.928-.074-.54 0-.958.089-1.272.149-.211.043-.391.074-.54.074-.374 0-.523-.224-.583-.42-.061-.192-.09-.389-.135-.567-.046-.181-.105-.494-.166-.57-1.918-.222-2.95-.642-3.189-1.226-.031-.062-.052-.13-.055-.196-.015-.243.165-.465.42-.509 3.264-.54 4.73-3.879 4.791-4.02l.016-.029c.18-.345.224-.645.119-.869-.195-.434-.884-.658-1.332-.809-.121-.029-.24-.074-.346-.119-1.107-.435-1.257-.93-1.197-1.273.09-.479.674-.793 1.168-.793.146 0 .27.029.383.074.42.194.789.299 1.104.299.234 0 .384-.06.465-.105l-.046-.569c-.098-1.626-.225-3.651.307-4.837C7.392 1.077 10.739.802 11.654.802l.419-.009h.13z" />
    </svg>
  ),
  instagram: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163C8.741 0 8.333.014 7.053.072 2.695.272.273 2.694.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.622 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  ),
  whatsapp: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  ),
};

/**
 * Direct chat with the call center (wa.me). Different from the broadcast
 * "channel" link in SOCIAL_LINKS — keep both: social icon → channel,
 * big CTA button → chat.
 */
const WHATSAPP_CHAT_URL = `https://wa.me/${STORE_PHONE_E164.replace(/\D/g, "")}`;

const QUICK_LINKS = [
  { href: "/", label: "الرئيسية" },
  { href: "/categories", label: "التصنيفات" },
  { href: "/vendors", label: "المتاجر" },
  { href: "/offers", label: "العروض" },
  { href: "/cart", label: "السلة" },
  { href: "/orders", label: "طلباتي" },
];

const INFO_LINKS = [
  { href: "/about", label: "عن أسواق سيتي" },
  { href: "/terms", label: "الشروط والأحكام" },
  { href: "/privacy", label: "سياسة الخصوصية" },
  { href: "/contact", label: "اتصل بنا" },
  { href: "/vendors/register", label: "افتح متجرك معنا" },
  { href: "/employment", label: "وظائف" },
  { href: "/delegate", label: "كن مندوب توصيل" },
  { href: "/help", label: "المساعدة" },
];

const FEATURES = [
  { icon: Truck, label: "توصيل سريع", desc: "خلال 45 دقيقة" },
  { icon: Shield, label: "دفع آمن", desc: "محمي 100%" },
  { icon: CreditCard, label: "طرق دفع متعددة", desc: "بطاقات، آبل باي" },
  { icon: Clock, label: "دعم 24/7", desc: "نحن هنا دائماً" },
];

function AccordionItem({ title, children }: { title: string; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-b border-gray-200 last:border-0">
      <button
        className="flex items-center justify-between w-full py-4 text-right"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span className="font-semibold text-gray-800">{title}</span>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-primary" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        )}
      </button>
      {isOpen && <div className="pb-4 text-gray-600">{children}</div>}
    </div>
  );
}

export function FooterV2() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-gradient-to-b from-gray-50 to-gray-100 mt-auto">
      {/* Features Banner */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {FEATURES.map((feat) => {
              const Icon = feat.icon;
              return (
                <div
                  key={feat.label}
                  className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50 hover:bg-primary-50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{feat.label}</p>
                    <p className="text-xs text-gray-500">{feat.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Footer Content */}
      <div className="max-w-7xl mx-auto px-4 py-10">
        {/* Delegate Recruitment CTA Banner */}
        <div className="mb-10">
          <Link
            href="/delegate"
            className="group flex items-center justify-between gap-4 p-5 md:p-6 rounded-2xl bg-gradient-to-l from-[#009345] to-[#007A38] text-white hover:shadow-xl hover:shadow-primary/20 transition-all"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                <Bike className="w-6 h-6 md:w-7 md:h-7" />
              </div>
              <div className="text-right">
                <p className="text-base md:text-lg font-bold">انضم كمندوب توصيل</p>
                <p className="text-xs md:text-sm text-white/85">
                  ساعات مرنة، دخل أسبوعي ثابت، وخصومات حصرية
                </p>
              </div>
            </div>
            <span className="hidden md:inline-flex items-center gap-1 bg-white text-primary font-bold px-4 py-2 rounded-lg group-hover:bg-gray-100 transition-colors text-sm">
              سجّل الحين
              <ChevronDown className="w-4 h-4 -rotate-90" />
            </span>
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Logo & About */}
          <div className="lg:col-span-1">
            <Link href="/" className="inline-flex items-center mb-4">
              <CityMarketsLogo height={40} />
            </Link>
            <p className="text-gray-600 text-sm leading-relaxed mb-4">
              وجهتك الأولى للتسوق الذكي في الرياض. نوفر لك أكثر من 4000 منتج بجودة عالية وأسعار منافسة مع خدمة توصيل سريعة.
            </p>
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-primary" />
              <span className="text-sm text-gray-500">الرياض، المملكة العربية السعودية</span>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <Phone className="w-4 h-4 text-primary" />
              <a href={`tel:${STORE_PHONE_E164}`} className="text-sm text-gray-700 hover:text-primary transition-colors">
                {STORE_PHONE_DISPLAY}
              </a>
            </div>
            <div className="flex items-center gap-2 mb-6">
              <Mail className="w-4 h-4 text-primary" />
              <a href="mailto:info@citymarkets.sa" className="text-sm text-gray-700 hover:text-primary transition-colors">
                info@citymarkets.sa
              </a>
            </div>

            {/* Social Links (URLs from central SOCIAL_LINKS, icons mapped by platform) */}
            <div className="flex items-center gap-3">
              {SOCIAL_LINKS.map((social) => (
                <a
                  key={social.platform}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-xl bg-gray-100 hover:bg-primary hover:text-white flex items-center justify-center text-gray-500 transition-all duration-200"
                  aria-label={social.label}
                >
                  {SOCIAL_ICONS[social.platform]}
                </a>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-primary rounded-full" />
              روابط سريعة
            </h3>
            <ul className="space-y-2">
              {QUICK_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-gray-600 hover:text-primary transition-colors text-sm flex items-center gap-2"
                  >
                    <span className="w-1 h-1 bg-gray-300 rounded-full" />
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Information Links */}
          <div>
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-primary rounded-full" />
              معلومات
            </h3>
            <ul className="space-y-2">
              {INFO_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-gray-600 hover:text-primary transition-colors text-sm flex items-center gap-2"
                  >
                    <span className="w-1 h-1 bg-gray-300 rounded-full" />
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact & Newsletter */}
          <div>
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-primary rounded-full" />
              تواصل معنا
            </h3>

            {/* WhatsApp Button (direct chat with call center) */}
            <a
              href={WHATSAPP_CHAT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 w-full p-4 rounded-2xl bg-green-500 text-white font-semibold hover:bg-green-600 transition-colors mb-6 shadow-lg shadow-green-500/25"
            >
              <MessageCircle className="w-6 h-6" />
              <div className="text-right">
                <span className="block text-sm">تواصل واتساب</span>
                <span className="block text-xs opacity-80">رد خلال دقائق</span>
              </div>
            </a>

            {/* Working Hours */}
            <div className="p-4 rounded-2xl bg-gray-50">
              <h4 className="font-semibold text-gray-900 mb-2 text-sm">ساعات العمل</h4>
              <div className="space-y-1 text-sm text-gray-600">
                <div className="flex justify-between">
                  <span>السبت - الخميس</span>
                  <span className="font-medium">6 ص - 12 م</span>
                </div>
                <div className="flex justify-between">
                  <span>الجمعة</span>
                  <span className="font-medium">1 م - 12 م</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Accordion */}
      <div className="lg:hidden max-w-7xl mx-auto px-4">
        <div className="border-t border-gray-200 py-4">
          <AccordionItem title="روابط سريعة">
            <ul className="space-y-2">
              {QUICK_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-gray-600 hover:text-primary transition-colors text-sm">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </AccordionItem>
          <AccordionItem title="معلومات">
            <ul className="space-y-2">
              {INFO_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-gray-600 hover:text-primary transition-colors text-sm">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </AccordionItem>
          <div className="py-3">
            <Link
              href="/delegate"
              className="flex items-center justify-center gap-2 w-full p-3 rounded-xl bg-gradient-to-l from-[#009345] to-[#007A38] text-white font-bold text-sm hover:shadow-lg transition-shadow"
            >
              <Bike className="w-4 h-4" />
              <span>سجّل كمندوب توصيل</span>
            </Link>
          </div>
          <AccordionItem title="تواصل معنا">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Phone className="w-4 h-4 text-primary" />
                <a href={`tel:${STORE_PHONE_E164}`}>{STORE_PHONE_DISPLAY}</a>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Mail className="w-4 h-4 text-primary" />
                <a href="mailto:info@citymarkets.sa">info@citymarkets.sa</a>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <MapPin className="w-4 h-4 text-primary" />
                <span>الرياض، السعودية</span>
              </div>
            </div>
          </AccordionItem>
        </div>
      </div>

      {/* Copyright Bar */}
      <div className="bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-center md:text-right">
              <p className="text-gray-400 text-sm">
                © {currentYear} أسواق سيتي المركزية — جميع الحقوق محفوظة
              </p>
            </div>
            <div className="flex items-center gap-6">
              {/* App Store Download */}
              <a
                href="https://apps.apple.com/sa/app/%D8%A3%D8%B3%D9%88%D8%A7%D9%82-%D8%B3%D9%8A%D8%AA%D9%8A/id6799888123?l=ar"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="حمّل تطبيق أسواق سيتي من App Store"
                className="inline-flex items-center gap-2 bg-white text-black px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25" />
                </svg>
                <span className="flex flex-col items-start leading-tight">
                  <span className="text-[9px] opacity-80">حمّله من</span>
                  <span className="text-xs font-bold -mt-0.5">App Store</span>
                </span>
              </a>
              {/* Payment Methods */}
              <div className="flex items-center gap-2">
                {[
                  { src: "/images/partners/visa-circle.svg", alt: "Visa" },
                  { src: "/images/partners/mastercard-circle.svg", alt: "Mastercard" },
                  { src: "/images/partners/mada.svg", alt: "Mada" },
                  { src: "/images/partners/apple_pay.svg", alt: "Apple Pay" },
                  { src: "/images/partners/tamara2.svg", alt: "Tamara" },
                ].map((m) => (
                  <Image
                    key={m.alt}
                    src={m.src}
                    alt={m.alt}
                    width={38}
                    height={24}
                    className="h-6 w-auto opacity-70"
                    // Footer payment icons are below the fold — never
                    // the LCP. loading="lazy" avoids competing with the
                    // banner image for early bandwidth. (2026-08-17
                    // PageSpeed fix.)
                    loading="lazy"
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="text-center mt-4 pb-20">
            <a
              href="https://tharwah.shop/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-gray-500 text-xs hover:text-primary-400 transition-colors"
            >
              صنع بـ
              <span className="text-red-400">❤</span>
              بواسطة :
              <span className="font-bold text-gray-400">منصة ثروة</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
