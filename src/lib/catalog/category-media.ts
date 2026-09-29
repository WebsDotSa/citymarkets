/** Material icon keys stored in icon_url vs real image paths */
const ICON_MAP: Record<string, string> = {
  local_grocery_store: "🛒",
  coffee: "☕",
  kitchen: "🍵",
  icecream: "🍦",
  egg_alt: "🥚",
  set_meal: "🥫",
  category: "📦",
  local_drink: "🥤",
  restaurant: "🍞",
  milk: "🥛",
  local_pizza: "🍕",
  fastfood: "🍔",
  poultry: "🍗",
  grass: "🥬",
  eco: "🍎",
  ac_unit: "🧊",
  water_drop: "💧",
  breakfast_dining: "🥣",
  bakery_dining: "🥐",
  cookie: "🍪",
  apps: "🍜",
  nutrition: "🥫",
};

export function isCategoryImageUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("/")) {
    return true;
  }
  return /\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i.test(v);
}

export function getCategoryEmoji(
  iconUrl: string | null | undefined,
  fallback = "📦"
): string {
  if (!iconUrl || isCategoryImageUrl(iconUrl)) return fallback;
  return ICON_MAP[iconUrl] || fallback;
}

export function resolveCategoryImageSrc(
  iconUrl: string | null | undefined
): string | null {
  if (!iconUrl || !isCategoryImageUrl(iconUrl)) return null;
  return iconUrl;
}
