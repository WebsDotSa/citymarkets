export type AddressLabelType = "home" | "work" | "rest" | "other";

export type DeliveryAddress = {
  id: string;
  label: string;
  labelType: AddressLabelType;
  lat: number;
  lng: number;
  address_text: string;
  description?: string;
  place_images?: string[];
  is_default: boolean;
};

export const ADDRESS_LABELS: {
  type: AddressLabelType;
  label: string;
  icon: string;
}[] = [
  { type: "home", label: "المنزل", icon: "🏠" },
  { type: "work", label: "العمل", icon: "🏢" },
  { type: "rest", label: "الاستراحة", icon: "☕" },
  { type: "other", label: "تصنيف آخر", icon: "✏️" },
];

export const GUEST_KEY_STORAGE = "city_market_guest_key";
export const ADDRESSES_STORAGE = "city_market_delivery_addresses";
export const SELECTED_ADDRESS_STORAGE = "city_market_selected_address_id";

/** Default center: Riyadh */
export const DEFAULT_MAP_CENTER = { lat: 24.7136, lng: 46.6753 };

/** Server-backed address id (not a browser-only local_* fallback). */
export function isPersistedAddressId(id: string | null | undefined): boolean {
  if (!id || id.startsWith("local_")) return false;
  // UUID format (8-4-4-4-12 hex) or numeric (legacy) — anything server-issued
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    || /^\d+$/.test(id);
}

export function getOrCreateGuestKey(): string {
  if (typeof window === "undefined") return "";
  let key = localStorage.getItem(GUEST_KEY_STORAGE);
  if (!key) {
    key =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `guest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(GUEST_KEY_STORAGE, key);
  }
  return key;
}

export function loadLocalAddresses(): DeliveryAddress[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ADDRESSES_STORAGE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalAddresses(addresses: DeliveryAddress[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ADDRESSES_STORAGE, JSON.stringify(addresses));
}

export function getSelectedAddressId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SELECTED_ADDRESS_STORAGE);
}

export function setSelectedAddressId(id: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SELECTED_ADDRESS_STORAGE, id);
}

export function shortAddressLabel(address: DeliveryAddress | null): string {
  if (!address) return "تحديد الموقع";
  const text = address.address_text.trim();
  if (text.length <= 28) return text;
  return `${text.slice(0, 26)}…`;
}
