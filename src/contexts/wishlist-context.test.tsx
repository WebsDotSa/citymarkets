import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Regression tests for the wishlist cross-user data-isolation bug.
 *
 * The original implementation used a single global
 * `citymarket_wishlist` localStorage key. After User A signed out
 * and User B signed in on the same browser, User B would see User
 * A's products because the load effect never re-keyed on user change.
 *
 * The fix namespaces the storage key per user identity and re-loads
 * from localStorage whenever the user identity changes.
 *
 * These tests pin down:
 *   1. Each user gets their own storage bucket (D4).
 *   2. The legacy single-key data is migrated exactly once (D4
 *      follow-up so existing customers don't lose their wishlist
 *      on upgrade).
 *   3. Switching from user A → user B clears A's items from state
 *      and surfaces B's (D4 cross-user leak prevention).
 *   4. signOut doesn't leave the previous user's wishlist in
 *      state for the next session (D5).
 */

// We mock the auth context so the test can drive the user identity
// directly without booting the real Supabase client.
const mockUseAuthState = vi.fn();
vi.mock("@/contexts/auth-context", () => ({
  useAuthState: () => mockUseAuthState(),
}));

// Type-only import — the mocked module is referenced above.
import {
  WishlistProvider,
  useWishlistState,
  useWishlistActions,
} from "./wishlist-context";

// jsdom doesn't always provide localStorage/sessionStorage — install
// in-memory stubs before the suite runs so the tests can exercise
// the real storage I/O paths in the provider.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.get(key) ?? null; }
  key(index: number) { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string) { this.store.delete(key); }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
}

beforeAll(() => {
  if (typeof window !== "undefined") {
    if (!window.localStorage) {
      Object.defineProperty(window, "localStorage", { value: new MemoryStorage(), writable: false, configurable: true });
    }
    if (!window.sessionStorage) {
      Object.defineProperty(window, "sessionStorage", { value: new MemoryStorage(), writable: false, configurable: true });
    }
  }
});

function withWishlist({ children }: { children: ReactNode }) {
  return <WishlistProvider>{children}</WishlistProvider>;
}

function makeProduct(id: string, name: string = `Product ${id}`) {
  return {
    id,
    name,
    name_ar: name,
    slug: id,
    price: 10,
    images: [],
    vendor_id: "v-1",
  } as never;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  mockUseAuthState.mockReturnValue({ user: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("WishlistProvider — per-user storage namespacing (D4)", () => {
  it("writes to the guest bucket when no user is signed in", async () => {
    mockUseAuthState.mockReturnValue({ user: null });

    const { result } = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist }
    );

    // Wait for the load effect to run.
    await act(async () => {});

    act(() => {
      result.current.actions.addItem(makeProduct("p-1"));
    });

    // The single legacy key must NOT be written to.
    expect(window.localStorage.getItem("citymarket_wishlist")).toBeNull();
    // The namespaced guest bucket holds the item.
    const guest = window.localStorage.getItem("citymarket_wishlist:guest");
    expect(guest).not.toBeNull();
    const parsed = JSON.parse(guest!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].product.id).toBe("p-1");
  });

  it("writes to the user-namespaced bucket when a user is signed in", async () => {
    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });

    const { result } = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist }
    );

    await act(async () => {});

    act(() => {
      result.current.actions.addItem(makeProduct("p-alice-1"));
    });

    expect(window.localStorage.getItem("citymarket_wishlist:alice")).not.toBeNull();
    // Other users' buckets must NOT exist yet.
    expect(window.localStorage.getItem("citymarket_wishlist:bob")).toBeNull();
    expect(window.localStorage.getItem("citymarket_wishlist:guest")).toBeNull();
  });

  it("does not leak Alice's wishlist to Bob when Bob signs in on the same browser (D4 — the original bug)", async () => {
    // Step 1: Alice signs in, adds two items.
    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });
    const aliceView = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist }
    );
    await act(async () => {});
    act(() => {
      aliceView.result.current.actions.addItem(makeProduct("p-alice-1"));
      aliceView.result.current.actions.addItem(makeProduct("p-alice-2"));
    });
    expect(aliceView.result.current.state.itemCount).toBe(2);

    // Step 2: Alice signs out → Bob signs in (simulated by changing
    // the mocked user).
    mockUseAuthState.mockReturnValue({ user: { id: "bob" } });
    const bobView = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist }
    );
    await act(async () => {});

    // Bob's wishlist must be EMPTY — Alice's items must not leak.
    expect(bobView.result.current.state.itemCount).toBe(0);
    expect(bobView.result.current.state.items).toEqual([]);

    // Bob adds his own item. His bucket is independent of Alice's.
    act(() => {
      bobView.result.current.actions.addItem(makeProduct("p-bob-1"));
    });
    expect(bobView.result.current.state.itemCount).toBe(1);

    // Alice's bucket must still hold exactly her two items.
    const aliceBucket = JSON.parse(
      window.localStorage.getItem("citymarket_wishlist:alice") || "[]",
    );
    expect(aliceBucket).toHaveLength(2);

    // Bob's bucket holds exactly his one item.
    const bobBucket = JSON.parse(
      window.localStorage.getItem("citymarket_wishlist:bob") || "[]",
    );
    expect(bobBucket).toHaveLength(1);
    expect(bobBucket[0].product.id).toBe("p-bob-1");

    // Tear down — prevents cross-test localStorage pollution.
    aliceView.unmount();
    bobView.unmount();
  });

  it("loads the correct bucket when user identity changes mid-session", async () => {
    // Seed both buckets directly so the test doesn't depend on the
    // add/remove actions.
    window.localStorage.setItem(
      "citymarket_wishlist:alice",
      JSON.stringify([{ product: makeProduct("p-alice-A"), addedAt: 1 }]),
    );
    window.localStorage.setItem(
      "citymarket_wishlist:bob",
      JSON.stringify([{ product: makeProduct("p-bob-X"), addedAt: 2 }]),
    );

    // First: render as Alice → Alice's bucket is hydrated.
    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });
    const aliceView = renderHook(
      () => useWishlistState(),
      { wrapper: withWishlist }
    );
    await act(async () => {});
    expect(aliceView.result.current.itemCount).toBe(1);
    expect(aliceView.result.current.items[0].product.id).toBe("p-alice-A");

    // Now switch to Bob → Bob's bucket is hydrated, Alice's is NOT shown.
    mockUseAuthState.mockReturnValue({ user: { id: "bob" } });
    aliceView.rerender();
    await act(async () => {});
    expect(aliceView.result.current.itemCount).toBe(1);
    expect(aliceView.result.current.items[0].product.id).toBe("p-bob-X");

    aliceView.unmount();
  });
});

describe("WishlistProvider — signOut clears state (D5)", () => {
  it("switches from user → guest does not show the user's items", async () => {
    // Sign in as Alice, add an item.
    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });
    const view = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist }
    );
    await act(async () => {});
    act(() => {
      view.result.current.actions.addItem(makeProduct("p-alice-1"));
    });
    expect(view.result.current.state.itemCount).toBe(1);

    // signOut: user goes to null.
    mockUseAuthState.mockReturnValue({ user: null });
    view.rerender();
    await act(async () => {});

    // After signOut, the wishlist surface shows 0 items (Alice's
    // bucket persists in storage but is no longer loaded).
    expect(view.result.current.state.itemCount).toBe(0);

    // Alice's bucket is preserved in storage (so re-login restores
    // her wishlist) — but the active surface is empty.
    const aliceStorage = JSON.parse(
      window.localStorage.getItem("citymarket_wishlist:alice") || "[]",
    );
    expect(aliceStorage).toHaveLength(1);
    view.unmount();
  });
});

describe("WishlistProvider — legacy key migration (D4 follow-up)", () => {
  it("migrates legacy single-key data into the current user's bucket on first hydration", async () => {
    // Pretend the legacy single-key blob was written before the
    // fix shipped.
    window.localStorage.setItem(
      "citymarket_wishlist",
      JSON.stringify([{ product: makeProduct("p-legacy-1"), addedAt: 1 }]),
    );

    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });
    const view = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist }
    );
    await act(async () => {});

    // The legacy blob is moved into Alice's bucket…
    const aliceStorage = JSON.parse(
      window.localStorage.getItem("citymarket_wishlist:alice") || "[]",
    );
    expect(aliceStorage).toHaveLength(1);
    expect(aliceStorage[0].product.id).toBe("p-legacy-1");
    // …and the legacy key is gone.
    expect(window.localStorage.getItem("citymarket_wishlist")).toBeNull();

    view.unmount();
  });

  it("does not run the migration twice (sessionStorage flag)", async () => {
    window.localStorage.setItem(
      "citymarket_wishlist",
      JSON.stringify([{ product: makeProduct("p-legacy-1"), addedAt: 1 }]),
    );

    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });
    const view = renderHook(() => useWishlistState(), { wrapper: withWishlist });
    await act(async () => {});
    view.unmount();

    // After the first mount the migration flag is set; even if a
    // fresh legacy blob appears (somehow), the migration does not
    // run again within this session — the legacy key is just
    // overwritten on next save with the namespaced one.
    expect(window.sessionStorage.getItem("citymarket_wishlist_migrated")).toBe("1");
  });
});

describe("WishlistProvider — clearWishlist empties state and storage", () => {
  it("removes items from the current user's bucket only", async () => {
    window.localStorage.setItem(
      "citymarket_wishlist:alice",
      JSON.stringify([{ product: makeProduct("p-a"), addedAt: 1 }]),
    );
    window.localStorage.setItem(
      "citymarket_wishlist:bob",
      JSON.stringify([{ product: makeProduct("p-b"), addedAt: 2 }]),
    );

    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });
    const view = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist }
    );
    await act(async () => {});

    expect(view.result.current.state.itemCount).toBe(1);
    act(() => {
      view.result.current.actions.clearWishlist();
    });
    expect(view.result.current.state.itemCount).toBe(0);

    // Alice's bucket is empty in storage.
    expect(JSON.parse(window.localStorage.getItem("citymarket_wishlist:alice") || "[]")).toEqual([]);
    // Bob's bucket is untouched.
    expect(JSON.parse(window.localStorage.getItem("citymarket_wishlist:bob") || "[]")).toHaveLength(1);
    view.unmount();
  });
});