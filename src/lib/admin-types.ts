// Admin types and roles
import type { OrderPaymentStatus, OrderState } from '@/lib/orders/state-machine';

export type AdminRole = 'super_admin' | 'admin' | 'editor' | 'viewer' | 'delivery_driver';

// Re-export the canonical offer target type so admin form code can use
// `OfferTargetType` without depending on @/lib/types.
export type { OfferTargetType } from './types';

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  avatar?: string;
  phone?: string;
  created_at: string;
};

// -------- Domain types (forward-compatible admin data shapes) --------
//
// These mirror the columns returned by `/api/admin/*` JSON endpoints so
// admin pages don't have to fall back to `any[]`. Optional fields are
// nullable rather than `?` so consumers handle the "not yet loaded"
// case explicitly.

// Parent `orders.status` / `orders.payment_status` as returned by the admin
// API. Aliases of the canonical state machine (the previous local union
// listed `preparing`/`shipped`, which `order_status_enum` never contained).
export type AdminOrderStatus = OrderState;
export type AdminPaymentStatus = OrderPaymentStatus;

export type AdminOrderItem = {
  id: string;
  product_id: string;
  name_ar: string;
  unit_price: number;
  quantity: number;
  image_url?: string | null;
};

export type AdminOrder = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  status: AdminOrderStatus;
  payment_status: AdminPaymentStatus;
  payment_method: 'cash' | 'card' | 'wallet' | 'applepay' | 'stcpay' | string;
  subtotal: number;
  delivery_fee: number;
  service_fee: number;
  discount: number;
  total: number;
  address_text: string | null;
  notes: string | null;
  tracking_code: string | null;
  created_at: string;
  items?: AdminOrderItem[];
};

export type AdminProduct = {
  id: string;
  name_ar: string;
  name_en?: string | null;
  slug?: string;
  category_id: string | null;
  category_name?: string | null;
  price: number | string;
  discount_price: number | string | null;
  stock_qty: number | string;
  unit?: string | null;
  image_url: string | null;
  /** Additional product photos (edit form only). */
  images?: string[] | null;
  barcode?: string | null;
  description?: string | null;
  is_active: boolean;
  is_featured?: boolean;
  is_deal?: boolean;
  created_at?: string;
};

export type AdminBanner = {
  id: string;
  title: string;
  image_url: string;
  link_type: 'none' | 'category' | 'product' | 'external';
  link_value: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type AdminCoupon = {
  id: string;
  code: string;
  type: 'percentage' | 'fixed' | 'free_delivery';
  value: number;
  min_order: number | null;
  max_discount: number | null;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
};

// Slice 5 — Offers admin shape
export type AdminOffer = {
  id: string;
  title_ar: string;
  title_en: string | null;
  description_ar: string | null;
  description_en: string | null;
  image_url: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  max_discount: number | null;
  min_order: number | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
  applies_to: 'catalog' | 'vendor' | 'mixed';
  /** Per-scope count, populated by list endpoints. */
  target_summary?: {
    product: number;
    category: number;
    vendor: number;
    all: boolean;
  };
  targets?: AdminOfferTarget[];
  created_at: string;
  updated_at: string;
};

export type AdminOfferTarget = {
  id: string;
  offer_id: string;
  target_type: 'product' | 'category' | 'vendor' | 'all';
  target_id: string | null;
};

// -------- Pagination + list-row types --------

/** Standard `{ page, limit, total, totalPages }` envelope returned by every
 *  paginated list endpoint. Use this instead of redeclaring it inline. */
export type AdminPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

/** Category row as returned by /api/admin/categories (list + edit pages). */
export type AdminCategory = {
  id: string;
  name_ar: string;
  name_en?: string | null;
  slug: string;
  description_ar?: string | null;
  description_en?: string | null;
  image_url?: string | null;
  icon_url?: string | null;
  parent_id?: string | null;
  parent_name_ar?: string | null;
  sort_order?: number;
  is_active?: boolean;
  product_count: number;
  child_count: number;
  /** Resolved by the route after parent-fallback lookup. */
  effective_icon_url?: string | null;
  created_at?: string;
};

/** Abandoned-cart row returned by /api/admin/abandoned-carts. */
export type AdminAbandonedCart = {
  id: string;
  user_id: string | null;
  user_name?: string | null;
  user_phone?: string | null;
  guest_session_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  items_count: number;
  subtotal: number;
  items: unknown;
  intent_order_id: string | null;
  status: string;
  recovered_order_id: string | null;
  last_seen_at: string;
  created_at: string;
};

/** Notification row for the admin broadcast center + customer push log. */
export type AdminNotification = {
  id: string;
  title: string;
  body: string;
  image_url?: string | null;
  target_audience?: string;
  sent_count?: number;
  delivered_count?: number;
  opened_count?: number;
  status?: string;
  scheduled_at?: string | null;
  sent_at?: string | null;
  created_at: string;
};

/** In-app alert surfaced in the admin bell icon dropdown.
 *
 * Different from `AdminNotification` (broadcasts/push log) — alerts are
 * derived from system events (new orders, low stock, payments) and live
 * only inside the admin panel. */
export type AdminAlert = {
  id: string;
  type: "new_order" | "low_stock" | "out_of_stock" | "payment" | "system";
  title: string;
  message: string;
  link: string | null;
  severity: "info" | "warning" | "critical" | "success";
  created_at: string;
  is_read: boolean;
  meta?: Record<string, unknown>;
};

/** Direct-order (admin-only flow) row shape.
 *
 * Carries all fields used by the chat-hub list view AND the detail view
 * (the two views share the same DB row — the detail view just consumes
 * more of the nullable columns). Keeping a single shape means callers
 * never have to widen the type when navigating list → detail. */
export type AdminDirectOrder = {
  id: string;
  order_number?: string | null;
  status: string;
  /** 'direct' for chat-hub orders, anything else for the public flow. */
  type?: string;
  subtotal: number;
  delivery_fee: number;
  service_fee: number;
  tax: number;
  discount: number;
  total: number;
  payment_method: string;
  payment_status: string;
  notes?: string | null;
  internal_notes?: string | null;
  created_at: string;
  updated_at?: string;
  guest_name?: string | null;
  guest_phone?: string | null;
  user_name?: string | null;
  user_phone?: string | null;
  address_label?: string | null;
  address_text?: string | null;
  address_lat?: number | null;
  address_lng?: number | null;
  place_images?: string[];
  city?: string | null;
  district?: string | null;
  /** Unread chat messages for the active conversation. */
  unread_count: number;
  /** Cached item count for list rendering. */
  items_count: number;
};

/** Line-item inside a direct-order chat-hub payload. */
export type AdminDirectOrderItem = {
  id: string;
  product_id?: string | null;
  name_ar?: string | null;
  image_url?: string | null;
  free_text?: string | null;
  quantity: number;
  /** Per-unit price already set by the admin (or original product price). */
  unit_price: number;
  /** Original list price before admin override, if any. */
  price?: number | null;
  notes?: string | null;
  resolved_price?: number | null;
  resolved_at?: string | null;
};

/** Vendor summary used by admin listings + dashboards. */
export type AdminVendor = {
  id: string;
  name_ar: string;
  slug?: string;
  logo_url?: string | null;
  is_active?: boolean;
  rating?: number | null;
  product_count?: number;
  city?: string | null;
  created_at?: string;
};

// Role permissions
export const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  super_admin: [
    'view_dashboard',
    'manage_products',
    'manage_categories',
    'manage_orders',
    'manage_banners',
    'manage_users',
    'manage_coupons',
    'manage_offers',
    'manage_roles',
    'view_analytics',
    'view_payments',
    'manage_store_settings',
    'view_activity',
    'manage_reviews',
    'manage_blog',
    'manage_broadcasts',
    'manage_loyalty',
  ],
  admin: [
    'view_dashboard',
    'manage_products',
    'manage_categories',
    'manage_orders',
    'manage_banners',
    'manage_coupons',
    'manage_offers',
    'manage_users',
    'manage_roles',
    'view_analytics',
    'view_payments',
    'manage_store_settings',
    'view_activity',
    'manage_reviews',
    'manage_blog',
    'manage_broadcasts',
    'manage_loyalty',
  ],
  editor: [
    'view_dashboard',
    'manage_products',
    'manage_categories',
    'manage_banners',
  ],
  viewer: ['view_dashboard', 'view_analytics'],
  delivery_driver: [
    'view_delivery_orders',
    'view_customer_location',
    'update_delivery_status',
  ],
};

export const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'موظف عام',
  admin: 'موظف',
  editor: 'محرر',
  viewer: 'مشاهد',
  delivery_driver: 'مندوب توصيل',
};

export type NavItem = {
  id: string;
  label: string;
  icon: string;
  href: string;
  roles: AdminRole[];
  /** Must match a string in ROLE_PERMISSIONS[role] */
  permission: string;
  /** When true the sidebar renders this as a sub-item of the previous
   *  sibling (smaller font + extra indent + muted color). Used for
   *  "السلات المتروكة" → sub-link of "الطلبات". */
  sub?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'لوحة التحكم',
    icon: 'LayoutDashboard',
    href: '/admin',
    roles: ['super_admin', 'admin', 'editor', 'viewer'],
    permission: 'view_dashboard',
  },
  {
    id: 'products',
    label: 'المنتجات',
    icon: 'Package',
    href: '/admin/products',
    roles: ['super_admin', 'admin', 'editor'],
    permission: 'manage_products',
  },
  {
    id: 'categories',
    label: 'الفئات',
    icon: 'FolderTree',
    href: '/admin/categories',
    roles: ['super_admin', 'admin', 'editor'],
    permission: 'manage_categories',
  },
  {
    id: 'orders',
    label: 'الطلبات',
    icon: 'ShoppingBag',
    href: '/admin/orders',
    roles: ['super_admin', 'admin'],
    permission: 'manage_orders',
  },
  {
    id: 'abandoned-carts',
    label: 'السلات المتروكة',
    icon: 'ShoppingCart',
    href: '/admin/abandoned-carts',
    roles: ['super_admin', 'admin'],
    permission: 'manage_orders',
    sub: true,
  },
  {
    id: 'analytics',
    label: 'الإحصائيات',
    icon: 'BarChart3',
    href: '/admin/analytics',
    roles: ['super_admin', 'admin', 'viewer'],
    permission: 'view_analytics',
  },
  {
    id: 'vendors',
    label: 'المتاجر',
    icon: 'Building2',
    href: '/admin/vendors',
    roles: ['super_admin', 'admin'],
    permission: 'manage_store_settings',
  },
  {
    id: 'vendor-applications',
    label: 'طلبات فتح المتاجر',
    icon: 'FileSignature',
    href: '/admin/vendor-applications',
    roles: ['super_admin', 'admin'],
    permission: 'manage_store_settings',
  },
  {
    id: 'vendors-analytics',
    label: 'إحصائيات المتاجر',
    icon: 'BarChart3',
    href: '/admin/vendors/analytics',
    roles: ['super_admin', 'admin', 'viewer'],
    permission: 'view_analytics',
  },
  {
    id: 'payments',
    label: 'تقارير المدفوعات',
    icon: 'CreditCard',
    href: '/admin/payments',
    roles: ['super_admin', 'admin'],
    permission: 'view_payments',
  },
  {
    id: 'stores',
    label: 'الفروع والمخازن',
    icon: 'MapPin',
    href: '/admin/stores',
    roles: ['super_admin', 'admin'],
    permission: 'manage_store_settings',
  },
  {
    id: 'delivery-settings',
    label: 'إعدادات التوصيل',
    icon: 'Settings',
    href: '/admin/delivery-settings',
    roles: ['super_admin', 'admin'],
    permission: 'manage_store_settings',
  },
  {
    id: 'inventory',
    label: 'تنبيهات المخزون',
    icon: 'AlertTriangle',
    href: '/admin/inventory',
    roles: ['super_admin', 'admin', 'editor'],
    permission: 'manage_products',
  },
  {
    id: 'reviews',
    label: 'تقييمات العملاء',
    icon: 'Star',
    href: '/admin/reviews',
    roles: ['super_admin', 'admin'],
    permission: 'manage_orders',
  },
  {
    id: 'activity',
    label: 'سجل النشاط',
    icon: 'History',
    href: '/admin/activity',
    roles: ['super_admin', 'admin'],
    permission: 'view_activity',
  },
  {
    id: 'notifications',
    label: 'مركز الإشعارات',
    icon: 'BellRing',
    href: '/admin/notifications',
    roles: ['super_admin', 'admin', 'editor'],
    permission: 'view_dashboard',
  },
  {
    id: 'employment',
    label: 'طلبات التوظيف',
    icon: 'Briefcase',
    href: '/admin/employment',
    roles: ['super_admin', 'admin'],
    permission: 'manage_store_settings',
  },
  {
    id: 'notifications-settings',
    label: 'إعدادات الإشعارات',
    icon: 'Bell',
    href: '/admin/settings/notifications',
    roles: ['super_admin', 'admin'],
    permission: 'manage_store_settings',
  },
  {
    id: 'store-status',
    label: 'حالة الموقع (فتح/إغلاق)',
    icon: 'Power',
    href: '/admin/settings/store-status',
    roles: ['super_admin', 'admin'],
    permission: 'manage_store_settings',
  },
  {
    id: 'payment-settings',
    label: 'إعدادات الدفع',
    icon: 'Wallet',
    href: '/admin/settings/payments',
    roles: ['super_admin'],
    permission: 'manage_roles',
  },
  {
    id: 'home-design',
    label: 'تصميم الرئيسية',
    icon: 'LayoutTemplate',
    href: '/admin/home-design',
    roles: ['super_admin', 'admin', 'editor'],
    permission: 'manage_banners',
  },
  {
    id: 'coupons',
    label: 'كوبونات الخصم',
    icon: 'TicketPercent',
    href: '/admin/coupons',
    roles: ['super_admin', 'admin'],
    permission: 'manage_coupons',
  },
  {
    id: 'offers',
    label: 'العروض',
    icon: 'Sparkles',
    href: '/admin/offers',
    roles: ['super_admin', 'admin'],
    permission: 'manage_offers',
  },
  {
    id: 'loyalty',
    label: 'نقاط الولاء',
    icon: 'Award',
    href: '/admin/loyalty',
    roles: ['super_admin', 'admin'],
    permission: 'manage_loyalty',
  },
  {
    id: 'users',
    label: 'المستخدمين',
    icon: 'Users',
    href: '/admin/users',
    roles: ['super_admin', 'admin'],
    permission: 'manage_users',
  },
  {
    id: 'admins',
    label: 'الموظفين',
    icon: 'ShieldCheck',
    href: '/admin/settings/admins',
    roles: ['super_admin', 'admin'],
    permission: 'manage_roles',
  },
  {
    id: 'my-deliveries',
    label: 'طلباتي للتوصيل',
    icon: 'Truck',
    href: '/admin/driver',
    roles: ['delivery_driver'],
    permission: 'view_delivery_orders',
  },
  {
    id: 'admin-profile',
    label: 'حسابي',
    icon: 'UserCog',
    href: '/admin/settings/profile',
    roles: ['super_admin', 'admin', 'editor', 'viewer'],
    permission: 'view_dashboard',
  },
];
