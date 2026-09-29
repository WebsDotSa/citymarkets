import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ADDRESS_LABELS,
  GUEST_KEY_STORAGE,
  ADDRESSES_STORAGE,
  SELECTED_ADDRESS_STORAGE,
  DEFAULT_MAP_CENTER,
  isPersistedAddressId,
  getOrCreateGuestKey,
  loadLocalAddresses,
  saveLocalAddresses,
  getSelectedAddressId,
  setSelectedAddressId,
  shortAddressLabel,
  type DeliveryAddress,
} from "./delivery-address";

describe("ADDRESS_LABELS", () => {
  it("includes all four label types: home, work, rest, other", () => {
    const types = ADDRESS_LABELS.map((l) => l.type);
    expect(types).toContain("home");
    expect(types).toContain("work");
    expect(types).toContain("rest");
    expect(types).toContain("other");
  });

  it("every entry has a non-empty label and an icon", () => {
    for (const l of ADDRESS_LABELS) {
      expect(l.label.length).toBeGreaterThan(0);
      expect(l.icon.length).toBeGreaterThan(0);
    }
  });
});

describe("storage keys + map center", () => {
  it("exports distinct storage keys for guest / addresses / selected", () => {
    const keys = new Set([
      GUEST_KEY_STORAGE,
      ADDRESSES_STORAGE,
      SELECTED_ADDRESS_STORAGE,
    ]);
    expect(keys.size).toBe(3);
  });

  it("the default map center is Riyadh (24.7136, 46.6753)", () => {
    expect(DEFAULT_MAP_CENTER).toEqual({ lat: 24.7136, lng: 46.6753 });
  });
});

describe("isPersistedAddressId", () => {
  it("returns false for null/undefined/empty", () => {
    expect(isPersistedAddressId(null)).toBe(false);
    expect(isPersistedAddressId(undefined)).toBe(false);
    expect(isPersistedAddressId("")).toBe(false);
  });

  it("returns false for browser-only local_* ids (not server-issued)", () => {
    expect(isPersistedAddressId("local_123")).toBe(false);
    expect(isPersistedAddressId("local_anything-here")).toBe(false);
  });

  it("returns true for valid UUIDs (server-issued ids are UUIDs)", () => {
    expect(isPersistedAddressId("550e8400-e29b-41d4-a716-446655440000")).toBe(
      true,
    );
  });

  it("returns true for numeric legacy ids", () => {
    expect(isPersistedAddressId("42")).toBe(true);
    expect(isPersistedAddressId("123456")).toBe(true);
  });

  it("returns false for malformed strings", () => {
    expect(isPersistedAddressId("not-a-uuid")).toBe(false);
    expect(isPersistedAddressId("12345abc")).toBe(false);
    expect(isPersistedAddressId("123_456")).toBe(false);
  });
});

describe("localStorage-backed helpers (browser-only)", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    // jsdom isn't installed; stub localStorage manually so the helpers run.
    // The helpers check `typeof window === "undefined"` first; we set up a
    // minimal `window` so those checks pass.
    (globalThis as unknown as { window: unknown }).window = {};
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        store = {};
      },
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  });

  describe("getOrCreateGuestKey", () => {
    it("returns a key and persists it", () => {
      const key = getOrCreateGuestKey();
      expect(key.length).toBeGreaterThan(0);
      expect(store[GUEST_KEY_STORAGE]).toBe(key);
    });

    it("returns the same key on subsequent calls (no churn)", () => {
      const k1 = getOrCreateGuestKey();
      const k2 = getOrCreateGuestKey();
      expect(k2).toBe(k1);
    });

    it("returns '' when window is undefined (SSR)", () => {
      // Temporarily unset window for this single assertion
      const savedWindow = (globalThis as { window: unknown }).window;
      delete (globalThis as { window?: unknown }).window;
      try {
        expect(getOrCreateGuestKey()).toBe("");
      } finally {
        (globalThis as { window: unknown }).window = savedWindow;
      }
    });

    it("falls back to a timestamped random key when crypto.randomUUID is missing", () => {
      // Force the fallback by removing randomUUID temporarily.
      // `crypto` is a non-writable getter on globalThis in modern Node, so
      // we use Object.defineProperty to swap it for the duration of the
      // assertion and restore it afterwards.
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "crypto",
      );
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: undefined,
      });
      try {
        const k = getOrCreateGuestKey();
        // Fallback format: `guest_<timestamp>_<random>`
        expect(k).toMatch(/^guest_\d+_[a-z0-9]+$/);
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(globalThis, "crypto", originalDescriptor);
        } else {
          delete (globalThis as Record<string, unknown>)["crypto"];
        }
      }
    });
  });

  describe("loadLocalAddresses / saveLocalAddresses", () => {
    it("returns an empty array when no addresses are saved", () => {
      expect(loadLocalAddresses()).toEqual([]);
    });

    it("round-trips an address list through saveLocalAddresses → loadLocalAddresses", () => {
      const list: DeliveryAddress[] = [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          label: "المنزل",
          labelType: "home",
          lat: 24.7,
          lng: 46.7,
          address_text: "حي العليا",
          is_default: true,
        },
      ];
      saveLocalAddresses(list);
      expect(loadLocalAddresses()).toEqual(list);
    });

    it("returns [] on invalid JSON (graceful fallback)", () => {
      store[ADDRESSES_STORAGE] = "{not valid json";
      expect(loadLocalAddresses()).toEqual([]);
    });

    it("returns [] when window is undefined", () => {
      const savedWindow = (globalThis as { window: unknown }).window;
      delete (globalThis as { window?: unknown }).window;
      try {
        expect(loadLocalAddresses()).toEqual([]);
      } finally {
        (globalThis as { window: unknown }).window = savedWindow;
      }
    });

    it("saveLocalAddresses is a no-op on the server", () => {
      const savedWindow = (globalThis as { window: unknown }).window;
      delete (globalThis as { window?: unknown }).window;
      try {
        // Should not throw and should not mutate anything
        saveLocalAddresses([]);
      } finally {
        (globalThis as { window: unknown }).window = savedWindow;
      }
    });
  });

  describe("getSelectedAddressId / setSelectedAddressId", () => {
    it("returns null when nothing is selected", () => {
      expect(getSelectedAddressId()).toBeNull();
    });

    it("round-trips a selected id", () => {
      setSelectedAddressId("550e8400-e29b-41d4-a716-446655440000");
      expect(getSelectedAddressId()).toBe(
        "550e8400-e29b-41d4-a716-446655440000",
      );
    });

    it("returns null on the server", () => {
      const savedWindow = (globalThis as { window: unknown }).window;
      delete (globalThis as { window?: unknown }).window;
      try {
        expect(getSelectedAddressId()).toBeNull();
      } finally {
        (globalThis as { window: unknown }).window = savedWindow;
      }
    });

    it("setSelectedAddressId is a no-op on the server", () => {
      const savedWindow = (globalThis as { window: unknown }).window;
      delete (globalThis as { window?: unknown }).window;
      try {
        setSelectedAddressId("anything");
      } finally {
        (globalThis as { window: unknown }).window = savedWindow;
      }
    });
  });
});

describe("shortAddressLabel", () => {
  const base: DeliveryAddress = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    label: "المنزل",
    labelType: "home",
    lat: 24.7,
    lng: 46.7,
    address_text: "حي العليا، شارع الملك فهد، الرياض",
    is_default: true,
  };

  it("returns the placeholder when address is null", () => {
    expect(shortAddressLabel(null)).toBe("تحديد الموقع");
  });

  it("returns the address text unchanged when it's short", () => {
    const short = { ...base, address_text: "حي العليا" };
    expect(shortAddressLabel(short)).toBe("حي العليا");
  });

  it("truncates addresses longer than 28 chars with an ellipsis", () => {
    // 'حي العليا، شارع الملك فهد، الرياض' is > 28 chars
    const out = shortAddressLabel(base);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(28); // 26 chars + "…"
  });

  it("trims surrounding whitespace before measuring length", () => {
    const padded = { ...base, address_text: "   حي العليا   " };
    expect(shortAddressLabel(padded)).toBe("حي العليا");
  });
});

// Suppress the unused-import warning for `vi` if all asserts above don't need it.
// The `vi` import is reserved for future test extensions.
void vi;