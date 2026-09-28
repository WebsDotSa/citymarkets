"use client";

import Link from "next/link";
import Image from "next/image";
import { Plus, Check, Heart, Store, Sparkles } from "lucide-react";
import { useState } from "react";
import { useCart } from "@/contexts/cart-context";
import { useWishlistActions } from "@/contexts/wishlist-context";
import { isCityMarketsVendor } from "@/lib/product-source";
import type { Product } from "@/lib/types";

interface ProductCardProps {
  product: Product;
  /** Horizontal scroll card (order again) */
  compact?: boolean;
  /** Priority loading for above-the-fold images (LCP optimization) */
  priority?: boolean;
}

export function ProductCard({ product, compact, priority = false }: ProductCardProps) {
  const { addItem } = useCart();
  const { isInWishlist, toggleItem } = useWishlistActions();
  const [added, setAdded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const inWishlist = isInWishlist(product.id);

  // Slice 5: prefer the server-computed `effective_price` (which
  // resolves offer + legacy discount + list down to the cheapest
  // visible price for the customer). When the API hasn't populated
  // it (older routes), fall back to the legacy discount_price logic.
  const original = Number(product.price);
  const offerEffective = product.effective_price ?? null;
  const legacySale =
    product.discount_price != null ? Number(product.discount_price) : null;
  const price =
    offerEffective != null
      ? offerEffective
      : legacySale != null && legacySale < original
        ? legacySale
        : original;
  const hasDiscount = price < original;
  const hasOffer = !!product.active_offer;

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addItem(product);
    setAdded(true);
    setTimeout(() => setAdded(false), 1200);
  };

  // Generate descriptive alt text
  const productAlt = product.name_ar
    ? `صورة منتج ${product.name_ar}${product.category_name ? ` - ${product.category_name}` : ""}`
    : "صورة المنتج";

  // Vendor provenance badge. `vendor_id` is populated by
  // /api/v1/products (Slice 1) and is `null` for legacy catalog rows
  // that haven't yet been backfilled — those are treated as City
  // Markets too. The marketplace is explicit about provenance because
  // mixed-cart checkout (Slice 3) splits the order per vendor, so the
  // customer needs to see who fulfils each item before adding it.
  const hasVendor = !!product.vendor_id;
  const isCityMarkets = isCityMarketsVendor(product.vendor_id);
  const vendorLabel = isCityMarkets
    ? "أسواق سيتي"
    : product.vendor_name?.trim() || "متجر";
  const vendorHref =
    hasVendor && !isCityMarkets && product.vendor_slug
      ? `/vendors/${product.vendor_slug}`
      : null;

  return (
    <Link
      href={`/products/${product.id}`}
      className={`block ${compact ? "flex-shrink-0 w-[140px]" : ""}`}
    >
      <div className="relative bg-white rounded-2xl overflow-hidden shadow-sm">
        <div
          className={`relative bg-gradient-to-b from-violet-50/40 via-gray-50 to-white flex items-center justify-center ${
            compact ? "h-[120px]" : "aspect-square"
          }`}
        >
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={productAlt}
              fill
              priority={priority}
              className={`object-contain p-2 transition-opacity duration-200 ${
                imageLoaded ? "opacity-100" : "opacity-0"
              }`}
              sizes={compact ? "140px" : "(max-width: 768px) 50vw, 200px"}
              onLoad={() => setImageLoaded(true)}
            />
          ) : (
            <span className="text-4xl opacity-40" role="img" aria-label="صورة المنتج غير متوفرة">📦</span>
          )}
          {hasOffer && (
            <span
              className="absolute top-2 right-2 inline-flex items-center gap-1 bg-gradient-to-r from-pink-500 to-orange-500 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow"
              aria-label={`عرض: ${product.active_offer?.title_ar ?? "عرض خاص"}`}
            >
              <Sparkles className="w-3 h-3" />
              عرض
            </span>
          )}
          {hasDiscount && !hasOffer && (
            <span
              className="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-bold w-7 h-7 rounded-full flex items-center justify-center"
              aria-label={`خصم ${Math.round((1 - price / original) * 100)}%`}
            >
              %
            </span>
          )}

          {/* Stock indicator */}
          {product.stock_qty === 0 && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
              <span className="bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                نفذ المخزون
              </span>
            </div>
          )}
          {product.stock_qty > 0 && product.stock_qty <= 5 && (
            <span
              className="absolute bottom-2 right-2 bg-amber-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full"
              aria-label={`متبقي ${product.stock_qty} فقط`}
            >
              متبقي {product.stock_qty}
            </span>
          )}

          {/* Wishlist Button */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleItem(product);
            }}
            className={`absolute top-2 left-2 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
              inWishlist
                ? "bg-red-50 text-red-500"
                : "bg-white/80 text-gray-400 hover:text-red-500 hover:bg-white"
            }`}
            aria-label={inWishlist ? "إزالة من المفضلة" : "إضافة للمفضلة"}
          >
            <Heart className={`w-4 h-4 ${inWishlist ? "fill-current" : ""}`} aria-hidden="true" />
          </button>

          {/* Add to Cart Button */}
          <button
            type="button"
            onClick={handleAdd}
            className={`absolute bottom-2 left-2 w-9 h-9 rounded-full shadow-md flex items-center justify-center transition-colors ${
              added ? "bg-green-500 text-white" : "bg-white text-gray-900"
            }`}
            aria-label={added ? `تمت إضافة ${product.name_ar} للسلة` : `إضافة ${product.name_ar} للسلة`}
          >
            {added ? (
              <Check className="w-5 h-5" aria-hidden="true" />
            ) : (
              <Plus className="w-5 h-5" style={{ strokeWidth: 2.5 }} aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="p-2.5 pt-2">
          {product.category_name && (
            <p className="text-[10px] text-primary-dark truncate mb-0.5" aria-label={`التصنيف: ${product.category_name}`}>{product.category_name}</p>
          )}
          {/* Vendor badge — sits BELOW the category label so the layout
              reads: category → vendor → price → name. Wrapped in a
              fragment so the click target for the badge doesn't
              accidentally trigger the outer Link's navigation (handled
              inside the badge component below). */}
          {hasVendor && (
            <VendorBadge
              vendorName={vendorLabel}
              vendorHref={vendorHref}
              isCityMarkets={isCityMarkets}
            />
          )}
          <div className="flex items-baseline gap-1 flex-wrap">
            <span
              className={`text-sm font-bold ${
                hasDiscount ? "text-red-600" : "text-gray-900"
              }`}
              aria-label={`السعر: ${price.toFixed(2)} ريال سعودي`}
            >
              {price.toFixed(2)}
            </span>
            <span className="text-[10px] text-gray-500" aria-hidden="true">ر.س</span>
            {hasDiscount && (
              <span className="text-[10px] text-gray-400 line-through mr-1" aria-label={`السعر الأصلي: ${original.toFixed(2)} ريال`}>
                {original.toFixed(2)}
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-700 line-clamp-2 leading-snug mt-1 min-h-[2.25rem]">
            {product.name_ar}
          </p>
        </div>
      </div>
    </Link>
  );
}

/**
 * Vendor provenance badge. City Markets items are non-clickable (just a
 * label) because the parent card already links to the product detail;
 * third-party vendor items are wrapped in a Link to the vendor storefront
 * so the user can browse the rest of that vendor's catalog.
 */
function VendorBadge({
  vendorName,
  vendorHref,
  isCityMarkets,
}: {
  vendorName: string;
  vendorHref: string | null;
  isCityMarkets: boolean;
}) {
  const className =
    "inline-flex items-center gap-1 text-[10px] text-gray-500 truncate mb-0.5 max-w-full";
  const icon = <Store className="w-3 h-3 flex-shrink-0" aria-hidden="true" />;
  if (vendorHref) {
    return (
      // The outer Link wraps the whole card; we stop propagation so a
      // click on the badge navigates to the vendor storefront rather
      // than re-triggering the product-detail navigation.
      <span className={className}>
        {icon}
        <Link
          href={vendorHref}
          onClick={(e) => e.stopPropagation()}
          className="hover:underline truncate"
          aria-label={`تسوق من ${vendorName}`}
        >
          {vendorName}
        </Link>
      </span>
    );
  }
  return (
    <span className={className} aria-label={`البائع: ${vendorName}`}>
      {icon}
      <span className="truncate">{vendorName}</span>
      {isCityMarkets && (
        <span className="sr-only"> — البائع الرسمي</span>
      )}
    </span>
  );
}
