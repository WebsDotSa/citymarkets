"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Heart, Trash2, ShoppingBag, ChevronRight, ArrowRight } from "lucide-react";
import {
  useWishlistState,
  useWishlistActions,
} from "@/contexts/wishlist-context";
import { useCart } from "@/contexts/cart-context";
import { ProductCard } from "@/components/storefront/product-card";
import { formatPrice } from "@/lib/format";
import { BRAND } from "@/lib/brand-theme";
import { useConfirm } from "@/components/ui/toast";

export default function WishlistPage() {
  const router = useRouter();
  const { items, itemCount } = useWishlistState();
  const { removeItem, clearWishlist } = useWishlistActions();
  const { addItem: addToCart, itemCount: cartCount } = useCart();
  const confirm = useConfirm();

  const handleAddAllToCart = () => {
    items.forEach(({ product }) => {
      addToCart(product);
    });
    router.push("/cart");
  };

  const handleAddToCart = (product: typeof items[0]["product"]) => {
    addToCart(product);
    // Optionally remove from wishlist after adding
    // removeItem(product.id);
  };

  if (items.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <Heart className="w-12 h-12 text-gray-300" />
        </div>
        <h1 className="text-2xl font-bold text-secondary mb-2">
          قائمة أمنياتك فارغة
        </h1>
        <p className="text-gray-500 mb-8">
          احفظ المنتجات التي تعجبك لتتمكن من طلبها لاحقاً
        </p>
        <Link
          href="/catalog"
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors"
        >
          <span>استكشف المنتجات</span>
          <ChevronRight className="w-5 h-5" />
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-secondary">قائمة أمنياتي</h1>
          <p className="text-sm text-gray-500 mt-1">
            {itemCount} {itemCount === 1 ? "منتج" : "منتجات"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push("/cart")}
            className="relative p-2 text-gray-500 hover:text-secondary transition-colors"
            aria-label={`السلة (${cartCount} منتج)`}
          >
            <ShoppingBag className="w-6 h-6" />
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-white text-xs font-bold rounded-full flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={async () => {
              if (await confirm({ title: "حذف الكل", message: "هل أنت متأكد من حذف جميع المنتجات من قائمة الأمنيات؟", danger: true })) {
                clearWishlist();
              }
            }}
            className="px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          >
            حذف الكل
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-primary/5 rounded-2xl p-4 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
            <Heart className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-secondary">
              أضف الكل للسلة
            </p>
            <p className="text-xs text-gray-500">
              {items.length} منتجات بقيمة{" "}
              {formatPrice(
                items.reduce(
                  (sum, item) =>
                    sum +
                    Number(
                      item.product.discount_price ?? item.product.price
                    ),
                  0
                )
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleAddAllToCart}
          className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-dark transition-colors flex items-center gap-2"
        >
          <ShoppingBag className="w-4 h-4" />
          <span>أضف للسلة</span>
        </button>
      </div>

      {/* Grid View */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {items.map(({ product, addedAt }) => (
          <div key={product.id} className="relative">
            {/* Date badge */}
            <div className="absolute top-2 left-2 z-10 bg-black/50 text-white text-[10px] px-2 py-1 rounded-full">
              {new Date(addedAt).toLocaleDateString("ar-SA", {
                day: "numeric",
                month: "short",
              })}
            </div>

            {/* Remove button */}
            <button
              type="button"
              onClick={() => removeItem(product.id)}
              className="absolute top-2 right-2 z-10 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-white shadow-sm transition-colors"
              aria-label={`حذف ${product.name_ar}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {/* Product Card */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <Link href={`/products/${product.id}`}>
                <div className="aspect-square bg-gray-50 relative">
                  {product.image_url ? (
                    <Image
                      src={product.image_url}
                      alt={product.name_ar}
                      fill
                      className="object-contain p-3"
                      sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-4xl opacity-30">📦</span>
                    </div>
                  )}
                </div>
              </Link>

              <div className="p-3">
                <Link href={`/products/${product.id}`}>
                  <p className="text-sm text-secondary line-clamp-2 leading-snug hover:text-primary transition-colors">
                    {product.name_ar}
                  </p>
                </Link>

                <div className="flex items-baseline gap-1 mt-2">
                  <span
                    className={`text-sm font-bold ${
                      product.discount_price ? "text-red-600" : "text-secondary"
                    }`}
                  >
                    {formatPrice(
                      Number(
                        product.discount_price ?? product.price
                      )
                    )}
                  </span>
                  <span className="text-[10px] text-gray-500">ر.س</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleAddToCart(product)}
                  className="w-full mt-3 h-9 bg-primary text-white text-xs font-medium rounded-xl hover:bg-primary-dark transition-colors flex items-center justify-center gap-2"
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span>أضف للسلة</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recommendations */}
      <section className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-secondary">قد يعجبك أيضاً</h2>
          <Link
            href="/catalog"
            className="text-sm text-primary font-medium flex items-center gap-1 hover:underline"
          >
            <span>عرض الكل</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <p className="text-sm text-gray-500">
          أضف منتجات جديدة واكتشف المزيد من المنتجات المميزة
        </p>
      </section>
      {confirm.dialog}
    </div>
  );
}
