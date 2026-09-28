"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { X, Share2, ShoppingBag, ChevronLeft, Mic, Plus, Minus, Square, Heart, Store } from "lucide-react";
import { useCart } from "@/contexts/cart-context";
import { useWishlistActions } from "@/contexts/wishlist-context";
import { useAuthState } from "@/contexts/auth-context";
import { ProductCard } from "@/components/storefront/product-card";
import { ProductReviews } from "@/components/storefront/product-reviews";
import type { Product } from "@/lib/types";
import { isCityMarketsVendor } from "@/lib/product-source";
import { BRAND } from "@/lib/brand-theme";
import { ProductDetailSkeleton } from "@/components/design/skeleton";
import { formatPrice } from "@/lib/utils";
import { trackViewItem } from "@/lib/ga-events";

export function ProductDetailPage() {
  const { user } = useAuthState();
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;
  const { addItem, itemCount, subtotal } = useCart();
  const { isInWishlist, toggleItem } = useWishlistActions();
  const [product, setProduct] = useState<Product | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
  const [added, setAdded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [imgIndex, setImgIndex] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const prefetchRef = useRef<HTMLLinkElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const canvasAnimRef = useRef<number | null>(null);

  const inWishlist = product ? isInWishlist(product.id) : false;

  // Prefetch related products on mount
  useEffect(() => {
    // Create a link element for prefetching
    prefetchRef.current = document.createElement("link");
    prefetchRef.current.rel = "prefetch";
    prefetchRef.current.as = "image";
    document.head.appendChild(prefetchRef.current);

    return () => {
      if (prefetchRef.current) {
        document.head.removeChild(prefetchRef.current);
      }
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      if (canvasAnimRef.current) cancelAnimationFrame(canvasAnimRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (!productId) return;
    setLoading(true);
    setImageLoaded(false);

    fetch(`/api/v1/products/${productId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setProduct(res.data);
          setRelatedProducts(res.related || []);

          // Google Analytics 4 — view_item. Fire on every successful
          // load (refresh included) so we capture repeat views too.
          const p = res.data;
          const price = Number(p.discount_price ?? p.price ?? 0);
          trackViewItem({
            currency: "SAR",
            value: price,
            items: [
              {
                item_id: p.id,
                item_name: p.name_ar ?? p.name_en ?? p.id,
                price,
                item_category:
                  p.category?.name_ar ?? p.category?.name_en ?? undefined,
              },
            ],
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [productId]);

  if (loading) {
    return <ProductDetailSkeleton />;
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
        <p className="text-lg font-bold text-gray-800 mb-2">المنتج غير موجود</p>
        <Link href="/catalog" className="text-primary hover:underline">
          العودة للتسوق
        </Link>
      </div>
    );
  }

  const price = Number(product.discount_price ?? product.price);
  const original = Number(product.price);
  const hasDiscount = product.discount_price != null && price < original;

  const handleAdd = () => {
    if (!product) return;
    addItem(product, quantity);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  const handleToggleWishlist = (e: React.MouseEvent) => {
    e.preventDefault();
    if (product) toggleItem(product);
  };

  const startRecording = async () => {
    setRecordingError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordingTimerRef.current) {
          window.clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        if (canvasAnimRef.current) {
          cancelAnimationFrame(canvasAnimRef.current);
          canvasAnimRef.current = null;
        }
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `voice-note-${product?.id || "product"}-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        setRecording(false);
        setRecordingTime(0);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      const startedAt = Date.now();
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingTime(Math.floor((Date.now() - startedAt) / 1000));
      }, 250);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطأ غير معروف";
      setRecordingError(
        msg.includes("Permission") || msg.includes("NotAllowed")
          ? "السماح بالميكروفون مطلوب لتسجيل ملاحظة صوتية"
          : "فشل تشغيل الميكروفون. تحقق من الإعدادات"
      );
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  // Get all product images
  const allImages = product.images && product.images.length > 0 
    ? product.images 
    : product.image_url 
      ? [product.image_url] 
      : [];

  const discountPercentage = hasDiscount
    ? Math.round((1 - price / original) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-white pb-28">
      {/* Header - floating overlay with RTL-aware button groups */}
      <div className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between p-4 pointer-events-none">
        {/* Visual right (RTL first position): voice record + back */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            className={`w-11 h-11 flex items-center justify-center rounded-full transition-all ${
              recording
                ? "bg-red-500 text-white animate-pulse shadow-md"
                : "text-gray-700 hover:bg-gray-100"
            }`}
            aria-label={recording ? "إيقاف التسجيل" : "تسجيل ملاحظة صوتية"}
            title={recording ? `جاري التسجيل... ${recordingTime} ثانية` : "تسجيل ملاحظة صوتية"}
          >
            {recording ? (
              <Square className="w-4 h-4" fill="currentColor" aria-hidden="true" />
            ) : (
              <Mic className="w-5 h-5" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="w-11 h-11 flex items-center justify-center text-gray-700 rounded-full hover:bg-gray-100 transition-colors"
            aria-label="العودة"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        {/* Visual left (RTL second position): wishlist + share - paired with appropriate size */}
        <div className="flex items-center gap-2.5 pointer-events-auto">
          <button
            type="button"
            onClick={handleToggleWishlist}
            className={`w-12 h-12 flex items-center justify-center rounded-full transition-all shadow-sm ${
              inWishlist
                ? "bg-red-500 text-white shadow-red-200"
                : "bg-white/90 text-gray-700 hover:bg-red-50 hover:text-red-500 backdrop-blur-sm"
            }`}
            aria-label={inWishlist ? `إزالة ${product.name_ar} من المفضلة` : `إضافة ${product.name_ar} للمفضلة`}
            aria-pressed={inWishlist}
          >
            <Heart
              className={`w-6 h-6 ${inWishlist ? "fill-current" : ""}`}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            className="w-12 h-12 flex items-center justify-center bg-white/90 text-gray-700 rounded-full hover:bg-primary hover:text-white shadow-sm backdrop-blur-sm transition-all"
            aria-label="مشاركة المنتج"
            onClick={async () => {
              const url = typeof window !== "undefined" ? window.location.href : "";
              const title = product.name_ar;
              const shareData = {
                title,
                text: `${title} — ${formatPrice(price)}\n${url}`,
                url,
              };
              try {
                if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
                  await navigator.share(shareData);
                  return;
                }
              } catch (err) {
                // User cancelled or share failed — fall through to WhatsApp link.
                if ((err as DOMException)?.name === "AbortError") return;
              }
              // Fallback: WhatsApp share
              const text = encodeURIComponent(`${shareData.text}\n\nمن أسواق سيتي`);
              const whatsappUrl = `https://wa.me/?text=${text}`;
              if (typeof window !== "undefined") {
                window.open(whatsappUrl, "_blank", "noopener,noreferrer");
              }
            }}
          >
            <Share2 className="w-6 h-6" aria-hidden="true" />
          </button>
        </div>
      </div>

      {recordingError && (
        <div className="fixed top-16 left-4 right-4 z-40 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-2 shadow-sm flex items-center justify-between gap-2">
          <span>{recordingError}</span>
          <button
            type="button"
            onClick={() => setRecordingError(null)}
            className="text-red-500 hover:text-red-700"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* Image Section - Optimized for LCP & CLS */}
      <div className="relative bg-gradient-to-b from-gray-50 to-white px-6 pt-4 pb-6">
        {/* Discount Badge */}
        {hasDiscount && (
          <div 
            className="absolute top-4 right-4 z-10 bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg"
            aria-label={`خصم ${discountPercentage}%`}
          >
            -{discountPercentage}%
          </div>
        )}

        {/* Main Image Container - Prevents CLS with aspect-ratio */}
        <div 
          className="relative aspect-square max-h-[360px] mx-auto bg-white rounded-2xl overflow-hidden shadow-sm"
          style={{ contain: "layout paint" }}
        >
          {allImages.length > 0 ? (
            <Image
              src={allImages[imgIndex]}
              alt={`صورة ${product.name_ar}${imgIndex > 0 ? ` ${imgIndex + 1}` : ''}`}
              fill
              priority={imgIndex === 0}
              className={`object-contain transition-opacity duration-300 ${
                imageLoaded ? "opacity-100" : "opacity-0"
              }`}
              sizes="(max-width: 768px) 100vw, 50vw"
              onLoad={() => setImageLoaded(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-6xl opacity-30" role="img" aria-label="صورة المنتج غير متوفرة">📦</span>
            </div>
          )}
          
          {/* Loading shimmer */}
          {!imageLoaded && allImages.length > 0 && (
            <div className="absolute inset-0 skeleton" />
          )}
        </div>

        {/* Image Thumbnails */}
        {allImages.length > 1 && (
          <div 
            className="flex justify-center gap-2 mt-4" 
            role="tablist"
            aria-label="صور المنتج"
          >
            {allImages.map((img, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setImgIndex(i)}
                className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                  imgIndex === i 
                    ? "border-primary shadow-md" 
                    : "border-gray-200 hover:border-gray-300"
                }`}
                role="tab"
                aria-selected={imgIndex === i}
                aria-label={`صورة ${i + 1}`}
              >
                <Image
                  src={img}
                  alt={`صورة مصغرة ${i + 1}`}
                  fill
                  className="object-cover"
                  sizes="64px"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Product Info */}
      <div className="px-4 pt-2 space-y-4">
        {/* Category Badge — Slice 1: rendered above the vendor badge so
            the layout reads category → vendor → title. The vendor badge
            makes the marketplace nature of the storefront explicit; if
            we ever drop the City Markets badge from the cards, keep it
            here so the detail page still tells the customer who is
            fulfilling the order. */}
        {product.category_name && product.category_slug && (
          <Link
            href={`/categories/${encodeURIComponent(product.category_slug)}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-dark bg-primary-light px-3 py-1.5 rounded-full hover:bg-primary-light/80 transition-colors"
          >
            <span>{product.category_name}</span>
            <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        )}

        {/* Vendor Badge — third-party vendors link to their storefront;
            City Markets is non-clickable (it's the marketplace host). */}
        {product.vendor_id && (
          <VendorBadge product={product} />
        )}

        {/* Product Name */}
        <h1 className="text-lg font-bold text-gray-900 leading-relaxed">
          {product.name_ar}
        </h1>

        {/* Price Section */}
        <div className="flex items-baseline gap-3">
          <span
            className={`text-2xl font-bold ${
              hasDiscount ? "text-red-600" : "text-gray-900"
            }`}
            aria-label={`السعر: ${formatPrice(price).replace(" ر.س", " ريال سعودي")}`}
          >
            {formatPrice(price)}
          </span>
          {hasDiscount && (
            <span
              className="text-base text-gray-400 line-through"
              aria-label={`السعر القديم: ${formatPrice(original).replace(" ر.س", " ريال")}`}
            >
              {formatPrice(original)}
            </span>
          )}
        </div>

        {/* Unit */}
        {product.unit && (
          <p className="text-sm text-gray-500">
            الوحدة: <span className="font-medium">{product.unit}</span>
          </p>
        )}

        {/* Description */}
        {product.description && (
          <div className="pt-2">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">الوصف</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {product.description}
            </p>
          </div>
        )}

        {/* Stock Status */}
        <div className="flex items-center gap-2">
          {product.stock_qty > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-green-600 bg-green-50 px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              متوفر
              {product.stock_qty <= 5 && (
                <span className="text-xs font-medium">
                  (باقي {product.stock_qty} فقط!)
                </span>
              )}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm text-red-600 bg-red-50 px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 bg-red-500 rounded-full" />
              غير متوفر حالياً
            </span>
          )}
        </div>
      </div>

      {/* Related Products */}
      {relatedProducts.length > 0 && (
        <section className="mt-8 px-4">
          <h2 className="font-bold text-gray-900 mb-4">منتجات مشابهة</h2>
          <div className="grid grid-cols-3 gap-2">
            {relatedProducts.slice(0, 6).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {/* Reviews */}
      <ProductReviews
        productId={productId}
        signedIn={!!user}
        userLabel={user?.name || user?.phone || "حسابك"}
      />

      {/* Sticky Add to Cart Bar */}
      <div
        className="fixed left-0 right-0 z-40 px-4 py-3 bg-white border-t border-gray-100 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] space-y-2"
        style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {/* Quantity Stepper - placed ABOVE the add-to-cart row, on the right side */}
        {product.stock_qty > 0 && (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-gray-500 ml-1">الكمية:</span>
            <div className="flex items-center gap-1 bg-gray-100 rounded-full p-1">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center text-gray-700 hover:bg-primary hover:text-white disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-gray-700 transition-colors"
                aria-label="إنقاص الكمية"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span
                className="w-8 text-center font-bold text-sm tabular-nums"
                aria-live="polite"
                aria-label={`الكمية ${quantity}`}
              >
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(product.stock_qty, q + 1))}
                disabled={quantity >= product.stock_qty}
                className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center text-gray-700 hover:bg-primary hover:text-white disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-gray-700 transition-colors"
                aria-label="زيادة الكمية"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Bottom row: Add to Cart + Cart Summary */}
        <div className="flex items-center gap-3">
          {/* Add to Cart Button */}
          <button
            type="button"
            onClick={handleAdd}
            disabled={product.stock_qty === 0}
            className="flex-1 h-12 rounded-2xl text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
            style={{
              backgroundColor: added ? "#22C55E" : BRAND.primary,
            }}
            aria-label={added ? "تمت إضافة المنتج للسلة" : `إضافة ${quantity} من المنتج للسلة`}
          >
            {added ? (
              <>
                <span>تمت الإضافة ✓</span>
              </>
            ) : (
              <>
                <ShoppingBag className="w-5 h-5" aria-hidden="true" />
                <span>أضف للسلة</span>
                {quantity > 1 && (
                  <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full">
                    ×{quantity}
                  </span>
                )}
              </>
            )}
          </button>

          {/* Cart Summary */}
          {itemCount > 0 && (
            <Link
              href="/cart"
              className="h-12 min-w-[100px] px-4 rounded-2xl text-white flex items-center justify-between gap-2 transition-colors hover:opacity-90"
              style={{ backgroundColor: BRAND.cartBar }}
              aria-label={`السلة تحتوي على ${itemCount} منتج، المجموع ${subtotal.toFixed(0)} ريال`}
            >
              <div className="text-right leading-tight">
                <div className="text-xs font-bold">{subtotal.toFixed(0)} ر.س</div>
                <div className="text-[10px] text-white/70">{itemCount} منتج</div>
              </div>
              <ShoppingBag className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Vendor provenance badge rendered next to the category badge on the
 * product detail page. Third-party vendors link to their storefront;
 * City Markets items render as a non-clickable label with a small
 * store icon — it's the marketplace host, not a vendor the customer
 * should browse.
 */
function VendorBadge({ product }: { product: Product }) {
  const isCityMarkets = isCityMarketsVendor(product.vendor_id);
  const label = isCityMarkets
    ? "أسواق سيتي"
    : product.vendor_name?.trim() || "متجر مستقل";
  const href =
    !isCityMarkets && product.vendor_slug ? `/vendors/${product.vendor_slug}` : null;

  const baseClass =
    "inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 bg-gray-100 px-3 py-1.5 rounded-full";

  if (href) {
    return (
      <Link
        href={href}
        className={`${baseClass} hover:bg-gray-200 transition-colors`}
        aria-label={`تسوق بقية منتجات ${label}`}
      >
        <Store className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{label}</span>
        <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
      </Link>
    );
  }

  return (
    <span className={baseClass} aria-label={`البائع: ${label}`}>
      <Store className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
