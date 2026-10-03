"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Heart, Trash2, ShoppingBag, ChevronRight } from "lucide-react";
import {
  useWishlistState,
  useWishlistActions,
} from "@/contexts/wishlist-context";
import { useCart } from "@/contexts/cart-context";
import { useConfirm } from "@/components/ui/toast";
import { Price } from "@/components/ui/price";
import { SectionHeader } from "@/components/ui/section-header";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/design/empty-state";

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
      <div className="max-w-lg mx-auto px-4 py-20">
        <EmptyState
          icon="wishlist"
          title="قائمة أمنياتك فارغة"
          description="احفظ المنتجات التي تعجبك لتتمكن من طلبها لاحقاً"
          actionLabel="استكشف المنتجات"
          actionHref="/catalog"
        />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <PageHeader
        title="قائمة أمنياتي"
        subtitle={`${itemCount} ${itemCount === 1 ? "منتج" : "منتجات"}`}
        icon={<Heart className="w-6 h-6 text-primary" />}
        action={
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
        }
      />

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
              <Price
                price={items.reduce(
                  (sum, item) =>
                    sum +
                    Number(
                      item.product.discount_price ?? item.product.price
                    ),
                  0
                )}
                size="sm"
                className="inline-flex"
              />
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
            <div className="absolute top-2 left-2 z-10 bg-black/50 text-white text-tiny px-2 py-1 rounded-full">
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

                <div className="mt-2">
                  <Price
                    price={product.price}
                    discount_price={product.discount_price}
                    size="sm"
                  />
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
        <SectionHeader
          title="قد يعجبك أيضاً"
          subtitle="أضف منتجات جديدة واكتشف المزيد من المنتجات المميزة"
          viewAllHref="/catalog"
        />
      </section>
      {confirm.dialog}
    </div>
  );
}
