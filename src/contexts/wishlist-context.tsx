"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { Product } from "@/lib/types";
import { useAuthState } from "@/contexts/auth-context";
import { apiFetch } from "@/lib/catalog";

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
  addItem: (product: Product) => {
    ok: boolean;
    reason?: "already_present" | "full" | "server_error";
  };
  removeItem: (productId: string) => void;
  isInWishlist: (productId: string) => boolean;
  toggleItem: (product: Product) => {
    ok: boolean;
    reason?: "already_present" | "full" | "server_error";
    removed?: boolean;
  };
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
  // get their own per-user bucket. The authenticated bucket is now a
  // legacy artifact (the server is the source of truth for signed-in
  // users) but is kept around so the migration shim still has a place
  // to land pre-existing data.
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

function writeBucket(
  userId: string | undefined | null,
  items: WishlistItem[],
): void {
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

/** Shape of a single row returned by `GET /api/v1/wishlist`. The
 *  service joins `products_unified` + `vendors` so the client doesn't
 *  have to do a second round-trip. */
interface ServerWishlistProduct {
  id: string;
  name: string;
  name_ar: string | null;
  slug: string;
  price: number;
  discount_price: number | null;
  image_url: string | null;
  vendor_id: string;
  vendor_name: string | null;
  vendor_slug: string | null;
  is_active: boolean;
  stock_qty: number | null;
}

interface ServerWishlistItem {
  product_id: string;
  added_at: string;
  product: ServerWishlistProduct;
}

interface ServerWishlistListResponse {
  success: boolean;
  data: ServerWishlistItem[];
  count: number;
}

/**
 * Convert a server wishlist row into the client-side shape the React
 * tree consumes. The `Product` literal only carries the fields the
 * wishlist UI reads — full hydration (variants, categories) happens
 * lazily on the product detail page.
 */
function serverItemToClient(item: ServerWishlistItem): WishlistItem {
  const product: Product = {
    id: item.product.id,
    name_ar: item.product.name_ar ?? item.product.name,
    name_en: item.product.name,
    slug: item.product.slug,
    description: null,
    image_url: item.product.image_url,
    images: item.product.image_url ? [item.product.image_url] : [],
    price: Number(item.product.price ?? 0),
    discount_price:
      item.product.discount_price != null
        ? Number(item.product.discount_price)
        : null,
    stock_qty:
      item.product.stock_qty != null ? Number(item.product.stock_qty) : 0,
    is_active: item.product.is_active,
    category_id: "",
    vendor_id: item.product.vendor_id,
    vendor_slug: item.product.vendor_slug ?? null,
    vendor_name: item.product.vendor_name ?? null,
  } as Product;
  const addedAt = item.added_at ? Date.parse(item.added_at) : Date.now();
  return { product, addedAt: Number.isFinite(addedAt) ? addedAt : Date.now() };
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthState();
  const userId = user?.id;

  // Track the previous identity so we can detect the transitions the
  // spec calls out (guest→authed = merge bucket; authed→authed = wipe
  // + refetch). Kept in a ref so the hydration effect doesn't depend
  // on a state update to compute transitions.
  const previousUserIdRef = useRef<string | undefined>(undefined);

  // Per-user monotonic request id. Mutations bump this on entry; a
  // late-resolving mutation whose id is no longer current is silently
  // dropped (avoids revert-after-newer-mutation races when the user
  // adds two items in quick succession).
  const requestIdRef = useRef(0);

  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);

  // Hydrate whenever the identity changes. The branch taken depends on
  // whether we have a signed-in user:
  //   - guest  → synchronous localStorage read (no API calls)
  //   - authed → async server fetch, with a one-shot merge of any
  //     guest bucket the browser accumulated before sign-in
  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    const transitioningFromGuest =
      previousUserId === undefined && typeof userId === "string";
    const transitioningBetweenAuthed =
      typeof previousUserId === "string" &&
      typeof userId === "string" &&
      previousUserId !== userId;

    let cancelled = false;

    // Always run the legacy-key migration. The shim is a one-time
    // cleanup that uses the sessionStorage flag to avoid repeating
    // itself, so calling it on every identity change costs nothing
    // after the first run and keeps the migration behaviour identical
    // to the pre-server-backed implementation.
    migrateLegacyWishlist(userId);

    async function hydrateAuthed(): Promise<void> {
      // 1. Guest → authed transition: replay the guest bucket into the
      //    server. Best-effort: server caps at MAX_WISHLIST_SIZE so any
      //    overflow items are dropped (their responses are ignored).
      if (transitioningFromGuest) {
        const guestBucket = readBucket(null);
        if (guestBucket && guestBucket.length > 0) {
          for (const guestItem of guestBucket) {
            try {
              await apiFetch<ServerWishlistItem>("/api/v1/wishlist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ product_id: guestItem.product.id }),
              });
            } catch {
              /* best-effort: skip items we couldn't push */
            }
          }
          writeBucket(null, []);
        }
      }

      if (cancelled) return;

      // 2. Authed → authed transition: wipe local state so we don't
      //    surface User A's items while the server fetch for User B
      //    is in flight.
      if (transitioningBetweenAuthed) {
        setItems([]);
      }

      // 3. Fetch the canonical list from the server. We use the same
      //    apiFetch helper as the rest of the catalog so the request
      //    carries the CSRF header + session cookie automatically.
      try {
        const result = await apiFetch<ServerWishlistListResponse>(
          "/api/v1/wishlist",
          { method: "GET" },
        );
        if (cancelled) return;
        if (result && result.success && Array.isArray(result.data?.data)) {
          setItems(result.data.data.map(serverItemToClient));
        } else {
          setItems([]);
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setIsHydrated(true);
        }
      }
    }

    if (!userId) {
      // Guest path: synchronous localStorage hydration, no API calls.
      const loaded = readBucket(userId);
      setItems(loaded ?? []);
      setLoading(false);
      setIsHydrated(true);
    } else {
      // Authed path: server is the source of truth. Surface
      // loading=true until the fetch resolves so the UI can show a
      // skeleton instead of an empty list.
      setLoading(true);
      setIsHydrated(true);
      void hydrateAuthed();
    }

    previousUserIdRef.current = userId;

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Guest-only persistence. The server is the source of truth for
  // signed-in users, so we deliberately skip the write for them —
  // mirroring their state into localStorage would just be a stale
  // cache that the next mount immediately overwrites.
  useEffect(() => {
    if (!isHydrated) return;
    if (userId) return;
    writeBucket(userId, items);
  }, [items, isHydrated, userId]);

  const addItem = useCallback(
    (product: Product): {
      ok: boolean;
      reason?: "already_present" | "full" | "server_error";
    } => {
      if (items.some((item) => item.product.id === product.id)) {
        return { ok: false, reason: "already_present" };
      }
      if (items.length >= MAX_WISHLIST_SIZE) {
        return { ok: false, reason: "full" };
      }

      const snapshot = items;
      const requestId = ++requestIdRef.current;
      setItems((prev) => [...prev, { product, addedAt: Date.now() }]);

      if (!userId) {
        // Guest: localStorage write effect persists this. The sync
        // return preserves the existing action signature so callers
        // like cart-v2.moveToWishlist can keep branching on result.ok.
        return { ok: true };
      }

      // Authed: optimistic add is already committed to state. Fire
      // the server confirmation in the background and revert on
      // failure. Returning { ok: true } immediately keeps the action
      // synchronous — the caller can rely on the result without
      // awaiting, matching the contract from the localStorage-only
      // implementation.
      void (async () => {
        try {
          const result = await apiFetch<ServerWishlistItem>(
            "/api/v1/wishlist",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ product_id: product.id }),
            },
          );
          if (requestId !== requestIdRef.current) return;
          if (!result || !result.success) {
            setItems(snapshot);
          }
        } catch {
          if (requestId === requestIdRef.current) {
            setItems(snapshot);
          }
        }
      })();

      return { ok: true };
    },
    [items, userId],
  );

  const removeItem = useCallback(
    (productId: string): void => {
      const snapshot = items;
      const requestId = ++requestIdRef.current;
      setItems((prev) => prev.filter((item) => item.product.id !== productId));

      if (!userId) return;

      void (async () => {
        try {
          const result = await apiFetch<{ removed: number }>(
            `/api/v1/wishlist?product_id=${encodeURIComponent(productId)}`,
            { method: "DELETE" },
          );
          if (requestId !== requestIdRef.current) return;
          if (!result || !result.success) {
            setItems(snapshot);
          }
        } catch {
          if (requestId === requestIdRef.current) {
            setItems(snapshot);
          }
        }
      })();
    },
    [items, userId],
  );

  const isInWishlist = useCallback(
    (productId: string) => items.some((item) => item.product.id === productId),
    [items],
  );

  const toggleItem = useCallback(
    (product: Product): {
      ok: boolean;
      reason?: "already_present" | "full" | "server_error";
      removed?: boolean;
    } => {
      if (isInWishlist(product.id)) {
        removeItem(product.id);
        return { ok: true, removed: true };
      }
      return addItem(product);
    },
    [isInWishlist, removeItem, addItem],
  );

  const clearWishlist = useCallback((): void => {
    const snapshot = items;
    const requestId = ++requestIdRef.current;
    setItems([]);

    if (!userId) return;

    // DELETE with no product_id param tells the route to wipe all rows
    // for the current user — see /api/v1/wishlist DELETE handler.
    void (async () => {
      try {
        const result = await apiFetch<{ removed: number }>(
          "/api/v1/wishlist",
          { method: "DELETE" },
        );
        if (requestId !== requestIdRef.current) return;
        if (!result || !result.success) {
          setItems(snapshot);
        }
      } catch {
        if (requestId === requestIdRef.current) {
          setItems(snapshot);
        }
      }
    })();
  }, [items, userId]);

  const stateValue = useMemo<WishlistStateValue>(
    () => ({ items, itemCount: items.length, loading }),
    [items, loading],
  );

  const actionsValue = useMemo<WishlistActionsValue>(
    () => ({
      addItem,
      removeItem,
      isInWishlist,
      toggleItem,
      clearWishlist,
    }),
    [addItem, removeItem, isInWishlist, toggleItem, clearWishlist],
  );

  const combinedValue = useMemo<WishlistContextValue>(
    () => ({ ...stateValue, ...actionsValue }),
    [stateValue, actionsValue],
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
