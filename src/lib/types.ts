// Types for City Markets application

export type User = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  loyalty_points: number;
  loyalty_tier: "bronze" | "silver" | "gold" | "platinum";
  spin_count_today: number;
  last_spin_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Address = {
  id: string;
  user_id: string;
  label: string;
  lat: number;
  lng: number;
  address_text: string;
  is_default: boolean;
  created_at: string;
  // Optional fields populated by the delivery-addresses endpoint
  // (`/api/v1/delivery-addresses`) and by the iOS client. Web checkout
  // historically only read the required columns above.
  plus_code?: string | null;
  city?: string | null;
  district?: string | null;
  description?: string | null;
  title?: string | null;
  place_images?: string[];
};

/** Response shape returned by `/api/v1/coupons/validate`. Mirrors
 *  the server canonical coupon shape after the route has stripped
 *  out admin-only fields and computed any free-delivery discount. */
export type CouponValidateResult = {
  valid: boolean;
  discount?: number;
  message?: string;
  type?: "percentage" | "fixed" | "free_delivery";
  code?: string;
  error?: string;
};

/** Full blog-post row (detail view). The list view uses a stripped-down
 *  shape (`BlogPostList` below) since not every SELECT joins all columns.
 *  Optional fields are nullable or absent depending on the underlying query. */
export type BlogPost = {
  id: string;
  title_ar: string;
  title_en?: string | null;
  slug: string;
  excerpt_ar?: string | null;
  excerpt_en?: string | null;
  content_ar: string;
  content_en?: string | null;
  image_url?: string | null;
  category?: string | null;
  tags?: string[] | null;
  author_name?: string | null;
  published_at?: string | null;
  view_count: number;
  is_featured?: boolean;
  meta_title?: string | null;
  meta_description?: string | null;
};

/** Lean blog-post row used by the list endpoint + customer `/blog` page.
 *  Same row shape from `blog_posts` but with `content_ar` omitted — the
 *  detail route fetches the full body separately. */
export type BlogPostList = {
  id: string;
  title_ar: string;
  slug: string;
  excerpt_ar?: string | null;
  image_url?: string | null;
  category?: string | null;
  author_name?: string | null;
  published_at?: string | null;
  view_count?: number;
  is_featured?: boolean;
};

/** Spin-the-wheel prize + result row. Used by `/api/v1/spin` and the
 *  client-side `/spin` page. `SpinResponse` describes the prize
 *  redemption envelope that `/api/v1/spin` returns to the client; the
 *  DB row shape lives further down as `SpinResult`. */
export type SpinResponse = {
  success: boolean;
  prize?: {
    type: "points" | "coupon" | "free_item" | "none";
    value: number;
    label_ar: string;
    coupon_code?: string;
  };
  points_earned?: number;
  total_points?: number;
  message?: string;
  spin_count_today?: number;
};

/** Homepage hero "spin" data — combines available prizes + today's
 *  remaining spins in a single shape for the carousel card. */
export type SpinWheelData = {
  prizes: Array<{
    type: "points" | "coupon" | "free_item" | "none";
    value: number;
    label_ar: string;
  }>;
  spin_count_today: number;
};

/** Customer-facing vendor card. Distinct from `AdminVendor` (admin
 *  listing carries audit + lifecycle fields). */
export type VendorCard = {
  id: string;
  name_ar: string;
  slug: string;
  logo_url?: string | null;
  rating?: number | null;
  product_count?: number;
  city?: string | null;
  is_active?: boolean;
  description_ar?: string | null;
  banner_url?: string | null;
};

export type Category = {
  id: number | string;
  name_ar: string;
  name_en?: string | null;
  slug: string;
  icon_url: string | null;
  parent_id: number | string | null;
  description_ar?: string | null;
  description_en?: string | null;
  is_active?: boolean;
  product_count?: number;
  child_count?: number;
  descendant_count?: number;
  sort_order: number;
  parent_slug?: string | null;
  parent_name_ar?: string | null;
  children?: Category[];
};

// Flat row used by /api/v1/categories — same shape as Category, since the
// category tree is built from a flat API list.
export type CategoryRow = Category;

export type Product = {
  id: string;
  category_id: string;
  name_ar: string;
  name_en: string | null;
  /** Canonical SKU (vendor_products.sku). May be absent on legacy
   *  `products` rows that pre-date the multi-vendor migration. */
  sku?: string | null;
  /** Legacy barcode from the original `products` table. Populated on the
   *  unified view (migration 039c added `barcode` to vendor_products and
   *  039c re-pointed products_unified at the real columns). May still be
   *  null on rows that pre-date the migration; consumers should fall back
   *  to `sku` in that case. */
  barcode?: string | null;
  description: string | null;
  image_url: string | null;
  images: string[];
  price: number;
  discount_price: number | null;
  stock_qty: number;
  /** Unit label (e.g. "piece", "kg"). Populated on the unified view
   *  since migration 039b/039c. May still be null on legacy rows. */
  unit?: string;
  /** Featured flag. Replaced by `sort_order > 0` in the unified view. */
  is_featured?: boolean;
  is_active: boolean;
  category?: Category;
  // Extended fields from API JOINs
  category_name?: string;
  category_slug?: string;
  category_icon?: string | null;
  // Aggregated review stats from /api/v1/products LEFT JOIN on
  // product_reviews. Optional so older callers and unit tests that
  // build a Product literal directly still typecheck.
  avg_rating?: number;
  reviews_count?: number;
  // Vendor provenance (Slice 1 — multi-vendor marketplace). Populated by
  // /api/v1/products and /api/v1/products/[id] when the row originates
  // from `vendor_products`. NULL/missing means a legacy catalog row that
  // has not yet been backfilled — treat it as City Markets (see
  // `product-source.ts` for the canonical constant).
  //
  // The pair (id, vendor_id) is the canonical product identity going
  // forward; using `id` alone is only safe while `vendor_products`
  // backfilled the same UUIDs as `products` (migration 014). New vendor
  // products get fresh UUIDs, so callers that need to disambiguate must
  // key on both fields (cart, checkout, reviews).
  vendor_id?: string | null;
  vendor_slug?: string | null;
  vendor_name?: string | null;
  /** Sort order from `vendor_products.sort_order`. The unified list
   *  endpoint uses this as the "featured products" proxy. */
  sort_order?: number;
  /** "vendor_products" | "products" — tells the storefront which table
   *  the row originated from so we can render provenance UI. */
  source?: "vendor_products" | "products";
  /** Whether the vendor considers stock levels authoritative. When
   *  false, stock_qty may be informational only (e.g. fresh produce). */
  track_stock?: boolean;
  /** English description (vendor_products.description_en). */
  description_en?: string | null;
  created_at?: string;
  updated_at?: string;
  // ── Offers (Slice 5) ─────────────────────────────────────────────
  // When a product carries an active offer, the API populates these
  // fields. `effective_price` is the server-computed final price
  // (best of offer / discount_price / list). The storefront renders
  // badges, countdowns, and savings lines from these.
  /** Winning active offer for this product (or null). */
  active_offer?: ActiveOfferInfo | null;
  /** Pre-computed final price the customer pays. Falls back to the
   *  existing discount_price vs list logic when no offer applies. */
  effective_price?: number | null;
};

// Canonical vendor identity for the City Markets (legacy `products`-backed)
// catalog. UUID is fixed — migration 014 used the all-zeros UUID as the
// pseudo-vendor for the backfilled rows so the unified view could treat
// the existing catalog as just another vendor in `vendor_products`.
export const CITY_MARKETS_VENDOR_ID = "00000000-0000-0000-0000-000000000001";

export type CartItem = {
  product: Product;
  quantity: number;
  // Vendor identity attached at add-to-cart time so the cart survives a
  // product detail page unmount and so checkout can split mixed carts.
  // Optional on legacy carts that pre-date Slice 1/2 — treated as City
  // Markets by the cart context's normalization step.
  vendor_id?: string | null;
  vendor_slug?: string | null;
  vendor_name?: string | null;
};

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "shopping"
  | "on_the_way"
  | "delivered"
  | "cancelled";

export type OrderType = "catalog" | "direct";

export type Order = {
  id: string;
  user_id: string;
  address_id: string;
  status: OrderStatus;
  type: OrderType;
  subtotal: number;
  delivery_fee: number;
  service_fee: number;
  discount: number;
  total: number;
  driver_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  address?: Address;
  driver?: Driver;
  items?: OrderItem[];
};

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  qty: number;
  unit_price: number;
  notes: string | null;
  product?: Product;
};

export type DirectOrder = {
  id: string;
  order_id: string;
  text_note: string | null;
  voice_url: string | null;
  images: string[] | null;
  final_price: number | null;
};

export type Driver = {
  id: string;
  name: string;
  phone: string;
  status: "available" | "busy" | "offline";
  current_lat: number | null;
  current_lng: number | null;
  avatar_url: string | null;
};

export type Coupon = {
  id: string;
  code: string;
  type: "percentage" | "fixed" | "free_delivery";
  value: number;
  min_order: number | null;
  max_discount: number | null;
  max_uses: number | null;
  used_count: number;
  source: "spin" | "admin" | "event" | "referral";
  expires_at: string | null;
  used_at: string | null;
  is_active: boolean;
};

export type SpinResult = {
  id: string;
  user_id: string;
  result_type: "coupon" | "points" | "free_delivery" | "discount";
  result_value: number;
  coupon_id: string | null;
  spun_at: string;
  coupon?: Coupon;
};

export type LoyaltyTransaction = {
  id: string;
  user_id: string;
  points: number;
  type: "earn" | "redeem" | "adjust";
  ref_order_id: string | null;
  created_at: string;
};

export type HomeInventoryItem = {
  id: string;
  user_id: string;
  product_id: string;
  qty_approx: number;
  alert_when_low: boolean;
  added_at: string;
  product?: Product;
};

export type SavedList = {
  id: string;
  user_id: string;
  name: string;
  items: { product_id: string; qty: number }[];
  is_recurring: boolean;
  repeat_day: number | null;
  created_at: string;
  updated_at: string;
};

export type Notification = {
  id: string;
  user_id: string;
  title_ar: string;
  body_ar: string;
  type: "order" | "coupon" | "promotion" | "system";
  is_read: boolean;
  created_at: string;
};

export type Review = {
  id: string;
  product_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  is_approved: boolean;
  created_at: string;
  user_name?: string;
};

export type AISession = {
  id: string;
  user_id: string;
  messages: { role: string; content: string }[];
  context_type: "recipe" | "search" | "suggestion" | "general";
  products_suggested: string[];
  created_at: string;
};

// Spin wheel configuration
export type SpinPrize = {
  id: string;
  label: string;
  type: SpinResult["result_type"];
  value: number;
  weight: number; // probability weight
  color: string;
};

// ── Offers (Slice 5) ──────────────────────────────────────────────────
// Polymorphic-scope promotion entity. Each offer has one or more
// targets (product / category / vendor / "all") and a time-bound
// discount. The system resolves the winning offer per product via
// src/lib/offers.ts → resolveOfferPrice.

export type OfferTargetType = 'product' | 'category' | 'vendor' | 'all';

export type OfferDiscountType = 'percentage' | 'fixed';

export type Offer = {
  id: string;
  title_ar: string;
  title_en: string | null;
  description_ar: string | null;
  description_en: string | null;
  image_url: string;
  discount_type: OfferDiscountType;
  discount_value: number;
  max_discount: number | null;
  min_order: number | null;
  starts_at: string; // ISO
  ends_at: string;   // ISO
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
  applies_to: 'catalog' | 'vendor' | 'mixed';
  /** Hydrated by /api/v1/offers and admin endpoints. */
  targets?: OfferTarget[];
  /** Count of distinct products the offer resolves to (public endpoints). */
  product_count?: number;
  created_at: string;
  updated_at: string;
};

export type OfferTarget = {
  id: string;
  offer_id: string;
  target_type: OfferTargetType;
  target_id: string | null;
};

/**
 * Compact offer info attached to each product on read endpoints. The
 * storefront uses this to render badges and countdowns without an
 * extra round-trip to /api/v1/offers.
 */
export type ActiveOfferInfo = {
  offer_id: string;
  title_ar: string;
  discount_type: OfferDiscountType;
  discount_value: number;
  max_discount: number | null;
  min_order: number | null;
  starts_at: string;
  ends_at: string;
};

// Loyalty tier config
export const LOYALTY_TIERS = {
  bronze: { min: 0, name: "عادي", color: "#CD7F32" },
  silver: { min: 500, name: "فضي", color: "#C0C0C0" },
  gold: { min: 2000, name: "ذهبي", color: "#FFD700" },
  platinum: { min: 5000, name: "بلاتيني", color: "#E5E4E2" },
} as const;
