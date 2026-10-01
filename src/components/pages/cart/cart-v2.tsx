"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/contexts/cart-context";
import { useWishlistActions } from "@/contexts/wishlist-context";
import { useAuthState } from "@/contexts/auth-context";
import { useDeliveryLocationState, useDeliveryLocationActions } from "@/contexts/delivery-location-context";
import { useDeliveryQuote } from "@/hooks/use-delivery-quote";
import { Button } from "@/components/design/button";
import { EmptyCart } from "@/components/design/empty-state";
import { useToast } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import { apiFetch } from '@/lib/catalog';
import { formatPrice } from "@/lib/format";
import type { CartItem } from "@/lib/types";
import {
  groupCartItems,
  hasMixedVendors,
  type VendorGroup,
  cartItemKey,
} from "@/lib/catalog";
import { CITY_MARKETS_VENDOR_ID, type CouponValidateResult } from "@/lib/types";
import { AvailableCoupons } from "@/components/pages/coupons/AvailableCoupons";
import {
  ShoppingCart,
  Minus,
  Plus,
  Trash2,
  Heart,
  ArrowLeft,
  Truck,
  Shield,
  Clock,
  Gift,
  Tag,
  X,
  Check,
  AlertCircle,
  Store,
} from "lucide-react";

interface SuggestedProduct {
  id: string;
  name_ar: string;
  image_url?: string | null;
  price: number;
  discount_price?: number | null;
}

type CouponResult = CouponValidateResult;

// Feature flag: Slice 3 ships the unified checkout endpoint
// (POST /api/v1/checkout) that splits the cart into one parent
// `orders` row + N `vendor_orders` rows. The flag is enabled by default
// in production — it exists as a kill switch so a regression can be
// reverted without a code deploy. When disabled, CartV2 reverts to the
// Slice 2 behaviour: mixed carts (anything that includes a non-City
// Markets vendor item) are blocked with a friendly message.
const CHECKOUT_V2_ENABLED =
  process.env.NEXT_PUBLIC_CHECKOUT_V2_ENABLED !== "false" &&
  process.env.NEXT_PUBLIC_CHECKOUT_V2_ENABLED !== "0";

export function CartV2() {
  const router = useRouter();
  const { user } = useAuthState();
  const { items, updateQuantity, removeItem, subtotal, clearCart } = useCart();
  const { addItem: wishlistAddItem } = useWishlistActions();
  const { showToast } = useToast();
  const { selectedAddress } = useDeliveryLocationState();
  const { openSheet } = useDeliveryLocationActions();
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState<CouponResult | null>(null);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Slice 2: group items by vendor so the UI can render per-vendor
  // headers + per-group subtotals, and Slice 3's checkout can route
  // each group to its own vendor order. Catalog items collapse into
  // a single group (parent `orders` row at checkout).
  const groups = useMemo(() => groupCartItems(items), [items]);
  const mixed = useMemo(() => hasMixedVendors(groups), [groups]);
  // Slice 2 gate: until the unified checkout endpoint ships, mixed
  // carts can't be checked out. Catalog-only carts keep flowing
  // through /api/v1/orders unchanged.
  const checkoutBlockedByMixed =
    mixed && !CHECKOUT_V2_ENABLED;

  // "قد يعجبك" used to render 4 permanent fake skeletons. Fetch real
  // featured products so an empty cart offers an actual way back into
  // the catalog instead of a loading state that never resolves.
  const isEmpty = items.length === 0;
  const [suggestions, setSuggestions] = useState<SuggestedProduct[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);

  useEffect(() => {
    if (!isEmpty) return;
    const ac = new AbortController();
    apiFetch<SuggestedProduct[] | { data: SuggestedProduct[] }>(
      "/api/v1/products?featured=true&limit=8",
      { signal: ac.signal },
    )
      .then((res) => {
        const raw = res.data;
        const list: SuggestedProduct[] = Array.isArray(raw)
          ? raw
          : raw?.data ?? [];
        setSuggestions(list);
        setSuggestionsLoading(false);
      })
      .catch(() => {
        if (!ac.signal.aborted) setSuggestionsLoading(false);
      });
    return () => ac.abort();
  }, [isEmpty]);

  // Server-canonical delivery fee. When no address is selected yet,
  // we render a "set address" prompt instead of a placeholder number.
  const addrCoords =
    selectedAddress && selectedAddress.lat && selectedAddress.lng
      ? { lat: Number(selectedAddress.lat), lng: Number(selectedAddress.lng) }
      : null;
  const quote = useDeliveryQuote(subtotal, addrCoords);
  const deliveryFee = quote.needsAddress ? null : quote.fee;
  // Service fee + tax come from the same /api/v1/delivery/quote call
  // that powers `quote.fee`. They are zeroed when the user hasn't
  // picked an address yet so the cart total doesn't flash random
  // numbers during address selection.
  const serviceFee = quote.needsAddress ? 0 : quote.serviceFee;
  const tax = quote.needsAddress ? 0 : quote.tax;
  const discount = couponResult?.valid ? couponResult.discount || 0 : 0;
  const total = Math.max(
    0,
    (deliveryFee ?? 0) + serviceFee + tax + (subtotal - discount),
  );
  const itemCount = items.length;

  const applyCoupon = async () => {
    if (!couponCode.trim()) return;
    setIsApplyingCoupon(true);
    setCouponResult(null);

    try {
      // csrfFetch attaches the x-csrf-token header required by the proxy
      // double-submit cookie gate. Even though /api/v1/coupons/validate
      // is currently CSRF-exempt, going through csrfFetch keeps every
      // client mutator on a single path so future tightenings don't
      // break this codepath silently.
      const res = await csrfFetch("/api/v1/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: couponCode.trim(),
          subtotal,
        }),
      });
      const data = await res.json();
      if (data?.success && data.valid) {
        setCouponResult({
          valid: true,
          discount: Number(data.discount ?? 0),
          type: data.type,
          message: data.message,
          code: data.code,
        });
      } else {
        setCouponResult({
          valid: false,
          message: data?.error || "كود الخصم غير صحيح",
        });
      }
    } catch {
      setCouponResult({
        valid: false,
        message: "تعذّر التحقق من الكوبون. حاول مرة أخرى.",
      });
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const removeCoupon = () => {
    setCouponCode("");
    setCouponResult(null);
  };

  const handleCheckout = () => {
    if (checkoutBlockedByMixed) return;
    if (!user) {
      router.push("/auth/login?redirect=/checkout");
    } else {
      router.push("/checkout");
    }
  };

  /**
   * Move a single cart row to the wishlist. The order matters:
   *   1. Try `wishlistAddItem` FIRST. If it returns `ok:false` with
   *      `reason: "already_present"` or `"full"`, surface the toast
   *      and leave the cart untouched — never silently lose the
   *      user's only copy of the item.
   *   2. Only after a successful add, remove the row from the cart
   *      using the composite (vendor_id, product_id) key so a multi-
   *      vendor cart can't accidentally hit the wrong row.
   *
   * Both branches feed the toast surface (success / info / warning)
   * so the user gets a clear confirmation either way.
   */
  const moveToWishlist = useCallback(
    (item: CartItem) => {
      const { product, vendor_id: vendorId } = item;
      const result = wishlistAddItem(product);
      if (!result.ok) {
        if (result.reason === "already_present") {
          showToast("المنتج موجود بالفعل في المفضلة", "info");
        } else if (result.reason === "full") {
          showToast("قائمة المفضلة ممتلئة (الحد 50 منتجاً)", "warning");
        }
        return;
      }
      removeItem(product.id, vendorId ?? null);
      showToast("تم نقل المنتج إلى المفضلة", "success");
    },
    [wishlistAddItem, removeItem, showToast],
  );

  if (items.length === 0) {
    return (
      // pb-32 (8rem) leaves clearance for the global BottomNavV2
      // (h-16 = 4rem) + safe-area-inset-bottom so the last row of
      // recommendations is not occluded by the bottom nav.
      <div className="min-h-screen bg-gray-50 flex flex-col pb-32">
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
          <EmptyCart />
        </div>

        {/* Recommendations */}
        <div className="px-4">
          <div className="bg-white rounded-3xl p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Gift className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold text-gray-900">قد يعجبك</h3>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
              {suggestionsLoading
                ? [1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex-shrink-0 w-32 bg-gray-50 rounded-2xl p-3">
                      <div className="aspect-square bg-gray-200 rounded-xl mb-2 animate-pulse" />
                      <div className="h-3 bg-gray-200 rounded animate-pulse w-3/4 mb-1" />
                      <div className="h-4 bg-gray-200 rounded animate-pulse w-1/2" />
                    </div>
                  ))
                : suggestions.map((p) => (
                    <Link
                      key={p.id}
                      href={`/products/${p.id}`}
                      className="flex-shrink-0 w-32 bg-gray-50 rounded-2xl p-3 hover:bg-gray-100 transition-colors"
                    >
                      <div className="aspect-square relative rounded-xl mb-2 overflow-hidden bg-gray-100">
                        <Image
                          src={p.image_url || "https://cdn.citymarkets.sa/products/placeholder.svg"}
                          alt={p.name_ar}
                          fill
                          sizes="128px"
                          className="object-cover"
                        />
                      </div>
                      <p className="text-xs text-gray-700 line-clamp-2 mb-1">{p.name_ar}</p>
                      <p className="text-sm font-bold text-primary-600">
                        {formatPrice(Number(p.discount_price ?? p.price))}
                      </p>
                    </Link>
                  ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    // Bottom padding clears the sticky action bar AND the global
    // BottomNavV2 (h-16 = 4rem). The action bar itself sits above the
    // bottom nav via `bottom: calc(4rem + env(safe-area-inset-bottom))`.
    <div className="min-h-screen bg-gray-50 pb-44">
      {/* Page header — non-sticky. The global HeaderV2 is the sticky
          top header (logo + search + cart badge + account). The cart
          page only needs a small title + clear-cart action that scrolls
          with the content, which is also why the StickyCartBar in the
          storefront chrome self-hides on /cart (see StickyCartBar). */}
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900">سلة التسوق</h1>
              <p className="text-sm text-gray-500">{itemCount} منتجات</p>
            </div>
          </div>
          <button
            onClick={() => setShowClearConfirm(true)}
            className="p-2 text-gray-400 hover:text-red-500 transition-colors"
            aria-label="إفراغ السلة"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Clear Cart Confirmation */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowClearConfirm(false)} />
          <div className="relative bg-white rounded-3xl p-6 max-w-sm w-full animate-scale-in">
            <h3 className="font-bold text-lg text-gray-900 mb-2">إفراغ السلة؟</h3>
            <p className="text-gray-500 text-sm mb-4">سيتم حذف جميع المنتجات من السلة</p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowClearConfirm(false)}
                className="flex-1"
              >
                إلغاء
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  clearCart();
                  setShowClearConfirm(false);
                }}
                className="flex-1"
              >
                إفراغ
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Cart Items — grouped by vendor (Slice 2). Catalog items first,
          then one block per third-party vendor with a header that links
          back to the vendor storefront. The composite identity
          (vendor_id + product_id) is passed down so quantity/remove
          actions don't accidentally hit the wrong row when two vendors
          share a product UUID. */}
      <div className="px-4 py-4 max-w-4xl mx-auto">
        <div className="space-y-6">
          {groups.catalogItems.length > 0 && (
            <VendorGroupSection
              group={{
                vendorId: CITY_MARKETS_VENDOR_ID,
                vendorSlug: null,
                vendorName: "أسواق سيتي",
                isCityMarkets: true,
                items: groups.catalogItems,
                subtotal: groups.catalogItems.reduce(
                  (sum, i) =>
                    sum +
                    (Number(i.product.discount_price) ||
                      Number(i.product.price)) *
                      i.quantity,
                  0,
                ),
                itemCount: groups.catalogItems.reduce(
                  (sum, i) => sum + i.quantity,
                  0,
                ),
              }}
              onUpdateQuantity={updateQuantity}
              onRemove={removeItem}
              onMoveToWishlist={moveToWishlist}
            />
          )}

          {groups.vendorGroups.map((group) => (
            <VendorGroupSection
              key={group.vendorId}
              group={group}
              onUpdateQuantity={updateQuantity}
              onRemove={removeItem}
              onMoveToWishlist={moveToWishlist}
            />
          ))}
        </div>

        {/* Coupon Section */}
        <div className="mt-6 bg-white rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Tag className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-gray-900">كود الخصم</h3>
          </div>

          {couponResult?.valid ? (
            <div className="flex items-center justify-between p-3 bg-primary-50 rounded-xl border border-primary-200">
              <div className="flex items-center gap-2">
                <Check className="w-5 h-5 text-primary" />
                <div>
                  <p className="font-semibold text-primary-700">
                    {couponResult.code ?? couponCode}
                  </p>
                  <p className="text-sm text-primary-600">{couponResult.message}</p>
                </div>
              </div>
              <button
                onClick={removeCoupon}
                className="p-2 text-primary-600 hover:bg-primary-100 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                placeholder="أدخل كود الخصم"
                className="flex-1 h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary focus:ring-2 focus:ring-[#009345]/20 transition-all"
              />
              <Button
                variant="primary"
                onClick={applyCoupon}
                isLoading={isApplyingCoupon}
                disabled={!couponCode.trim()}
              >
                تطبيق
              </Button>
            </div>
          )}

          {couponResult && !couponResult.valid && (
            <div className="flex items-center gap-2 mt-2 text-red-500 text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>{couponResult.message}</span>
            </div>
          )}

          {/* Phase 1 / T6: proactively surface available coupons below
              the input so users don't have to know the code in advance. */}
          <AvailableCoupons
            variant="inline"
            onApply={(code) => {
              setCouponCode(code);
              void applyCoupon();
            }}
            appliedCodes={
              couponResult?.valid && couponResult.code ? [couponResult.code] : []
            }
          />
        </div>

        {/* Trust Badges */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          {[
            { icon: Truck, label: "توصيل خلال 45 دقيقة" },
            { icon: Shield, label: "دفع آمن 100%" },
            { icon: Clock, label: "دعم 24/7" },
          ].map((item, i) => {
            const Icon = item.icon;
            return (
              <div key={i} className="flex flex-col items-center gap-1.5 p-3 bg-white rounded-xl text-center">
                <Icon className="w-5 h-5 text-primary" />
                <span className="text-xs text-gray-600">{item.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky Bottom Summary — compact: only the total and the
          checkout button. The page's cost breakdown (subtotal, delivery
          fee, service fee, tax) was removed per the product request so
          the cart surface stays focused on a single primary action.
          Sits ABOVE the global BottomNavV2 (h-16 = 4rem) so the
          storefront nav stays visible while the user shops.

          Layout contract (mobile-centric):
          - Total block: two lines (label + count chip, price) so the
            user sees both the running total and the item count at a
            glance.
          - Checkout button: `size="md"` (≈48px tall) — satisfies the
            44px minimum tap target while staying compact enough that
            the total + button fit on one row on small phones (≥360px).
          - Arrow icon: `w-4 h-4` (was `w-5 h-5`) so the leading
            affordance scales with the smaller button padding.
          - Sticky bar padding: `py-2.5` (was `py-3`) — saves 4px on
            each axis so the bar stays out of the way of the
            recommendations grid above. */}
      <div
        className="fixed start-0 end-0 z-50 bg-white border-t border-gray-100 shadow-2xl safe-bottom"
        style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}
        role="region"
        aria-label="ملخص السلة"
      >
        <div className="max-w-4xl mx-auto px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div
              className="flex flex-col leading-tight min-w-0"
              aria-label={`إجمالي السلة ${formatPrice(total)}`}
            >
              <span className="text-[11px] text-gray-500 flex items-center gap-1">
                <span>الإجمالي</span>
                <span
                  className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary/10 text-primary-700 text-[10px] font-bold"
                  aria-label={`${itemCount} منتجات`}
                >
                  {itemCount > 99 ? "99+" : itemCount}
                </span>
              </span>
              <span className="font-bold text-primary-600 text-base whitespace-nowrap">
                {formatPrice(total)}
              </span>
            </div>
            <Button
              variant="primary"
              size="md"
              fullWidth
              onClick={handleCheckout}
              disabled={checkoutBlockedByMixed}
              rightIcon={<ArrowLeft className="w-4 h-4" />}
            >
              {checkoutBlockedByMixed
                ? "احذف منتجات المتاجر"
                : user
                  ? "إتمام الطلب"
                  : "تسجيل الدخول للدفع"}
            </Button>
          </div>

          {/* Address hint — when no delivery address is selected the
              total excludes delivery / service / tax, which can mislead
              the user at checkout. Surface a one-tap link to the
              address picker so the user fixes the estimate before they
              commit. Hidden once the address is set (handled by the
              guard in useDeliveryQuote). */}
          {quote.needsAddress && (
            <button
              type="button"
              onClick={openSheet}
              className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 hover:bg-amber-100 transition-colors"
              aria-label="حدد عنوان التوصيل لحساب رسوم التوصيل"
            >
              <span aria-hidden>📍</span>
              <span>حدد عنوان التوصيل لحساب رسوم التوصيل</span>
            </button>
          )}

          {/* Slice 2 explanation — keep this short. Full rollout copy
              lives in the Slice 3 PR. */}
          {checkoutBlockedByMixed && (
            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              السلة تحتوي على منتجات من أكثر من متجر. الدفع الموحّد قيد التفعيل —
              يرجى حذف منتجات المتاجر أو المتابعة بعربة من متجر واحد فقط.
            </p>
          )}

          {/* Guest Checkout Option — REMOVED 2026-10-01.
              The middleware in src/middleware.ts PROTECTED_PREFIXES = ["/profile",
              "/orders", "/checkout"] forces every unauthenticated visitor hitting
              /checkout to bounce to /auth/login. The cart UI advertised a guest
              flow that the server-side guard silently overrides. Without a
              guest-checkout server path (different DB row, different webhook,
              different SMS body), we removed the button rather than ship a
              dead CTA. Future guest-checkout work would need to: (1) add a
              guest_orders table or reuse vendor_orders.guest_*, (2) update
              PROTECTED_PREFIXES to carve out /checkout when ?guest=1, and
              (3) make the Moyasar webhook accept guest-only orders. Until
              then, "أكمل كزائر" is not wired. */}
        </div>
      </div>
    </div>
  );
}

interface CartItemCardV2Props {
  item: CartItem;
  /** Composite key — required so the row's quantity/remove actions
   *  don't accidentally hit a different row sharing the same product
   *  UUID under a different vendor. Pass `cartItemKey(item)` from the
   *  parent or reconstruct via the helper. */
  compositeKey: string;
  onUpdateQuantity: (productId: string, quantity: number, vendorId?: string | null) => void;
  onRemove: (productId: string, vendorId?: string | null) => void;
  /**
   * "Move to wishlist" handler. Composed at the page level from
   * `useWishlistActions().addItem` + `useCart().removeItem` so the
   * composite (vendor_id, product_id) key is preserved and a failure
   * in the wishlist add doesn't silently lose the cart row.
   */
  onMoveToWishlist: (item: CartItem) => void;
}

function CartItemCardV2({
  item,
  compositeKey,
  onUpdateQuantity,
  onRemove,
  onMoveToWishlist,
}: CartItemCardV2Props) {
  const product = item.product;
  const productId = product.id;
  const vendorId = item.vendor_id ?? null;

  const hasDiscount = product.discount_price && product.discount_price < product.price;
  const displayPrice = product.discount_price ?? product.price;
  const discountPercent = hasDiscount
    ? Math.round((1 - product.discount_price! / product.price) * 100)
    : 0;

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm" data-composite-key={compositeKey}>
      <div className="flex gap-4">
        {/* Image */}
        <Link
          href={`/products/${productId}`}
          className="flex-shrink-0"
          aria-label={`عرض تفاصيل ${product.name_ar}`}
        >
          <div className="w-24 h-24 rounded-xl bg-gray-100 overflow-hidden">
            <Image
              src={product.image_url || "https://cdn.citymarkets.sa/products/placeholder.svg"}
              alt={product.name_ar}
              width={96}
              height={96}
              className="w-full h-full object-cover"
            />
          </div>
        </Link>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex justify-between gap-2">
            <div className="flex-1 min-w-0">
              <Link href={`/products/${productId}`}>
                <h3 className="font-semibold text-gray-900 line-clamp-2 leading-tight hover:text-primary-600 transition-colors">
                  {product.name_ar}
                </h3>
              </Link>
              {product.unit && (
                <p className="text-xs text-gray-500 mt-1">{product.unit}</p>
              )}
            </div>
            <button
              onClick={() => onRemove(productId, vendorId)}
              className="p-2 -m-2 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
              aria-label={`حذف ${product.name_ar}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-end justify-between mt-3">
            <div>
              <span
                className="text-lg font-bold text-primary-600"
                aria-label={`سعر ${displayPrice * item.quantity} ريال`}
              >
                {formatPrice(displayPrice * item.quantity)}
              </span>
            </div>

            {/* Quantity Controls — `aria-label` on the wrapper so
                screen readers announce a single accessible name for
                the row ("كمية X"). Individual buttons get aria-label
                for the action. The quantity text is `aria-live="polite"`
                so the new value is announced when "+" or "-" is
                pressed. */}
            <div
              className="flex items-center bg-gray-100 rounded-xl"
              role="group"
              aria-label={`كمية ${product.name_ar}`}
            >
              <button
                onClick={() => onUpdateQuantity(productId, Math.max(1, item.quantity - 1), vendorId)}
                className="w-9 h-9 flex items-center justify-center text-gray-600 hover:bg-gray-200 active:bg-gray-300 rounded-xl transition-colors disabled:opacity-40"
                disabled={item.quantity <= 1}
                aria-label="إنقاص الكمية"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span
                className="w-10 text-center font-semibold"
                aria-live="polite"
                aria-atomic="true"
              >
                {item.quantity}
              </span>
              <button
                onClick={() => onUpdateQuantity(productId, item.quantity + 1, vendorId)}
                className="w-9 h-9 flex items-center justify-center text-gray-600 hover:bg-gray-200 active:bg-gray-300 rounded-xl transition-colors"
                aria-label="زيادة الكمية"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Original Price & Discount */}
          {hasDiscount && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-sm text-gray-400 line-through">
                {formatPrice(product.price * item.quantity)}
              </span>
              <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs font-bold rounded-lg">
                -{discountPercent}%
              </span>
            </div>
          )}

          {/* Unit Price */}
          <p className="text-xs text-gray-500 mt-1">
            {formatPrice(displayPrice)} لكل وحدة
          </p>
        </div>
      </div>

      {/* Wishlist Option — moves the row to the wishlist without
          losing it. The handler composes `addItem` (which returns
          `{ok, reason}`) and `removeItem` so a failure in the
          wishlist add (already_present, full) leaves the cart row
          intact instead of silently dropping it. */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
        <button
          type="button"
          onClick={() => onMoveToWishlist(item)}
          aria-label="نقل للمفضلة"
          title="نقل للمفضلة"
          data-testid={`move-to-wishlist-${productId}`}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-red-500 transition-colors"
        >
          <Heart className="w-4 h-4" aria-hidden="true" />
          <span>نقل للمفضلة</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Renders one vendor block — a header (vendor name + link to vendor
 * storefront + per-group subtotal) followed by the rows for that
 * vendor. Catalog (City Markets) items render here too — the header
 * reads "أسواق سيتي" and is non-clickable, matching the marketplace
 * pattern in the product card + detail pages.
 */
function VendorGroupSection({
  group,
  onUpdateQuantity,
  onRemove,
  onMoveToWishlist,
}: {
  group: VendorGroup;
  onUpdateQuantity: (productId: string, quantity: number, vendorId?: string | null) => void;
  onRemove: (productId: string, vendorId?: string | null) => void;
  onMoveToWishlist: (item: CartItem) => void;
}) {
  const label = group.isCityMarkets
    ? "أسواق سيتي"
    : group.vendorName?.trim() || "متجر مستقل";

  return (
    <section aria-label={`منتجات ${label}`} className="space-y-2">
      <header className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
            <Store className="w-4 h-4 text-gray-600" aria-hidden="true" />
          </span>
          {group.isCityMarkets || !group.vendorSlug ? (
            <span className="font-bold text-gray-900 truncate">{label}</span>
          ) : (
            <Link
              href={`/vendors/${group.vendorSlug}`}
              className="font-bold text-gray-900 truncate hover:text-primary-600 transition-colors"
              aria-label={`زيارة متجر ${label}`}
            >
              {label}
            </Link>
          )}
          <span className="text-xs text-gray-500 flex-shrink-0">
            ({group.itemCount} {group.itemCount === 1 ? "منتج" : "منتجات"})
          </span>
        </div>
        <span className="text-sm font-bold text-primary-600 flex-shrink-0">
          {formatPrice(group.subtotal)}
        </span>
      </header>
      <div className="space-y-3">
        {group.items.map((item) => (
          <CartItemCardV2
            key={cartItemKey(item)}
            item={item}
            compositeKey={cartItemKey(item)}
            onUpdateQuantity={onUpdateQuantity}
            onRemove={onRemove}
            onMoveToWishlist={onMoveToWishlist}
          />
        ))}
      </div>
    </section>
  );
}
