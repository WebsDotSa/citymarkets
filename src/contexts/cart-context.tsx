"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CartItem, Product } from "@/lib/types";
import { apiFetch } from '@/lib/catalog';
import {
  productCartKey,
  vendorFieldsFromProduct,
} from '@/lib/catalog';
import { trackAddToCart } from "@/lib/ga-events";

// -------- State slice --------
interface CartStateValue {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  isHydrated: boolean;
}

const CartStateContext = createContext<CartStateValue | null>(null);

// -------- Actions slice (stable identity, never re-creates) --------
//
// Slice 2 (multi-vendor marketplace): cart actions now operate on the
// composite (vendor_id, product_id) identity so the cart can hold two
// products that share a UUID across different vendors. The legacy single-
// arity signatures (productId only) are still supported — they match
// against the City Markets vendor (or the only vendor in the item) for
// backward compatibility with existing call sites.
interface CartActionsValue {
  addItem: (
    product: Product,
    quantity?: number,
    vendorInfo?: { vendor_id?: string | null; vendor_slug?: string | null; vendor_name?: string | null },
  ) => void;
  removeItem: (productId: string, vendorId?: string | null) => void;
  updateQuantity: (productId: string, quantity: number, vendorId?: string | null) => void;
  clearCart: () => void;
}

const CartActionsContext = createContext<CartActionsValue | null>(null);

// -------- Combined (for backward compatibility) --------
interface CartContextType extends CartStateValue {
  addItem: CartActionsValue["addItem"];
  removeItem: CartActionsValue["removeItem"];
  updateQuantity: CartActionsValue["updateQuantity"];
  clearCart: CartActionsValue["clearCart"];
}

const CartContext = createContext<CartContextType | null>(null);

const CART_STORAGE_KEY = "city_market_cart";

/**
 * Backfill `vendor_id` / `vendor_slug` / `vendor_name` on a cart item
 * using the canonical product-source helpers. Items that pre-date
 * Slice 2 (no vendor info anywhere) default to the City Markets
 * pseudo-vendor — keeps the catalog checkout path working unchanged.
 */
function normalizeVendorInfo(
  item: CartItem,
  override?: { vendor_id?: string | null; vendor_slug?: string | null; vendor_name?: string | null },
): CartItem {
  const fromProduct = vendorFieldsFromProduct(item.product);
  const merged = {
    vendor_id: override?.vendor_id ?? item.vendor_id ?? fromProduct.vendor_id ?? null,
    vendor_slug:
      override?.vendor_slug ?? item.vendor_slug ?? fromProduct.vendor_slug ?? null,
    vendor_name:
      override?.vendor_name ?? item.vendor_name ?? fromProduct.vendor_name ?? null,
  };
  return {
    ...item,
    vendor_id: merged.vendor_id,
    vendor_slug: merged.vendor_slug,
    vendor_name: merged.vendor_name,
  };
}

/**
 * Normalize every persisted cart row on load so legacy carts (pre-
 * Slice 2) get vendor fields filled in from their embedded product and
 * any item lacking vendor info defaults to the City Markets pseudo-
 * vendor. Returns a fresh array — no mutation.
 */
function normalizeCart(items: CartItem[]): CartItem[] {
  return items.map((item) => normalizeVendorInfo(item));
}

/**
 * Match a cart item to a (vendorId, productId) tuple. Accepts:
 *   - an explicit vendorId (preferred)
 *   - null / undefined → matches the item's recorded vendor_id (or
 *     falls back to the City Markets pseudo-vendor for legacy items)
 *
 * Used by removeItem / updateQuantity. The composite key MUST match
 * `productCartKey` so duplicate products across vendors don't collide.
 */
function matchesCompositeKey(
  item: CartItem,
  productId: string,
  vendorId: string | null | undefined,
): boolean {
  if (item.product.id !== productId) return false;
  const itemKey = productCartKey(item.product.id, item.vendor_id ?? item.product.vendor_id);
  const queryKey = productCartKey(productId, vendorId ?? item.vendor_id ?? item.product.vendor_id);
  return itemKey === queryKey;
}

// Pre-flight: drop items whose product.id is not a valid UUID. Stale carts
// (from before the products_unified migration or from a corrupt row) used
// to pass non-UUID ids into the checkout Zod schema, producing the
// "معرّف غير صالح" error on /checkout/pay. Filtering here keeps the cart
// self-healing across schema changes.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function loadCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(CART_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    // Drop any item whose product.id is not a valid UUID. These are
    // leftovers from older schemas (legacy `products` table, admin CSV
    // imports, or corrupt rows) that would otherwise fail
    // `multiVendorCheckoutSchema` with "معرّف غير صالح" on /checkout/pay.
    const cleaned = parsed.filter(
      (i: CartItem) => i && i.product && isUuid(i.product.id)
    );
    if (cleaned.length !== parsed.length) {
      // Persist the cleaned cart so we don't keep filtering the same junk.
      try {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cleaned));
      } catch {
        // ignore quota / private mode failures
      }
    }
    // Slice 2: normalise legacy rows so vendor fields are populated
    // before any consumer reads them. Backwards compatible — items
    // without vendor info get the City Markets pseudo-vendor.
    return normalizeCart(cleaned as CartItem[]);
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  // Start empty on the server AND on first client render — the real cart
  // is loaded from localStorage in an effect below. This avoids the
  // hydration mismatch where SSR returns `[]` and the client returns the
  // persisted cart, forcing every cart consumer to re-render.
  const [items, setItems] = useState<CartItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setItems(loadCart());
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (isHydrated) {
      saveCart(items);
    }
  }, [items, isHydrated]);

  // Stable action identity — these never change across renders, so
  // components that only consume actions don't re-render when the
  // cart items change.
  const actionsRef = useRef<CartActionsValue | null>(null);
  if (!actionsRef.current) {
    actionsRef.current = {
      addItem: (product, quantity = 1, vendorInfo) => {
        const nextItem: CartItem = normalizeVendorInfo(
          { product, quantity },
          vendorInfo,
        );
        setItems((prev) => {
          const matchKey = productCartKey(
            nextItem.product.id,
            nextItem.vendor_id,
          );
          const existing = prev.find(
            (i) =>
              productCartKey(
                i.product.id,
                i.vendor_id ?? i.product.vendor_id,
              ) === matchKey,
          );
          if (existing) {
            return prev.map((i) =>
              productCartKey(
                i.product.id,
                i.vendor_id ?? i.product.vendor_id,
              ) === matchKey
                ? { ...i, quantity: i.quantity + quantity }
                : i
            );
          }
          return [...prev, nextItem];
        });

        // Google Analytics 4 — add_to_cart. Fire after the React state
        // commit so we always report what the user actually sees in the
        // cart bar (existing quantity + delta, not the original click).
        const unitPrice = Number(
          product.discount_price ?? product.price ?? 0,
        );
        trackAddToCart({
          currency: "SAR",
          value: unitPrice * quantity,
          items: [
            {
              item_id: product.id,
              item_name: product.name_ar ?? product.name_en ?? product.id,
              price: unitPrice,
              quantity,
              item_category: vendorInfo?.vendor_name ?? undefined,
            },
          ],
        });
      },
      removeItem: (productId, vendorId) => {
        setItems((prev) =>
          prev.filter((i) => !matchesCompositeKey(i, productId, vendorId))
        );
      },
      updateQuantity: (productId, quantity, vendorId) => {
        if (quantity <= 0) {
          actionsRef.current?.removeItem(productId, vendorId);
          return;
        }
        setItems((prev) =>
          prev.map((i) =>
            matchesCompositeKey(i, productId, vendorId) ? { ...i, quantity } : i
          )
        );
      },
      clearCart: () => {
        setItems([]);
        // Keep server cart in sync — without this DELETE call the DB
        // row survives and reappears on the next session sync.
        void apiFetch("/api/v1/cart", { method: "DELETE" }).catch(() => {});
      },
    };
  }

  const itemCount = useMemo(
    () => items.reduce((sum, i) => sum + i.quantity, 0),
    [items]
  );

  const subtotal = useMemo(
    () =>
      items.reduce(
        (sum, i) =>
          sum + (Number(i.product.discount_price) || Number(i.product.price)) * i.quantity,
        0
      ),
    [items]
  );

  // State slice — only re-creates when the cart data actually changes.
  const stateValue = useMemo<CartStateValue>(
    () => ({ items, itemCount, subtotal, isHydrated }),
    [items, itemCount, subtotal, isHydrated]
  );

  // Combined slice for legacy consumers (`useCart()`). It still bundles
  // state + actions so they re-render on every change, matching the
  // previous behaviour. Prefer `useCartState()` / `useCartActions()` for
  // new code.
  const combinedValue = useMemo<CartContextType>(
    () => ({
      ...stateValue,
      addItem: actionsRef.current!.addItem,
      removeItem: actionsRef.current!.removeItem,
      updateQuantity: actionsRef.current!.updateQuantity,
      clearCart: actionsRef.current!.clearCart,
    }),
    [stateValue]
  );

  return (
    <CartActionsContext.Provider value={actionsRef.current}>
      <CartStateContext.Provider value={stateValue}>
        <CartContext.Provider value={combinedValue}>
          {children}
        </CartContext.Provider>
      </CartStateContext.Provider>
    </CartActionsContext.Provider>
  );
}

// -------- Optimized hooks for new code --------

/** Read-only cart data — re-renders only when items/count/subtotal change. */
export function useCartState(): CartStateValue {
  const ctx = useContext(CartStateContext);
  if (!ctx) throw new Error("useCartState must be used within CartProvider");
  return ctx;
}

/** Cart mutation actions — stable identity, no re-renders from cart data. */
export function useCartActions(): CartActionsValue {
  const ctx = useContext(CartActionsContext);
  if (!ctx) throw new Error("useCartActions must be used within CartProvider");
  return ctx;
}

/** Header-badge-only consumer — re-renders only when count changes. */
export function useCartItemCount(): number {
  return useCartState().itemCount;
}

// -------- Backward-compatible combined hook --------

/**
 * @deprecated Prefer `useCartState()` + `useCartActions()` for new code.
 * Returns the combined value so every state change re-renders this
 * consumer — kept for backward compatibility with existing call sites.
 */
export function useCart(): CartContextType {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}