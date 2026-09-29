/**
 * Public barrel for the Catalog bounded context.
 *
 * Phase 10.2 (domain-modules refactor): extracted from `src/lib/` root to
 * give products / categories / search / home-layout / vendor storefront /
 * AI shopping a clear home.
 *
 * Internal organization:
 *   - product-search.ts          — fuzzy product search (DB)
 *   - product-source.ts          — City Markets vendor + cart-key helpers
 *   - categories/tree.ts         — category tree builder
 *   - category-media.ts          — category image / emoji fallback
 *   - cart-vendors.ts            — group cart items by vendor
 *   - dynamic-category-groups.ts — dynamic home categories
 *   - offers.ts                  — product offer / discount resolution
 *   - vendors.ts                 — vendor type enum + label map
 *   - vendor-types.ts            — vendor type labels + icons (display)
 *   - vendor-product-mapper.ts   — vendor storefront → cart mapper
 *   - api.ts                     — public storefront fetch helpers
 *   - place-image.ts             — place image URL sanitizer
 *   - ai-shopping-assistant.ts   — server-side AI shopping (LLM + DB)
 *   - ai-chat-storage.ts         — localStorage helpers (browser)
 *   - ai-chat-client-types.ts    — chat message/result types (shared)
 *   - local-meal-assistant.ts    — browser-side AI shopping fallback
 *   - voice-order.ts             — Arabic voice transcript parser
 *   - home-layout-types.ts       — home page section types
 *   - home-layout-cache.ts       — cached fetch + invalidation
 *   - seo/product.ts             — product/category SEO rows (DB)
 *   - seo/sitemap-sources.ts     — sitemap entries for catalog content
 */

// ── Product search ──────────────────────────────────────────────────────
export {
  findProductForQuery,
  mapProductRow,
  matchProductsFromList,
} from "./product-search";
export type { MatchedProduct } from "./product-search";

// ── Product source helpers ──────────────────────────────────────────────
export {
  CITY_MARKETS_VENDOR_ID,
  isCityMarketsVendor,
  parseProductCartKey,
  productCartKey,
  vendorFieldsFromProduct,
} from "./product-source";

// ── Categories ──────────────────────────────────────────────────────────
export {
  buildCategoryTree,
  findCategory,
  getAncestors,
  getChildren,
  getSiblings,
} from "./categories/tree";
export type { CategoryTreeNode } from "./categories/tree";

// ── Category media ──────────────────────────────────────────────────────
export {
  getCategoryEmoji,
  isCategoryImageUrl,
  resolveCategoryImageSrc,
} from "./category-media";

// ── Cart vendors ────────────────────────────────────────────────────────
export {
  cartItemKey,
  computeGroupSubtotal,
  deriveVendorFromProduct,
  effectiveUnitPrice,
  groupCartItems,
  hasMixedVendors,
  lineSubtotal,
} from "./cart-vendors";
export type { CartGroups, CartItemVendorInfo, VendorGroup } from "./cart-vendors";

// ── Dynamic category groups ─────────────────────────────────────────────
export {
  buildDynamicGroups,
  emojiForCategoryName,
} from "./dynamic-category-groups";
export type { DynamicCategoryGroup } from "./dynamic-category-groups";

// ── Offers ──────────────────────────────────────────────────────────────
export {
  computeOfferEffectivePrice,
  filterOffersByScope,
  isOfferLive,
  resolveOfferPrice,
} from "./offers";
export type {
  OfferInput,
  OfferTargetInfo,
  ProductForOffer,
  ResolvedOffer,
  ResolvedOfferSource,
} from "./offers";

// ── Vendors (type enum + label map) ─────────────────────────────────────
export {
  HEX_COLOR_RE,
  VENDOR_TYPES,
  VENDOR_TYPE_LABELS_AR,
  isAllowedImageUrl,
  isVendorType,
} from "./vendors";
export type { VendorType } from "./vendors";

// ── Vendor types (display labels + icons) ───────────────────────────────
export {
  VENDOR_TYPE_ICONS,
  VENDOR_TYPE_LABELS,
  vendorTypeIcon,
  vendorTypeLabel,
} from "./vendor-types";

// ── Vendor product mapper ───────────────────────────────────────────────
export { vendorProductToCartProduct } from "./vendor-product-mapper";
export type {
  VendorMetadata,
  VendorStorefrontProductInput,
} from "./vendor-product-mapper";

// ── Public storefront API client ────────────────────────────────────────
export {
  apiFetch,
  getBanners,
  getCategories,
  getProduct,
  getProducts,
} from "./api";

// ── Place image ─────────────────────────────────────────────────────────
export {
  ALLOWED_PLACE_IMAGE_PREFIXES,
  isValidPlaceImageUrl,
  sanitizePlaceImageUrls,
} from "./place-image";

// ── AI shopping assistant (server) ──────────────────────────────────────
export { runShoppingAssistant } from "./ai-shopping-assistant";
export type {
  AiAssistantPayload,
  AiProductRequest,
  ChatTurn,
  MealIngredient,
  MealSuggestion,
} from "./ai-shopping-assistant";

// ── AI chat storage (browser) ───────────────────────────────────────────
export {
  AI_CHAT_WELCOME_ID,
  aiChatStorageKey,
  buildWelcomeMessage,
  clearChatLocalStorage,
  countPersistedMessages,
  fromStoredMessages,
  isPersistableMessage,
  loadChatFromLocalStorage,
  saveChatToLocalStorage,
  toStoredMessages,
} from "./ai-chat-storage";
export type { StoredChatMessage } from "./ai-chat-storage";

// ── AI chat shared types ────────────────────────────────────────────────
export type {
  ChatInputMode,
  ChatProductResult,
  MealIngredient as AiChatMealIngredient,
  MealSuggestion as AiChatMealSuggestion,
} from "./ai-chat-client-types";

// ── Local meal assistant (browser fallback) ─────────────────────────────
export { runLocalShoppingAssistant } from "./local-meal-assistant";

// ── Voice order ─────────────────────────────────────────────────────────
export {
  normalizeArabicDigits,
  parseVoiceTranscript,
  tokenizeProductQuery,
} from "./voice-order";
export type { ParsedVoiceLine } from "./voice-order";

// ── Home layout types ───────────────────────────────────────────────────
export {
  DEFAULT_DEVICE,
  DEVICE_TYPES,
  HOME_LAYOUT_VERSION,
  SECTION_LIBRARY,
  getLibraryEntry,
  makeDefaultSection,
} from "./home-layout-types";
export type {
  BannersLayout,
  BannersSettings,
  CategoriesSettings,
  CategorySectionSettings,
  CtaSettings,
  CouponsSettings,
  DeviceType,
  HeroBannerSettings,
  HtmlBlockSettings,
  InlineBannerItem,
  LightningDealsSettings,
  OffersGridSettings,
  OffersStripSettings,
  ProductSource,
  ProductsSettings,
  PublicHomeLayout,
  Section,
  SectionLibraryEntry,
  SectionType,
  StoresSettings,
} from "./home-layout-types";

// ── Home layout cache ───────────────────────────────────────────────────
export {
  getCachedHomeLayout,
  HOME_LAYOUT_CACHE_KEY,
  invalidateHomeLayout,
} from "./home-layout-cache";

// ── Catalog SEO ─────────────────────────────────────────────────────────
export {
  getCategoryByNameAr,
  getCategoryForSeo,
  getProductForSeo,
  productAltText,
  productDescription,
} from "./seo/product";
export type { CategorySeoRow, ProductSeoRow } from "./seo/product";

// ── Sitemap sources (catalog-driven) ────────────────────────────────────
export {
  buildFullSitemap,
  categorySitemapEntries,
  offerSitemapEntries,
  productSitemapEntries,
  staticSitemapEntries,
} from "./seo/sitemap-sources";
export type { SitemapEntry } from "./seo/sitemap-sources";
