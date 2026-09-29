/**
 * Vendor type → Arabic display label.
 * Source of truth: `vendor_type` CHECK constraint in `vendors` table
 * (migration 010_multi_vendor.sql — extended in
 *  063_admin_vendor_phone_and_more_types.sql and
 *  068_more_vendor_types.sql).
 */
export const VENDOR_TYPE_LABELS: Record<string, string> = {
  food_beverage: "مأكولات ومشروبات",
  fashion: "أزياء",
  gifts: "هدايا وورود",
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

export const VENDOR_TYPE_ICONS: Record<string, string> = {
  food_beverage: "☕",
  fashion: "👗",
  gifts: "🎁",
  electronics: "📱",
  services: "🛠️",
  grocery_supermarket: "🛒",
  restaurant_cafe: "🍽️",
  sweets_bakery: "🥐",
  pharmacy_health: "💊",
  beauty_cosmetics: "💄",
  flowers_plants: "🌹",
  books_stationery: "📚",
  sports_fitness: "🏋️",
  home_appliances: "🔌",
  furniture_home: "🛋️",
  jewelry_watches: "💍",
  cars_auto: "🚗",
  pets_animals: "🐾",
  kids_babies: "🍼",
  music_instruments: "🎸",
  tools_industrial: "🧰",
  travel_tourism: "✈️",
  real_estate: "🏠",
};

export function vendorTypeLabel(type: string): string {
  return VENDOR_TYPE_LABELS[type] ?? type;
}

export function vendorTypeIcon(type: string): string {
  return VENDOR_TYPE_ICONS[type] ?? "🏪";
}
