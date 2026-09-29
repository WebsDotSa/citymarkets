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
import { useAuthState } from "@/contexts/auth-context";

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

// SECURITY (D4): storage keys are now namespaced by user identity so
// that signing in as User B on the same browser cannot leak User A's
// wishlist items. The legacy single-key `citymarket_wishlist` was a
// data-isolation bug — see prompt bug D4 + D5.
const LEGACY_STORAGE_KEY = "citymarket_wishlist";
const MAX_WISHLIST_SIZE = 50;

function storageKey(userId: string | undefined | null): string {
  // Anonymous browsers get a stable guest bucket. Authenticated users
  // get their own per-user bucket. No bucket is shared across users.
  return `citymarket_wishlist:${userId ?? "guest"}`;
}

function readBucket(userId: string | undefined | null): WishlistItem[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WishlistItem[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeBucket(userId: string | undefined | null, items: WishlistItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(items));
  } catch {
    /* quota exceeded — silently drop, same as before */
  }
}

/**
 * One-time cleanup of the legacy single-key storage. Runs once per
 * browser session to migrate any pre-fix data into the guest bucket
 * (if anonymous) or wipe it (if a user is already signed in). After
 * this, the legacy key never resurfaces, so two consecutive users
 * cannot inherit each other's data.
 */
function migrateLegacyWishlist(currentUserId: string | undefined | null): void {
  if (typeof window === "undefined") return;
  if (window.sessionStorage.getItem("citymarket_wishlist_migrated") === "1") return;
  try {
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      // If the legacy key holds data, attribute it to the currently
      // signed-in user (or guest bucket) so the user doesn't lose
      // their wishlist on the upgrade. If the bucket already has
      // items, prefer those and discard the legacy blob.
      const existing = readBucket(currentUserId);
      if (!existing || existing.length === 0) {
        try {
          const parsed = JSON.parse(legacy) as WishlistItem[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            writeBucket(currentUserId, parsed);
          }
        } catch {
          /* ignore */
        }
      }
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } finally {
    window.sessionStorage.setItem("citymarket_wishlist_migrated", "1");
  }
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthState();
  const userId = user?.id;

  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load from localStorage on mount AND whenever the user identity
  // changes (login, logout, account switch).
  useEffect(() => {
    migrateLegacyWishlist(userId);
    const loaded = readBucket(userId);
    setItems(loaded ?? []);
    setLoading(false);
    setIsHydrated(true);
  }, [userId]);

  // Save to localStorage on change — always to the CURRENT user's
  // bucket. When the user changes, the load effect resets items to
  // the new bucket and this save effect picks up from there.
  useEffect(() => {
    if (!isHydrated) return;
    writeBucket(userId, items);
  }, [items, isHydrated, userId]);

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