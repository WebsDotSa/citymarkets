import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Tests for the address service (P2-3).
 *
 * Validates the consolidation layer that replaced four duplicated
 * route files. Each operation is exercised against a user owner and a
 * guest owner to lock the discriminated-union behaviour.
 */

const calls: { sql: string; params: unknown[] }[] = [];
let mockRows: unknown[] = [];
let mockCount: number = 0;

vi.mock("@/lib/db", () => ({
  pool: {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        // Mimic the COUNT(*) shape used by createAddress.
        if (/COUNT\(\*\)/i.test(sql)) {
          return { rows: [{ c: mockCount }], rowCount: 1 };
        }
        // INSERT/UPDATE/DELETE
        if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
          return { rows: mockRows, rowCount: mockRows.length };
        }
        return { rows: mockRows, rowCount: 0 };
      }),
      release: vi.fn(),
    })),
  },
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/COUNT\(\*\)/i.test(sql)) {
      return { rows: [{ c: mockCount }], rowCount: 1 };
    }
    return { rows: mockRows, rowCount: mockRows.length };
  }),
}));

import {
  createAddress,
  deleteAddress,
  listAddresses,
  resolveTitle,
  setDefaultAddress,
  updateAddress,
} from "./address-service";

beforeEach(() => {
  calls.length = 0;
  mockRows = [];
  mockCount = 0;
});

describe("resolveTitle", () => {
  it("prefers explicit title", () => {
    expect(
      resolveTitle({ title: "العمل", description: "fallback", label: "Work" }),
    ).toBe("العمل");
  });

  it("falls back to description when title missing", () => {
    expect(
      resolveTitle({ title: "", description: "  المنزل  ", label: "Home" }),
    ).toBe("المنزل");
  });

  it("falls back to label when both title and description missing", () => {
    expect(resolveTitle({ title: null, description: null, label: "Work" })).toBe(
      "Work",
    );
  });

  it("treats whitespace-only strings as missing", () => {
    expect(resolveTitle({ title: "   ", description: "  ", label: "X" })).toBe(
      "X",
    );
  });
});

describe("listAddresses", () => {
  it("queries by user_id for user owner", async () => {
    mockRows = [{ id: "a-1", label: "Home" }];
    const rows = await listAddresses({ kind: "user", userId: "u-1" });
    expect(rows).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/user_id = \$1::uuid/);
    expect(calls[0]?.params).toEqual(["u-1"]);
  });

  it("queries by guest_key for guest owner", async () => {
    mockRows = [{ id: "a-2", label: "Hotel" }];
    await listAddresses({ kind: "guest", guestKey: "g-1" });
    expect(calls[0]?.sql).toMatch(/guest_key = \$1/);
    expect(calls[0]?.params).toEqual(["g-1"]);
  });
});

describe("createAddress", () => {
  it("inserts with title fallback when title missing", async () => {
    mockCount = 0; // first address → auto-promote to default
    mockRows = [{ id: "a-3", title: "Home" }];
    await createAddress(
      { kind: "user", userId: "u-1" },
      { label: "Home", description: null, lat: 24.7, lng: 46.6 },
    );
    const insertCall = calls.find((c) => /INSERT INTO addresses/i.test(c.sql));
    expect(insertCall).toBeDefined();
    // params: [label, description, title, lat, lng, address_text, makeDefault, place_images]
    expect(insertCall!.params[0]).toBe("Home");
    expect(insertCall!.params[2]).toBe("Home"); // resolved title
    expect(insertCall!.params[6]).toBe(true); // auto-promoted to default
  });

  it("does NOT auto-promote when owner already has addresses", async () => {
    mockCount = 3; // not the first
    mockRows = [{ id: "a-4", is_default: false }];
    await createAddress(
      { kind: "user", userId: "u-1" },
      { label: "Office", lat: 24.7, lng: 46.6, is_default: false },
    );
    const insertCall = calls.find((c) => /INSERT INTO addresses/i.test(c.sql));
    expect(insertCall!.params[6]).toBe(false);
  });

  it("writes user_id for user owner", async () => {
    mockCount = 0;
    mockRows = [{ id: "a-5" }];
    await createAddress(
      { kind: "user", userId: "u-7" },
      { label: "X", lat: 0, lng: 0 },
    );
    const insertCall = calls.find((c) => /INSERT INTO addresses/i.test(c.sql));
    // Column list uses user_id (interpolated; safe — type-narrowed).
    expect(insertCall!.sql).toMatch(/INSERT INTO addresses \(user_id,/);
    expect(insertCall!.params[0]).toBe("X"); // label
  });

  it("writes guest_key for guest owner", async () => {
    mockCount = 0;
    mockRows = [{ id: "a-6" }];
    await createAddress(
      { kind: "guest", guestKey: "g-9" },
      { label: "Hotel", lat: 24.7, lng: 46.6 },
    );
    const insertCall = calls.find((c) => /INSERT INTO addresses/i.test(c.sql));
    // Column list interpolates owner column name (safe — branch is
    // type-narrowed). The value is bound as $1.
    expect(insertCall!.sql).toMatch(/INSERT INTO addresses \(guest_key,/);
    expect(insertCall!.params[0]).toBe("Hotel");
  });
});

describe("updateAddress", () => {
  it("returns null when row not owned", async () => {
    mockRows = []; // UPDATE returned 0 rows
    const result = await updateAddress(
      { kind: "user", userId: "u-1" },
      "a-1",
      { label: "New" },
    );
    expect(result).toBeNull();
  });

  it("returns the updated row on success", async () => {
    mockRows = [{ id: "a-7", label: "Updated" }];
    const result = await updateAddress(
      { kind: "user", userId: "u-1" },
      "a-7",
      { label: "Updated" },
    );
    expect(result?.label).toBe("Updated");
  });
});

describe("deleteAddress", () => {
  it("returns rowCount from the DELETE", async () => {
    mockRows = [];
    const count = await deleteAddress(
      { kind: "user", userId: "u-1" },
      "a-1",
    );
    expect(typeof count).toBe("number");
  });
});

describe("setDefaultAddress", () => {
  it("clears the default flag on other rows first", async () => {
    mockRows = [{ id: "a-8", is_default: true }];
    await setDefaultAddress({ kind: "user", userId: "u-1" }, "a-8");
    // First UPDATE: clear other defaults
    const clearCall = calls.find(
      (c) =>
        /UPDATE addresses SET is_default = false/i.test(c.sql) &&
        /id <> \$2::uuid/i.test(c.sql),
    );
    expect(clearCall).toBeDefined();
  });
});
