"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { Product } from "@/lib/types";

interface WishlistItem {
  product: Product;
  addedAt: number;
}

interface WishlistStateValue {
  items: WishlistItem[];
  itemCount: number;
  loading: boolean;
}

interface WishlistActionsValue {
  addItem: (product: Product) => { ok: boolean; reason?: "already_present" | "full" };
  removeItem: (productId: string) => void;
  isInWishlist: (productId: string) => boolean;
  toggleItem: (product: Product) => { ok: boolean; reason?: "already_present" | "full"; removed?: boolean };
  clearWishlist: () => void;
}

interface WishlistContextValue extends WishlistStateValue, WishlistActionsValue {}

const WishlistStateContext = createContext<WishlistStateValue | null>(null);
const WishlistActionsContext = createContext<WishlistActionsValue | null>(null);
const WishlistContext = createContext<WishlistContextValue | null>(null);

const STORAGE_KEY = "citymarket_wishlist";
const MAX_WISHLIST_SIZE = 50;

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as WishlistItem[];
        setItems(parsed);
      }
    } catch (error) {
      console.error("Failed to load wishlist:", error);
    }
    setLoading(false);
    setIsHydrated(true);
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
      console.error("Failed to save wishlist:", error);
    }
  }, [items, isHydrated]);

  const addItem = useCallback((product: Product): { ok: boolean; reason?: "already_present" | "full" } => {
    if (items.some((item) => item.product.id === product.id)) {
      return { ok: false, reason: "already_present" };
    }
    if (items.length >= MAX_WISHLIST_SIZE) {
      return { ok: false, reason: "full" };
    }
    setItems((prev) => [...prev, { product, addedAt: Date.now() }]);
    return { ok: true };
  }, [items]);

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((item) => item.product.id !== productId));
  }, []);

  const isInWishlist = useCallback(
    (productId: string) => items.some((item) => item.product.id === productId),
    [items]
  );

  const toggleItem = useCallback(
    (product: Product): { ok: boolean; reason?: "already_present" | "full"; removed?: boolean } => {
      if (isInWishlist(product.id)) {
        removeItem(product.id);
        return { ok: true, removed: true };
      }
      return addItem(product);
    },
    [isInWishlist, removeItem, addItem]
  );

  const clearWishlist = useCallback(() => {
    setItems([]);
  }, []);

  const stateValue = useMemo<WishlistStateValue>(
    () => ({ items, itemCount: items.length, loading }),
    [items, loading]
  );

  const actionsValue = useMemo<WishlistActionsValue>(
    () => ({
      addItem,
      removeItem,
      isInWishlist,
      toggleItem,
      clearWishlist,
    }),
    [addItem, removeItem, isInWishlist, toggleItem, clearWishlist]
  );

  const combinedValue = useMemo<WishlistContextValue>(
    () => ({ ...stateValue, ...actionsValue }),
    [stateValue, actionsValue]
  );

  return (
    <WishlistActionsContext.Provider value={actionsValue}>
      <WishlistStateContext.Provider value={stateValue}>
        <WishlistContext.Provider value={combinedValue}>
          {children}
        </WishlistContext.Provider>
      </WishlistStateContext.Provider>
    </WishlistActionsContext.Provider>
  );
}

export function useWishlistState(): WishlistStateValue {
  const context = useContext(WishlistStateContext);
  if (!context) {
    throw new Error("useWishlistState must be used within a WishlistProvider");
  }
  return context;
}

export function useWishlistActions(): WishlistActionsValue {
  const context = useContext(WishlistActionsContext);
  if (!context) {
    throw new Error("useWishlistActions must be used within a WishlistProvider");
  }
  return context;
}

/**
 * @deprecated Prefer `useWishlistState()` and `useWishlistActions()` for new code.
 */
export function useWishlist(): WishlistContextValue {
  const context = useContext(WishlistContext);
  if (!context) {
    throw new Error("useWishlist must be used within a WishlistProvider");
  }
  return context;
}
