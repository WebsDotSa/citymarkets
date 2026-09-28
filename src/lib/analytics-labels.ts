/**
 * Arabic labels for analytics-driven UI.
 *
 * Centralised so admin analytics, vendor analytics, and any future
 * data layer can share the same Arabic copy. Everything is pure data —
 * no React, no DB. Safe to import from server components and route
 * handlers.
 */

/** Vendor types declared in `vendors.vendor_type` CHECK constraint.
 *  Mirrors `VENDOR_TYPE_LABELS_AR` from `@/lib/vendors`. */
export const VENDOR_TYPE_AR: Record<string, string> = {
  food_beverage: "مطاعم ومقاهي",
  fashion: "أزياء وعبايات",
  gifts: "هدايا",
  electronics: "إلكترونيات",
  services: "خدمات",
  grocery_supermarket: "بقالة وسوبرماركت",
  restaurant_cafe: "مطاعم وكافيهات",
  sweets_bakery: "حلويات ومعجنات",
  pharmacy_health: "صيدلية ومستلزمات صحية",
  beauty_cosmetics: "تجميل وعطور",
  flowers_plants: "ورد ونباتات",
  books_stationery: "كتب وقرطاسية",
  sports_fitness: "رياضة ولياقة",
  home_appliances: "أجهزة منزلية",
  furniture_home: "أثاث وديكور منزل",
  jewelry_watches: "مجوهرات وساعات",
  cars_auto: "سيارات ومستلزمات",
  pets_animals: "حيوانات أليفة",
  kids_babies: "أطفال ورُضع",
  music_instruments: "موسيقى وآلات",
  tools_industrial: "عدد ومستلزمات صناعية",
  travel_tourism: "سفر وسياحة",
  real_estate: "عقارات",
};

/** Vendor type options for the analytics filter dropdown. */
export const VENDOR_TYPE_FILTER: Array<{ value: string; label: string }> = [
  { value: "", label: "كل المتاجر" },
  ...Object.entries(VENDOR_TYPE_AR).map(([value, label]) => ({ value, label })),
];

/** Event names recorded in `analytics_events`. */
export const EVENT_NAME_AR: Record<string, string> = {
  add_to_cart: "إضافة إلى السلة",
  remove_from_cart: "إزالة من السلة",
  checkout_start: "بدء السداد",
  purchase: "إتمام الطلب",
  search: "بحث",
  signup: "تسجيل جديد",
  view_item: "مشاهدة منتج",
  begin_checkout: "بدء السداد",
  page_view: "زيارة صفحة",
};

/** Top-level tabs on the admin analytics page. */
export const ANALYTICS_TABS: Array<{ value: string; label: string }> = [
  { value: "overview", label: "نظرة عامة" },
  { value: "visitors", label: "الزوار" },
  { value: "orders", label: "الطلبات" },
  { value: "products", label: "المنتجات" },
];

/** Top-level metric labels (used by both analytics + vendor analytics). */
export const METRIC_LABELS = {
  revenue: "الإيرادات",
  orders: "الطلبات",
  averageOrder: "متوسط قيمة الطلب",
  visitors: "زائرون فريدون",
  pageViews: "مشاهدات الصفحات",
  conversion: "نسبة التحويل",
  paidAny: "مدفوعة (كل الطرق)",
  cancelled: "ملغاة",
  aov: "متوسط السلة",
  pending: "قيد الانتظار",
  uniqueSessions: "جلسات فريدة",
  topCountry: "أعلى دولة",
  pagesPerSession: "صفحات / جلسة",
  mobile: "محمول",
  desktop: "سطح مكتب",
  tablet: "لوحي",
  bot: "بوتات",
} as const;

/** Country code → Arabic display name (lightweight, top countries only). */
export const COUNTRY_AR: Record<string, string> = {
  SA: "السعودية",
  AE: "الإمارات",
  KW: "الكويت",
  BH: "البحرين",
  QA: "قطر",
  OM: "عُمان",
  EG: "مصر",
  JO: "الأردن",
  LB: "لبنان",
  IQ: "العراق",
  YE: "اليمن",
  US: "الولايات المتحدة",
  GB: "المملكة المتحدة",
  IN: "الهند",
  PK: "باكستان",
  PH: "الفلبين",
};

/** Returns an Arabic label for a vendor type, falling back to the slug. */
export function getVendorTypeAr(slug: string | null | undefined): string {
  if (!slug) return "—";
  return VENDOR_TYPE_AR[slug] ?? slug;
}

/** Returns an Arabic label for an event name, falling back to the slug. */
export function getEventNameAr(name: string | null | undefined): string {
  if (!name) return "—";
  return EVENT_NAME_AR[name] ?? name;
}

/** Returns an Arabic label for a country code, falling back to the code. */
export function getCountryAr(code: string | null | undefined): string {
  if (!code) return "غير محدد";
  return COUNTRY_AR[code.toUpperCase()] ?? code.toUpperCase();
}
