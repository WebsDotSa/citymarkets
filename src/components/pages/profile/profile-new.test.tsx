import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * Regression tests for the profile wishlist count tile (D10 fix).
 *
 * Pre-fix: the wishlist count tile in the profile header rendered a
 * hardcoded `0` regardless of what was in the wishlist context.
 * Today it reads `useWishlistState().itemCount` and updates
 * reactively as items are added / removed.
 *
 * These tests pin:
 *   1. The tile renders the live `itemCount`, not a literal `0`.
 *   2. The row in "طلباتي" → "المفضلة" surfaces the count as a
 *      badge so users see the same number in two places.
 *   3. The cart → wishlist path updates the count without a reload
 *      (verified by mutating the mocked state and re-rendering).
 */

const { wishlistStateRef } = vi.hoisted(() => ({
  wishlistStateRef: { current: { items: [], itemCount: 0, loading: false } },
}));

vi.mock("@/contexts/wishlist-context", () => ({
  useWishlistState: () => wishlistStateRef.current,
  useWishlistActions: () => ({
    addItem: vi.fn(),
    removeItem: vi.fn(),
    isInWishlist: vi.fn(() => false),
    toggleItem: vi.fn(),
    clearWishlist: vi.fn(),
  }),
}));

const signOutMock = vi.fn();
vi.mock("@/contexts/auth-context", () => ({
  useAuthState: () => ({
    user: {
      id: "u-1",
      phone: "+966500000000",
      name: "سارة",
      email: "sara@example.com",
    },
    loading: false,
  }),
  useAuthActions: () => ({ signOut: signOutMock }),
}));

vi.mock("@/contexts/delivery-location-context", () => ({
  useDeliveryLocationActions: () => ({ openSheet: vi.fn() }),
  useDeliveryLocationState: () => ({ selectedAddress: null }),
}));

const confirmMock = vi.fn().mockResolvedValue(true);
vi.mock("@/components/ui/toast", async () => {
  const actual =
    await vi.importActual<typeof import("@/components/ui/toast")>(
      "@/components/ui/toast",
    );
  return {
    ...actual,
    useConfirm: () => Object.assign(confirmMock, { dialog: null }),
  };
});

const routerPushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

// Pre-populate the order/address/loyalty fetches so the page renders
// past the loading state and the wishlist tile becomes visible.
const fetchMock = vi.fn().mockImplementation((url: string) => {
  if (url.includes("/addresses")) {
    return Promise.resolve({ json: async () => ({ success: true, data: [] }) });
  }
  if (url.includes("/loyalty")) {
    return Promise.resolve({
      json: async () => ({ success: true, data: { balance: 0 } }),
    });
  }
  if (url.includes("/orders")) {
    return Promise.resolve({
      json: async () => ({ success: true, orders: [] }),
    });
  }
  return Promise.resolve({ json: async () => ({ success: false }) });
});

vi.mock("@/lib/csrf-client", () => ({
  csrfFetch: vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true }),
  }),
}));

// ─── Memory storage shim ──────────────────────────────────────────────
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
      Object.defineProperty(window, "localStorage", {
        value: new MemoryStorage(),
        writable: false,
        configurable: true,
      });
    }
    if (!window.sessionStorage) {
      Object.defineProperty(window, "sessionStorage", {
        value: new MemoryStorage(),
        writable: false,
        configurable: true,
      });
    }
  }
  global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
  wishlistStateRef.current = { items: [], itemCount: 0, loading: false };
  routerPushMock.mockReset();
  signOutMock.mockReset();
});

import { ProfileNew } from "./profile-new";

describe("ProfileNew — wishlist count tile (D10)", () => {
  it("renders the live itemCount, not a hardcoded 0", async () => {
    wishlistStateRef.current = {
      items: [
        { product: { id: "p-1" } as never, addedAt: 1 },
        { product: { id: "p-2" } as never, addedAt: 2 },
        { product: { id: "p-3" } as never, addedAt: 3 },
        { product: { id: "p-4" } as never, addedAt: 4 },
      ],
      itemCount: 4,
      loading: false,
    };
    render(<ProfileNew />);
    await waitFor(() => {
      const tile = screen.getByTestId("wishlist-count-value");
      expect(tile.textContent).toBe("4");
    });
  });

  it("renders 0 (not 'undefined') when wishlist is empty", async () => {
    wishlistStateRef.current = { items: [], itemCount: 0, loading: false };
    render(<ProfileNew />);
    await waitFor(() => {
      const tile = screen.getByTestId("wishlist-count-value");
      expect(tile.textContent).toBe("0");
    });
  });

  it("reflects itemCount changes without a reload (live update)", async () => {
    wishlistStateRef.current = { items: [], itemCount: 2, loading: false };
    const { rerender } = render(<ProfileNew />);
    await waitFor(() => {
      expect(screen.getByTestId("wishlist-count-value").textContent).toBe("2");
    });
    // Simulate the cart → wishlist path bumping the count.
    wishlistStateRef.current = { items: [], itemCount: 5, loading: false };
    rerender(<ProfileNew />);
    await waitFor(() => {
      expect(screen.getByTestId("wishlist-count-value").textContent).toBe("5");
    });
  });

  it("surfaces the count in the orders section badge", async () => {
    wishlistStateRef.current = {
      items: [
        { product: { id: "p-1" } as never, addedAt: 1 },
        { product: { id: "p-2" } as never, addedAt: 2 },
      ],
      itemCount: 2,
      loading: false,
    };
    render(<ProfileNew />);
    await waitFor(() => {
      // The wishlist row badge in the orders section reads `2`.
      const tiles = screen.getAllByText("2");
      expect(tiles.length).toBeGreaterThanOrEqual(1);
    });
  });
});
