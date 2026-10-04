"use client";

import { useCallback, useMemo } from "react";
import {
  CheckCircle2,
  Minus,
  Package,
  Plus,
  ShoppingCart,
  Store,
} from "lucide-react";
import {
  useCartActions,
  useCartState,
} from "@/contexts/cart-context";
import type { ChatProductResult } from '@/lib/catalog';

const priceFormatter = new Intl.NumberFormat("ar-SA", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/**
 * Product cards inside the AI chat. Each card has an inline + / −
 * stepper so the user can adjust the quantity (or remove the item)
 * without leaving the conversation. Cart state is the single source
 * of truth — if the user added this product earlier from any other
 * surface, the stepper starts at that quantity.
 */
export function ChatProductResults({
  products,
}: {
  products: ChatProductResult[];
}) {
  const { addItem, updateQuantity, removeItem } = useCartActions();
  const { items } = useCartState();

  // Map cart key → quantity for the products in this card. The cart
  // composite key is (productId, vendorId) so the same product from
  // two different vendors is treated as two separate cart lines.
  const quantityByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const key = `${item.product.id}::${item.vendor_id ?? ""}`;
      map.set(key, (map.get(key) ?? 0) + item.quantity);
    }
    return map;
  }, [items]);

  const handleAdd = useCallback(
    (product: ChatProductResult) => {
      // addItem needs the full Product shape. We only have the
      // ChatProductResult fields on the client, so we synthesise a
      // minimal Product. The cart context only reads id, vendor_id,
      // vendor_name, name_ar, price, discount_price from it.
      addItem(
        {
          id: product.productId,
          name_ar: product.name,
          price: product.displayPrice,
          discount_price:
            product.originalPrice !== null &&
            product.originalPrice > product.displayPrice
              ? product.originalPrice
              : null,
          vendor_id: product.vendorId,
          vendor_name: product.vendorName,
        } as never,
        1,
        {
          vendor_id: product.vendorId,
          vendor_name: product.vendorName,
          vendor_slug: null,
        }
      );
    },
    [addItem]
  );

  const handleSub = useCallback(
    (product: ChatProductResult) => {
      const key = `${product.productId}::${product.vendorId ?? ""}`;
      const current = quantityByKey.get(key) ?? 0;
      if (current <= 1) {
        removeItem(product.productId, product.vendorId);
        return;
      }
      updateQuantity(product.productId, current - 1, product.vendorId);
    },
    [quantityByKey, removeItem, updateQuantity]
  );

  const totalCount = products.length;
  const inCartCount = products.filter(
    (p) => (quantityByKey.get(`${p.productId}::${p.vendorId ?? ""}`) ?? 0) > 0
  ).length;

  return (
    <section
      className="space-y-2"
      aria-label="المنتجات المطابقة"
      aria-live="polite"
    >
      {inCartCount > 0 && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-primary-200/80 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-800"
        >
          <ShoppingCart className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            في السلة الآن {inCartCount} من {totalCount} منتج
          </span>
        </div>
      )}

      <div className="grid gap-2">
        {products.map((product, index) => {
          const key = `${product.productId}::${product.vendorId ?? ""}`;
          const inCart = quantityByKey.get(key) ?? 0;
          return (
            <article
              key={`${product.productId}-${product.query}-${index}`}
              className="flex min-w-0 items-center gap-3 rounded-2xl border border-gray-100 bg-white p-2.5 shadow-sm shadow-gray-900/[0.04] animate-scale-in"
              style={{
                animationDelay: `${Math.min(index, 5) * 70}ms`,
                animationFillMode: "both",
              }}
            >
              <a
                href={`/products/${product.productId}`}
                aria-label={`${product.name}، السعر ${priceFormatter.format(product.displayPrice)} ريال`}
                className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary-50 to-amber-50 ring-1 ring-black/[0.04] transition hover:ring-primary/30"
              >
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    loading="lazy"
                    className="h-full w-full object-contain p-1"
                  />
                ) : (
                  <Package className="h-6 w-6 text-primary/50" aria-hidden="true" />
                )}
                {inCart > 0 && (
                  <span className="absolute -bottom-1 -left-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-tiny font-black text-white shadow-sm">
                    {inCart}
                  </span>
                )}
              </a>

              <div className="min-w-0 flex-1">
                <a
                  href={`/products/${product.productId}`}
                  className="line-clamp-2 text-xs font-bold leading-5 text-secondary hover:text-primary"
                >
                  {product.name}
                </a>
                {(product.unit || product.vendorName) && (
                  <p className="mt-0.5 flex min-w-0 items-center gap-1 text-tiny text-gray-500">
                    {product.vendorName && (
                      <Store className="h-3 w-3 shrink-0 text-primary/70" aria-hidden="true" />
                    )}
                    <span className="truncate">
                      {[product.unit, product.vendorName].filter(Boolean).join(" · ")}
                    </span>
                  </p>
                )}
                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="text-sm font-black text-primary">
                    {priceFormatter.format(product.displayPrice)} ر.س
                  </span>
                  {product.originalPrice !== null && (
                    <span className="text-tiny text-gray-400 line-through">
                      {priceFormatter.format(product.originalPrice)}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSub(product)}
                  aria-label={`إنقاص كمية ${product.name}`}
                  disabled={inCart === 0}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <span
                  aria-live="polite"
                  className="min-w-5 text-center text-xs font-black tabular-nums text-secondary"
                >
                  {inCart}
                </span>
                <button
                  type="button"
                  onClick={() => handleAdd(product)}
                  aria-label={`زيادة كمية ${product.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white shadow-sm shadow-primary/25 transition hover:-translate-y-0.5 hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {inCartCount === totalCount && totalCount > 0 && (
        <div className="flex items-center justify-center gap-1.5 rounded-xl bg-primary/5 px-3 py-2 text-2xs font-semibold text-primary">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          تمت إضافة جميع المنتجات المقترحة للسلة
        </div>
      )}
    </section>
  );
}