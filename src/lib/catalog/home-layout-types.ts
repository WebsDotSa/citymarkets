/**
 * Home layout — shared contract between admin UI, validation, public API,
 * and the dynamic renderer.
 *
 * Each `Section` is `{ id, type, visible, settings }`. The settings shape
 * varies per type (see the discriminated union below). The admin form and
 * the renderer both consume this contract, so changes here ripple through
 * to both ends.
 */

export type DeviceType = "mobile" | "desktop";

export const DEVICE_TYPES: DeviceType[] = ["mobile", "desktop"];

export const DEFAULT_DEVICE: DeviceType = "mobile";

/** Discriminated union of every section type the home layout supports. */
export type SectionType =
  | "hero_banner"
  | "banners"
  | "categories"
  | "products"
  | "offers_grid"
  | "offers_strip"
  | "lightning_deals"
  | "category_section"
  | "stores"
  | "coupons"
  | "html_block"
  | "cta";

export const SECTION_TYPES: SectionType[] = [
  "hero_banner",
  "banners",
  "categories",
  "products",
  "offers_grid",
  "offers_strip",
  "lightning_deals",
  "category_section",
  "stores",
  "coupons",
  "html_block",
  "cta",
];

// ─── Per-type settings ─────────────────────────────────────────────

/** A single inline banner item used by `banners` and `offers_strip`. */
export interface InlineBannerItem {
  id?: string;
  image_url: string;
  title_ar?: string;
  subtitle_ar?: string;
  link_type: "none" | "product" | "category" | "external" | "vendor";
  link_value?: string | null;
  /** Optional override for the "عروض برق" / countdown timer display. */
  ends_at?: string | null;
  /** Optional discount label to render on the banner. */
  discount_label?: string | null;
}

export interface HeroBannerSettings {
  title_ar?: string;
  subtitle_ar?: string;
  image_url?: string;
  show_search?: boolean;
  show_location?: boolean;
  background_color?: string;
}

export type BannersLayout = "carousel" | "grid_2" | "grid_3" | "tall" | "wide";

export interface BannersSettings {
  layout: BannersLayout;
  aspect_ratio?: string; // e.g. "16/9", "21/9", "3/4"
  height?: number; // px override when aspect_ratio isn't enough
  auto_play?: boolean;
  show_dots?: boolean;
  banners: InlineBannerItem[];
}

export interface CategoriesSettings {
  title?: string;
  columns: number; // 3-8
  root_only?: boolean;
  max_items?: number;
  background_color?: string;
  show_icons?: boolean;
}

export type ProductSource = "featured" | "best_selling" | "on_offer" | "new" | "custom";

export interface ProductsSettings {
  title: string;
  subtitle?: string;
  source: ProductSource;
  product_ids?: string[];
  category_id?: string | null;
  limit: number;
  display: "grid" | "carousel";
  columns?: number;
  background_color?: string;
  header_icon?: string;
  cta_text?: string;
  cta_link?: string;
  show_prices?: boolean;
}

export interface OffersGridSettings extends Omit<ProductsSettings, "source"> {
  source: "featured_offers";
  /** Optional filter to a specific offer list (used when source = custom). */
  offer_ids?: string[];
}

export interface OffersStripSettings {
  title: string;
  subtitle?: string;
  /** Distinct from ProductsSettings — here banners carry the offer UI. */
  banners: InlineBannerItem[];
  background_color?: string;
  text_color?: string;
  countdown_enabled?: boolean;
  auto_play?: boolean;
}

export interface LightningDealsSettings {
  title: string;
  subtitle?: string;
  background_color?: string;
  header_color?: string;
  border_color?: string;
  footer_text?: string;
  footer_link?: string;
  ends_at: string; // ISO timestamp for the countdown
  product_source: "on_offer" | "custom";
  product_ids?: string[];
  limit?: number;
  show_countdown?: boolean;
}

export interface CategorySectionSettings {
  category_id: string;
  title_override?: string;
  subtitle_override?: string;
  background_color?: string;
  layout: "grid" | "list";
  limit?: number;
  show_prices?: boolean;
}

export interface StoresSettings {
  title: string;
  subtitle?: string;
  limit?: number;
  featured_only?: boolean;
  display: "carousel" | "grid";
}

export interface CouponsSettings {
  title?: string;
  limit?: number;
  display: "strip" | "grid";
}

export interface HtmlBlockSettings {
  content_html: string;
  background_color?: string;
  text_color?: string;
  /** Admin-only — sanitized on render with DOMPurify. */
}

export interface CtaSettings {
  variant: "join" | "partner";
  title?: string;
  subtitle?: string;
  cta_text?: string;
  cta_href?: string;
  background_color?: string;
  text_color?: string;
}

/** Discriminated union of every supported section. */
export type Section =
  | { id: string; type: "hero_banner"; visible: boolean; settings: HeroBannerSettings }
  | { id: string; type: "banners"; visible: boolean; settings: BannersSettings }
  | { id: string; type: "categories"; visible: boolean; settings: CategoriesSettings }
  | { id: string; type: "products"; visible: boolean; settings: ProductsSettings }
  | { id: string; type: "offers_grid"; visible: boolean; settings: OffersGridSettings }
  | { id: string; type: "offers_strip"; visible: boolean; settings: OffersStripSettings }
  | { id: string; type: "lightning_deals"; visible: boolean; settings: LightningDealsSettings }
  | { id: string; type: "category_section"; visible: boolean; settings: CategorySectionSettings }
  | { id: string; type: "stores"; visible: boolean; settings: StoresSettings }
  | { id: string; type: "coupons"; visible: boolean; settings: CouponsSettings }
  | { id: string; type: "html_block"; visible: boolean; settings: HtmlBlockSettings }
  | { id: string; type: "cta"; visible: boolean; settings: CtaSettings };

/** Library entry used by the admin palette to render the "+ section" picker. */
export interface SectionLibraryEntry {
  type: SectionType;
  label: string;
  description: string;
  icon: string; // lucide-react icon name
  /** Sensible defaults inserted into a new section of this type. */
  defaultSettings: Section["settings"];
}

export const SECTION_LIBRARY: SectionLibraryEntry[] = [
  {
    type: "hero_banner",
    label: "هيرو علوي",
    description: "بانر كبير مع بحث وموقع في الأعلى",
    icon: "ImageIcon",
    defaultSettings: {
      title_ar: "مرحباً بك",
      subtitle_ar: "اطلب احتياجاتك اليومية",
      show_search: true,
      show_location: true,
      background_color: "#f8fafc",
    },
  },
  {
    type: "banners",
    label: "بنرات",
    description: "بنرات متعددة — كاروسيل أو شبكة أو عمودي",
    icon: "Images",
    defaultSettings: {
      layout: "carousel",
      aspect_ratio: "16/9",
      auto_play: true,
      show_dots: true,
      banners: [],
    },
  },
  {
    type: "categories",
    label: "فئات سريعة",
    description: "شبكة فئات بأيقونات",
    icon: "Grid3x3",
    defaultSettings: {
      title: "تسوق حسب الفئة",
      columns: 4,
      root_only: true,
      max_items: 8,
      show_icons: true,
    },
  },
  {
    type: "products",
    label: "منتجات",
    description: "شبكة أو كاروسيل منتجات حسب المصدر",
    icon: "Package",
    defaultSettings: {
      title: "منتجات مميزة",
      subtitle: "اختيارنا المميز لك",
      source: "featured",
      limit: 8,
      display: "carousel",
      columns: 4,
      background_color: "#ffffff",
      show_prices: true,
    },
  },
  {
    type: "offers_grid",
    label: "عروض حصرية",
    description: "شبكة عروض مميزة (مثل عروض اليوم)",
    icon: "Sparkles",
    defaultSettings: {
      title: "عروض حصرية",
      subtitle: "خصومات لا تفوتك",
      source: "featured_offers",
      limit: 6,
      display: "grid",
      columns: 3,
      background_color: "#fff7ed",
    },
  },
  {
    type: "offers_strip",
    label: "بنرات عروض (لا يفوتك)",
    description: "شريط بنرات عروض أفقي مع عداد",
    icon: "Flame",
    defaultSettings: {
      title: "لا يفوتك",
      subtitle: "أقوى العروض اليوم",
      banners: [],
      background_color: "#7c2d12",
      text_color: "#ffffff",
      countdown_enabled: true,
      auto_play: false,
    },
  },
  {
    type: "lightning_deals",
    label: "عروض برق",
    description: "قسم بعدّاد زمني ولون خلفية مميز",
    icon: "Zap",
    defaultSettings: {
      title: "عروض برق ⚡",
      subtitle: "ينتهي خلال",
      background_color: "#fef3c7",
      header_color: "#92400e",
      border_color: "#fbbf24",
      footer_text: "عرض الكل",
      footer_link: "/offers",
      ends_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      product_source: "on_offer",
      limit: 6,
      show_countdown: true,
    },
  },
  {
    type: "category_section",
    label: "قسم فئة",
    description: "قسم كامل لمنتجات فئة واحدة",
    icon: "FolderTree",
    defaultSettings: {
      category_id: "",
      title_override: "",
      layout: "grid",
      limit: 8,
      show_prices: true,
    },
  },
  {
    type: "stores",
    label: "متاجر مميزة",
    description: "كاروسيل المتاجر (مثل قهوة/هدايا)",
    icon: "Store",
    defaultSettings: {
      title: "متاجر مميزة",
      subtitle: "اكتشف متاجرنا",
      limit: 8,
      featured_only: true,
      display: "carousel",
    },
  },
  {
    type: "coupons",
    label: "كوبونات",
    description: "شريط كوبونات الخصم",
    icon: "TicketPercent",
    defaultSettings: {
      title: "كوبونات حصرية",
      limit: 6,
      display: "strip",
    },
  },
  {
    type: "html_block",
    label: "نص/HTML حر",
    description: "بلوك نصي مخصص (إعلانات/إرشادات)",
    icon: "FileText",
    defaultSettings: {
      content_html: "<p>محتوى مخصص</p>",
      background_color: "#f1f5f9",
      text_color: "#0f172a",
    },
  },
  {
    type: "cta",
    label: "دعوة لاتخاذ إجراء",
    description: "CTA تسجيل أو انضمام كشريك",
    icon: "Megaphone",
    defaultSettings: {
      variant: "join",
      title: "انضم إلينا",
      subtitle: "احصل على خصم 10%",
      cta_text: "سجل الآن",
      cta_href: "/auth/login",
      background_color: "#0f172a",
      text_color: "#ffffff",
    },
  },
];

/** Lookup helper: returns the library entry for a given type. */
export function getLibraryEntry(type: SectionType): SectionLibraryEntry | undefined {
  return SECTION_LIBRARY.find((entry) => entry.type === type);
}

/**
 * Generates a new section with the library defaults plus a fresh id.
 * Used by the admin UI's "+ section" buttons.
 */
export function makeDefaultSection(type: SectionType): Section {
  const entry = getLibraryEntry(type);
  if (!entry) {
    throw new Error(`Unknown section type: ${type}`);
  }
  // The defaultSettings shape varies per type but TS can't narrow here.
  // We cast because the library guarantees the shape for its type.
  return {
    id: cryptoRandomId(),
    type,
    visible: true,
    settings: structuredClone(entry.defaultSettings) as Section["settings"],
  } as Section;
}

function cryptoRandomId(): string {
  // Web Crypto in browsers; node:crypto.webcrypto in Node 18+; fallback for older.
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Shape stored on the DB row. */
export interface HomeLayout {
  id: string;
  device_type: DeviceType;
  name: string;
  sections: Section[];
  is_active: boolean;
  updated_at: string;
  created_at: string;
}

/** Public API response payload (lighter than the admin payload). */
export interface PublicHomeLayout {
  device_type: DeviceType;
  sections: Section[];
  version: string;
  updated_at: string;
}

/** Bump when the Section contract changes in a backward-incompatible way. */
export const HOME_LAYOUT_VERSION = "v1";