// Single source of truth for vendor_type / vendor identity constants.
// Imported by both the admin UI and the admin/vendor API routes so a
// future change here propagates without drift.

export const VENDOR_TYPES = [
  // Legacy / core categories (kept for backwards compatibility with rows
  // that already exist in `vendors.vendor_type`).
  "food_beverage",
  "fashion",
  "gifts",
  "electronics",
  "services",
  // Extended categories added by 063_admin_vendor_phone_and_more_types.sql
  "grocery_supermarket",
  "restaurant_cafe",
  "sweets_bakery",
  "pharmacy_health",
  "beauty_cosmetics",
  "flowers_plants",
  "books_stationery",
  "sports_fitness",
  // Extra electronics-adjacent verticals added by
  // 068_more_vendor_types.sql — these were missing from the original
  // 13-category list and operators selling home appliances / jewelry
  // / cars / etc. had to map onto "electronics" or "gifts" which
  // confused the storefront filter.
  "home_appliances",
  "furniture_home",
  "jewelry_watches",
  "cars_auto",
  "pets_animals",
  "kids_babies",
  "music_instruments",
  "tools_industrial",
  "travel_tourism",
  "real_estate",
] as const;

export type VendorType = (typeof VENDOR_TYPES)[number];

export const VENDOR_TYPE_LABELS_AR: Record<VendorType, string> = {
  food_beverage: "طعام ومشروبات",
  fashion: "أزياء",
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
  pets_animals: "حيوانات أليفة ومستلزماتها",
  kids_babies: "أطفال ورُضع",
  music_instruments: "موسيقى وآلات",
  tools_industrial: "عدد ومستلزمات صناعية",
  travel_tourism: "سفر وسياحة",
  real_estate: "عقارات",
};

export function isVendorType(value: unknown): value is VendorType {
  return (
    typeof value === "string" &&
    (VENDOR_TYPES as readonly string[]).includes(value)
  );
}

// Hex color (#RGB or #RRGGBB). Anything else is rejected so we never
// write garbage / CSS-injection vectors into a column rendered as
// inline style.
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Either a local /images/ or /uploads/ path (already gated by the
// upload route's folder allowlist) or an absolute https URL on an
// approved image host. Tightening this stops an attacker from pointing
// `logo_url` at javascript: / data: URIs or at tracking pixels on a
// hostile origin.
//
// SECURITY: same-origin /uploads/ is safe because the upload route
// writes only into /images/{allowlist}/ and /uploads/{allowlist}/; a
// hostile admin cannot inject an arbitrary path. The public CDN
// (cdn.citymarkets.sa) and the app's own domain (citymarkets.sa /
// www.citymarkets.sa) cover the local fallback absolute URLs the
// uploader returns when R2 is down.
const ALLOWED_LOGO_HOSTS = [
  "images.unsplash.com",
  "cdn.citymarkets.sa",
  "res.cloudinary.com",
  "citymarkets.sa",
  "www.citymarkets.sa",
];

const ALLOWED_LOCAL_PREFIXES = ["/images/", "/uploads/"];

export function isAllowedImageUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (ALLOWED_LOCAL_PREFIXES.some((p) => v.startsWith(p))) return true;
  if (!/^https:\/\//i.test(v)) return false;
  try {
    const u = new URL(v);
    return ALLOWED_LOGO_HOSTS.some(
      (h) => u.hostname === h || u.hostname.endsWith(`.${h}`)
    );
  } catch {
    return false;
  }
}

export const HEX_COLOR_RE = HEX_COLOR;
