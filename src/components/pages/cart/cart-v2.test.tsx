import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

/**
 * Regression tests for the cart → wishlist move action (D9 fix).
 *
 * Pre-fix: the "نقل للمفضلة" button on each cart row was a disabled
 * placeholder. The fix wires the button to a handler composed at the
 * page level:
 *
 *   1. Try `useWishlistActions().addItem(product)` FIRST. If it
 *      returns `{ok:false, reason: "already_present" | "full"}`,
 *      surface the toast and leave the cart untouched — never
 *      silently lose the user's only copy of the item.
 *   2. Only after a successful add, call
 *      `useCart().removeItem(productId, vendorId)` so the composite
 *      (vendor_id, product_id) key matches the multi-vendor cart.
 *
 * These tests pin down the contract: success removes from cart and
 * toasts "success", already_present toasts "info" and leaves the
 * cart alone, full toasts "warning" and leaves the cart alone, and
 * the composite vendor_id is forwarded to removeItem so a multi-
 * vendor cart can't accidentally hit the wrong row.
 */

// ─── Hoisted mocks ─────────────────────────────────────────────────────
const { removeItemMock, addItemMock, showToastMock, useRouter } = vi.hoisted(() => ({
  removeItemMock: vi.fn(),
  addItemMock: vi.fn(),
  showToastMock: vi.fn(),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock("@/contexts/cart-context", () => ({
  useCart: () => ({
    items: [],
    itemCount: 0,
    subtotal: 0,
    isHydrated: true,
    updateQuantity: vi.fn(),
    removeItem: removeItemMock,
    clearCart: vi.fn(),
    addItem: vi.fn(),
  }),
}));

vi.mock("@/contexts/wishlist-context", () => ({
  useWishlistActions: () => ({
    addItem: addItemMock,
    removeItem: vi.fn(),
    isInWishlist: vi.fn(() => false),
    toggleItem: vi.fn(),
    clearWishlist: vi.fn(),
  }),
  useWishlistState: () => ({ items: [], itemCount: 0, loading: false }),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuthState: () => ({ user: { id: "u-1", phone: "+966500000000" } }),
}));

vi.mock("@/contexts/delivery-location-context", () => ({
  useDeliveryLocationState: () => ({ selectedAddress: null }),
  useDeliveryLocationActions: () => ({ openSheet: vi.fn() }),
}));

vi.mock("@/hooks/use-delivery-quote", () => ({
  useDeliveryQuote: () => ({
    fee: 0,
    serviceFee: 0,
    tax: 0,
    needsAddress: true,
    quote: { fee: 0, serviceFee: 0, tax: 0 },
  }),
}));

vi.mock("@/components/ui/toast", async () => {
  const actual =
    await vi.importActual<typeof import("@/components/ui/toast")>(
      "@/components/ui/toast",
    );
  return {
    ...actual,
    useToast: () => ({ showToast: showToastMock }),
  };
});

vi.mock("@/lib/catalog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/catalog")>(
    "@/lib/catalog",
  );
  return {
    ...actual,
    apiFetch: vi.fn().mockResolvedValue({ data: [] }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => useRouter(),
}));

vi.mock("@/lib/csrf-client", () => ({
  csrfFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }),
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
});

import { CartV2 } from "./cart-v2";
import type { CartItem } from "@/lib/types";

const baseItem: CartItem = {
  product: {
    id: "11111111-1111-1111-1111-111111111111",
    category_id: "c-1",
    name_ar: "منتج اختبار",
    name_en: "Test Product",
    slug: "test-product",
    description: null,
    image_url: null,
    images: [],
    price: 10,
    discount_price: null,
    stock_qty: 100,
    is_active: true,
    sku: null,
    barcode: null,
    unit: undefined,
    vendor_id: null,
  } as unknown as CartItem["product"],
  quantity: 1,
  vendor_id: "v-1",
  vendor_slug: null,
  vendor_name: null,
};

// We mock the cart-context to return a controlled cart per-test. The
// tests that need a populated cart re-define the mock in `beforeEach`
// below via a `vi.doMock`-style swap (since vi.mock is hoisted, we
// swap on the module returned from `useCart` via a mutable reference).
const cartState = {
  items: [] as CartItem[],
  itemCount: 0,
  subtotal: 0,
  isHydrated: true,
};
vi.mock("@/contexts/cart-context", () => ({
  useCart: () => ({
    ...cartState,
    updateQuantity: vi.fn(),
    removeItem: removeItemMock,
    clearCart: vi.fn(),
    addItem: vi.fn(),
  }),
}));

beforeEach(() => {
  cartState.items = [];
  cartState.itemCount = 0;
  cartState.subtotal = 0;
  removeItemMock.mockReset();
  addItemMock.mockReset();
  showToastMock.mockReset();
});

describe("Cart → Wishlist move action (D9)", () => {
  it("clicking the heart button calls wishlist addItem with the cart item's product", async () => {
    cartState.items = [baseItem];
    cartState.itemCount = 1;
    cartState.subtotal = 10;
    addItemMock.mockReturnValueOnce({ ok: true });

    render(<CartV2 />);
    const btn = screen.getByTestId(`move-to-wishlist-${baseItem.product.id}`);
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(addItemMock).toHaveBeenCalledTimes(1);
    expect(addItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: baseItem.product.id }),
    );
  });

  it("successful move removes the item from the cart with the composite vendor key + success toast", async () => {
    cartState.items = [baseItem];
    cartState.itemCount = 1;
    cartState.subtotal = 10;
    addItemMock.mockReturnValueOnce({ ok: true });

    render(<CartV2 />);
    const btn = screen.getByTestId(`move-to-wishlist-${baseItem.product.id}`);
    await act(async () => {
      fireEvent.click(btn);
    });

    // Composite key forwarded so multi-vendor carts don't collide.
    expect(removeItemMock).toHaveBeenCalledWith(
      baseItem.product.id,
      baseItem.vendor_id,
    );
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining("نقل"),
      "success",
    );
  });

  it("already_present: info toast and does NOT remove from cart", async () => {
    cartState.items = [baseItem];
    cartState.itemCount = 1;
    cartState.subtotal = 10;
    addItemMock.mockReturnValueOnce({ ok: false, reason: "already_present" });

    render(<CartV2 />);
    const btn = screen.getByTestId(`move-to-wishlist-${baseItem.product.id}`);
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(removeItemMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining("موجود"),
      "info",
    );
  });

  it("full: warning toast and does NOT remove from cart", async () => {
    cartState.items = [baseItem];
    cartState.itemCount = 1;
    cartState.subtotal = 10;
    addItemMock.mockReturnValueOnce({ ok: false, reason: "full" });

    render(<CartV2 />);
    const btn = screen.getByTestId(`move-to-wishlist-${baseItem.product.id}`);
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(removeItemMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining("ممتلئة"),
      "warning",
    );
  });

  it("composite vendor_id is forwarded to removeItem when item has vendor_id", async () => {
    const itemWithVendor: CartItem = {
      ...baseItem,
      product: {
        ...baseItem.product,
        id: "22222222-2222-2222-2222-222222222222",
      },
      vendor_id: "v-third-party",
    };
    cartState.items = [itemWithVendor];
    cartState.itemCount = 1;
    cartState.subtotal = 10;
    addItemMock.mockReturnValueOnce({ ok: true });

    render(<CartV2 />);
    const btn = screen.getByTestId(`move-to-wishlist-${itemWithVendor.product.id}`);
    await act(async () => {
      fireEvent.click(btn);
    });

    // The composite (vendor_id, product_id) key is what removeItem
    // uses to disambiguate. Passing null would hit the wrong row in
    // a multi-vendor cart.
    expect(removeItemMock).toHaveBeenCalledWith(
      itemWithVendor.product.id,
      "v-third-party",
    );
  });
});
