import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Wishlist context — regression + new server-backed coverage.
 *
 * The original implementation used a single global
 * `citymarket_wishlist` localStorage key. After User A signed out
 * and User B signed in on the same browser, User B would see User
 * A's products because the load effect never re-keyed on user change.
 *
 * The first fix (D4) namespaced the storage key per user identity.
 * The follow-up (this branch) moves the source of truth for signed-in
 * users to the server (`/api/v1/wishlist`) so the wishlist follows the
 * user across devices and sign-in/sign-out cycles. Anonymous browsing
 * keeps the localStorage bucket — the migration shim still protects
 * pre-fix data.
 *
 * Tests cover:
 *   1. Each guest gets the localStorage guest bucket (D4 — still
 *      valid; the migration only changed behaviour for authed users).
 *   2. Legacy single-key data is migrated exactly once (D4
 *      follow-up).
 *   3. signOut / authed→guest surfaces an empty list without
 *      touching the server (D5).
 *   4. Authed users hydrate from the server on mount and during
 *      identity transitions (new behaviour).
 *   5. addItem / removeItem / clearWishlist POST/DELETE optimistically
 *      and revert on server failure.
 *   6. Guest → authed merge replays the guest bucket into the server
 *      before the canonical GET (new behaviour).
 *   7. Authed → authed wipes local state before refetching (new
 *      behaviour, prevents cross-user bleed-through during the
 *      fetch window).
 */

// We mock the auth context so the test can drive the user identity
// directly without booting the real Supabase client.
const mockUseAuthState = vi.fn();
vi.mock("@/contexts/auth-context", () => ({
  useAuthState: () => mockUseAuthState(),
}));

// Mock the API client. Each test sets `mocks.apiFetch` to a function
// that records calls and returns a controllable response shape.
const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getCalls: () => mocks.apiFetch.mock.calls,
}));

vi.mock("@/lib/catalog", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/catalog")>("@/lib/catalog");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
  };
});

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

/**
 * Build a server-shaped wishlist row. The server hydrates each entry
 * with name/price/image/vendor so the client can render the list
 * without a second round-trip.
 */
function makeServerItem(productId: string) {
  return {
    product_id: productId,
    added_at: new Date().toISOString(),
    product: {
      id: productId,
      name: `Server Product ${productId}`,
      name_ar: `منتج ${productId}`,
      slug: productId,
      price: 10,
      discount_price: null,
      image_url: null,
      vendor_id: "v-1",
      vendor_name: "vendor",
      vendor_slug: "vendor",
      is_active: true,
      stock_qty: 100,
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  mockUseAuthState.mockReturnValue({ user: null });
  // Default: a successful empty wishlist. Tests override per-case.
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockResolvedValue({
    success: true,
    data: { success: true, data: [], count: 0 },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Guest behaviour (localStorage, no API calls) ──────────────────────

describe("WishlistProvider — guest (anonymous) localStorage bucket", () => {
  it("hydrates an anonymous user from the guest bucket", async () => {
    window.localStorage.setItem(
      "citymarket_wishlist:guest",
      JSON.stringify([{ product: makeProduct("p-1"), addedAt: 1 }]),
    );

    mockUseAuthState.mockReturnValue({ user: null });
    const { result } = renderHook(() => useWishlistState(), {
      wrapper: withWishlist,
    });
    await act(async () => {});

    expect(result.current.itemCount).toBe(1);
    expect(result.current.items[0].product.id).toBe("p-1");
    expect(result.current.loading).toBe(false);
    // No API calls were made for the guest path.
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it("writes to the guest bucket when no user is signed in", async () => {
    mockUseAuthState.mockReturnValue({ user: null });

    const { result } = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist },
    );
    await act(async () => {});

    act(() => {
      result.current.actions.addItem(makeProduct("p-1"));
    });

    expect(window.localStorage.getItem("citymarket_wishlist")).toBeNull();
    const guest = window.localStorage.getItem("citymarket_wishlist:guest");
    expect(guest).not.toBeNull();
    const parsed = JSON.parse(guest!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].product.id).toBe("p-1");
  });

  it("does not call the wishlist API for an anonymous user", async () => {
    mockUseAuthState.mockReturnValue({ user: null });

    const { result } = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist },
    );
    await act(async () => {});

    act(() => {
      result.current.actions.addItem(makeProduct("p-1"));
      result.current.actions.addItem(makeProduct("p-2"));
      result.current.actions.removeItem("p-1");
      result.current.actions.clearWishlist();
    });

    // No mutations should have hit the server while anonymous.
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
});

// ─── Authenticated hydration from the server ───────────────────────────

describe("WishlistProvider — authenticated user hydrates from server", () => {
  it("fetches the wishlist on mount and replaces local state", async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      success: true,
      data: {
        success: true,
        data: [makeServerItem("p-server-1"), makeServerItem("p-server-2")],
        count: 2,
      },
    });

    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });

    const { result } = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist },
    );

    // Loading should be true while the fetch is in flight.
    // (Note: the fetch resolves in the same tick in this mock, so we
    //  assert the post-fetch state below instead of the in-flight
    //  state.)
    await act(async () => {});

    expect(result.current.state.itemCount).toBe(2);
    expect(result.current.state.items[0].product.id).toBe("p-server-1");
    expect(result.current.state.items[1].product.id).toBe("p-server-2");
    expect(result.current.state.loading).toBe(false);

    // Exactly one GET was issued to /api/v1/wishlist.
    const calls = mocks.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("/api/v1/wishlist");
    expect(calls[0][1]).toEqual({ method: "GET" });
  });

  it("surfaces loading=true while the initial fetch is in flight", async () => {
    // Defer the fetch resolution so we can observe the loading flag.
    let resolveFetch: ((value: unknown) => void) | null = null;
    mocks.apiFetch.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );

    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });
    const { result } = renderHook(() => useWishlistState(), {
      wrapper: withWishlist,
    });

    // Flush the microtask queue so the effect body starts the fetch
    // and setItems / setLoading have run.
    await act(async () => {});

    expect(result.current.loading).toBe(true);

    // Resolve the fetch.
    await act(async () => {
      resolveFetch!({
        success: true,
        data: { success: true, data: [makeServerItem("p-1")], count: 1 },
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.itemCount).toBe(1);
  });

  it("surfaces an empty list when the server returns an error", async () => {
    mocks.apiFetch.mockRejectedValueOnce(new Error("network down"));

    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });
    const { result } = renderHook(() => useWishlistState(), {
      wrapper: withWishlist,
    });
    await act(async () => {});

    expect(result.current.itemCount).toBe(0);
    expect(result.current.loading).toBe(false);
  });
});

// ─── Authenticated mutations ──────────────────────────────────────────

describe("WishlistProvider — authenticated addItem POSTs to server", () => {
  it("optimistically adds and POSTs to the server", async () => {
    mocks.apiFetch.mockResolvedValue({
      success: true,
      data: makeServerItem("p-1"),
    });

    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });

    const { result } = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist },
    );
    await act(async () => {});

    act(() => {
      result.current.actions.addItem(makeProduct("p-1"));
    });

    // Local state reflects the optimistic add immediately.
    expect(result.current.state.itemCount).toBe(1);
    expect(result.current.state.items[0].product.id).toBe("p-1");

    // Let the fire-and-forget POST resolve.
    await act(async () => {});

    const calls = mocks.getCalls();
    const post = calls.find(
      (c) => c[0] === "/api/v1/wishlist" && (c[1] as RequestInit)?.method === "POST",
    );
    expect(post).toBeDefined();
    expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
      product_id: "p-1",
    });
    // Item is still in state — server succeeded.
    expect(result.current.state.itemCount).toBe(1);
  });

  it("reverts the optimistic add on server failure", async () => {
    // Hydration GET → empty list. The POST then fails.
    mocks.apiFetch
      .mockResolvedValueOnce({
        success: true,
        data: { success: true, data: [], count: 0 },
      })
      .mockResolvedValueOnce({
        success: false,
        error: "boom",
      });

    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });
    const { result } = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist },
    );
    await act(async () => {});

    act(() => {
      result.current.actions.addItem(makeProduct("p-1"));
    });

    // Optimistically present.
    expect(result.current.state.itemCount).toBe(1);

    // Server fails → optimistic update is reverted.
    await act(async () => {});
    expect(result.current.state.itemCount).toBe(0);
  });
});

describe("WishlistProvider — authenticated removeItem DELETEs from server", () => {
  it("optimistically removes and DELETEs from the server", async () => {
    // Initial hydration returns one item.
    mocks.apiFetch
      .mockResolvedValueOnce({
        success: true,
        data: { success: true, data: [makeServerItem("p-1")], count: 1 },
      })
      // The DELETE call.
      .mockResolvedValueOnce({ success: true, data: { removed: 1 } });

    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });

    const { result } = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist },
    );
    await act(async () => {});

    expect(result.current.state.itemCount).toBe(1);

    act(() => {
      result.current.actions.removeItem("p-1");
    });

    expect(result.current.state.itemCount).toBe(0);

    await act(async () => {});

    const deleteCall = mocks.getCalls().find((c) => {
      const init = c[1] as RequestInit | undefined;
      return (
        typeof c[0] === "string" &&
        c[0].startsWith("/api/v1/wishlist?") &&
        init?.method === "DELETE"
      );
    });
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0]).toBe("/api/v1/wishlist?product_id=p-1");
  });
});

describe("WishlistProvider — authenticated clearWishlist DELETEs from server", () => {
  it("optimistically clears and DELETEs (no product_id param)", async () => {
    mocks.apiFetch
      .mockResolvedValueOnce({
        success: true,
        data: {
          success: true,
          data: [makeServerItem("p-1"), makeServerItem("p-2")],
          count: 2,
        },
      })
      .mockResolvedValueOnce({ success: true, data: { removed: 2 } });

    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });

    const { result } = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist },
    );
    await act(async () => {});

    expect(result.current.state.itemCount).toBe(2);

    act(() => {
      result.current.actions.clearWishlist();
    });

    expect(result.current.state.itemCount).toBe(0);

    await act(async () => {});

    const deleteCall = mocks.getCalls().find((c) => {
      const init = c[1] as RequestInit | undefined;
      return c[0] === "/api/v1/wishlist" && init?.method === "DELETE";
    });
    expect(deleteCall).toBeDefined();
  });
});

// ─── Identity transitions ──────────────────────────────────────────────

describe("WishlistProvider — guest → authenticated merges guest bucket", () => {
  it("POSTs each guest item to the server, then re-fetches the canonical list", async () => {
    // Seed guest bucket with two items.
    window.localStorage.setItem(
      "citymarket_wishlist:guest",
      JSON.stringify([
        { product: makeProduct("p-guest-1"), addedAt: 1 },
        { product: makeProduct("p-guest-2"), addedAt: 2 },
      ]),
    );

    // 1st call: POST p-guest-1, 2nd: POST p-guest-2, 3rd: GET server list.
    mocks.apiFetch
      .mockResolvedValueOnce({ success: true, data: makeServerItem("p-guest-1") })
      .mockResolvedValueOnce({ success: true, data: makeServerItem("p-guest-2") })
      .mockResolvedValueOnce({
        success: true,
        data: {
          success: true,
          data: [makeServerItem("p-guest-1"), makeServerItem("p-guest-2")],
          count: 2,
        },
      });

    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });
    const { result } = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist },
    );
    await act(async () => {});

    // After the merge + refetch, the list contains the merged items.
    expect(result.current.state.itemCount).toBe(2);
    const ids = result.current.state.items.map((i) => i.product.id).sort();
    expect(ids).toEqual(["p-guest-1", "p-guest-2"]);

    // The guest bucket was cleared (written as an empty array).
    const guest = JSON.parse(
      window.localStorage.getItem("citymarket_wishlist:guest") || "[]",
    );
    expect(guest).toEqual([]);

    // The API was called: 2 POSTs + 1 GET, in that order.
    const calls = mocks.getCalls();
    expect(calls).toHaveLength(3);
    expect(calls[0][0]).toBe("/api/v1/wishlist");
    expect((calls[0][1] as RequestInit).method).toBe("POST");
    expect(JSON.parse((calls[0][1] as RequestInit).body as string)).toEqual({
      product_id: "p-guest-1",
    });
    expect(calls[1][0]).toBe("/api/v1/wishlist");
    expect((calls[1][1] as RequestInit).method).toBe("POST");
    expect(JSON.parse((calls[1][1] as RequestInit).body as string)).toEqual({
      product_id: "p-guest-2",
    });
    expect(calls[2][0]).toBe("/api/v1/wishlist");
    expect((calls[2][1] as RequestInit).method).toBe("GET");
  });

  it("does not merge when the guest bucket is empty", async () => {
    // No guest bucket.
    mocks.apiFetch.mockResolvedValueOnce({
      success: true,
      data: { success: true, data: [makeServerItem("p-server-A")], count: 1 },
    });

    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });
    const { result } = renderHook(() => useWishlistState(), {
      wrapper: withWishlist,
    });
    await act(async () => {});

    expect(result.current.itemCount).toBe(1);
    // Only the GET — no POST merge.
    expect(mocks.getCalls()).toHaveLength(1);
  });
});

describe("WishlistProvider — authenticated → authenticated wipes and re-fetches", () => {
  it("clears Alice's items from state when Bob signs in on the same browser", async () => {
    // Hydration for Alice.
    mocks.apiFetch.mockResolvedValueOnce({
      success: true,
      data: { success: true, data: [makeServerItem("p-alice-1")], count: 1 },
    });

    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });
    const aliceView = renderHook(() => useWishlistState(), {
      wrapper: withWishlist,
    });
    await act(async () => {});
    expect(aliceView.result.current.itemCount).toBe(1);

    // Switch to Bob — his hydration is mocked to return different items.
    mocks.apiFetch.mockResolvedValueOnce({
      success: true,
      data: { success: true, data: [makeServerItem("p-bob-1"), makeServerItem("p-bob-2")], count: 2 },
    });
    mockUseAuthState.mockReturnValue({ user: { id: "bob" } });
    aliceView.rerender();
    await act(async () => {});

    // Bob's items appear, not Alice's.
    expect(aliceView.result.current.itemCount).toBe(2);
    const ids = aliceView.result.current.items.map((i) => i.product.id).sort();
    expect(ids).toEqual(["p-bob-1", "p-bob-2"]);

    aliceView.unmount();
  });
});

describe("WishlistProvider — authenticated → guest surfaces empty state", () => {
  it("shows the guest bucket (empty) after sign-out, without hitting the server", async () => {
    // Hydration for Alice.
    mocks.apiFetch.mockResolvedValueOnce({
      success: true,
      data: { success: true, data: [makeServerItem("p-alice-1")], count: 1 },
    });
    mockUseAuthState.mockReturnValue({ user: { id: "alice" } });
    const view = renderHook(() => useWishlistState(), {
      wrapper: withWishlist,
    });
    await act(async () => {});
    expect(view.result.current.itemCount).toBe(1);

    // Sign out → user becomes null. No API call should be made for the
    // guest transition.
    mockUseAuthState.mockReturnValue({ user: null });
    view.rerender();
    await act(async () => {});

    expect(view.result.current.itemCount).toBe(0);
    expect(view.result.current.loading).toBe(false);

    view.unmount();
  });
});

// ─── Legacy key migration (still applies for guest + authed users) ───

describe("WishlistProvider — legacy key migration (D4 follow-up)", () => {
  it("migrates legacy single-key data into the guest bucket on first hydration", async () => {
    window.localStorage.setItem(
      "citymarket_wishlist",
      JSON.stringify([{ product: makeProduct("p-legacy-1"), addedAt: 1 }]),
    );

    mockUseAuthState.mockReturnValue({ user: null });
    const view = renderHook(
      () => ({
        state: useWishlistState(),
        actions: useWishlistActions(),
      }),
      { wrapper: withWishlist },
    );
    await act(async () => {});

    const guest = JSON.parse(
      window.localStorage.getItem("citymarket_wishlist:guest") || "[]",
    );
    expect(guest).toHaveLength(1);
    expect(guest[0].product.id).toBe("p-legacy-1");
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

    expect(
      window.sessionStorage.getItem("citymarket_wishlist_migrated"),
    ).toBe("1");
  });
});
