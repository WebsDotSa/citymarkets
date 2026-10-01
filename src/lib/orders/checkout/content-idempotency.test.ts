import { describe, it, expect } from "vitest";
import {
  deriveContentIdempotencyKey,
  IDEMPOTENCY_WINDOW_MS,
} from "./content-idempotency";

describe("deriveContentIdempotencyKey — PCP-83", () => {
  const fixedNow = new Date("2026-10-01T12:34:56.789Z");

  it("returns null when the cart is empty", () => {
    const key = deriveContentIdempotencyKey({
      cart: { items: [], vendor_groups: [] },
      caller: { userId: "u1", sessionId: null },
      now: fixedNow,
    });
    expect(key).toBeNull();
  });

  it("returns null when there is no caller identity (no user, session, or phone)", () => {
    const key = deriveContentIdempotencyKey({
      cart: { items: [{ product_id: "p1", quantity: 1 }] },
      caller: { userId: null, sessionId: null, guestPhone: null },
      now: fixedNow,
    });
    expect(key).toBeNull();
  });

  it("collapses two identical cart submissions in the same minute to the same key", () => {
    // Same identity, same cart, two `now()`s 5s apart — both fall in
    // the same 60-second window starting at 12:34:00.000Z.
    const k1 = deriveContentIdempotencyKey({
      cart: {
        items: [{ product_id: "p1", quantity: 2 }],
        vendor_groups: [
          {
            vendor_id: "v1",
            items: [{ product_id: "vp1", quantity: 1 }],
          },
        ],
      },
      caller: { userId: "u-1", sessionId: null },
      now: new Date("2026-10-01T12:34:05.000Z"),
    });
    const k2 = deriveContentIdempotencyKey({
      cart: {
        items: [{ product_id: "p1", quantity: 2 }],
        vendor_groups: [
          {
            vendor_id: "v1",
            items: [{ product_id: "vp1", quantity: 1 }],
          },
        ],
      },
      caller: { userId: "u-1", sessionId: null },
      now: new Date("2026-10-01T12:34:45.000Z"),
    });
    expect(k1).not.toBeNull();
    expect(k1).toBe(k2);
  });

  it("produces a different key when the cart changes within the same minute", () => {
    const k1 = deriveContentIdempotencyKey({
      cart: { items: [{ product_id: "p1", quantity: 2 }] },
      caller: { userId: "u-1", sessionId: null },
      now: fixedNow,
    });
    const k2 = deriveContentIdempotencyKey({
      cart: { items: [{ product_id: "p1", quantity: 3 }] }, // qty changed
      caller: { userId: "u-1", sessionId: null },
      now: fixedNow,
    });
    expect(k1).not.toBe(k2);
  });

  it("produces a different key when the caller identity changes", () => {
    const cart = { items: [{ product_id: "p1", quantity: 1 }] };
    const u1 = deriveContentIdempotencyKey({
      cart,
      caller: { userId: "u-1", sessionId: null },
      now: fixedNow,
    });
    const u2 = deriveContentIdempotencyKey({
      cart,
      caller: { userId: "u-2", sessionId: null },
      now: fixedNow,
    });
    expect(u1).not.toBe(u2);
  });

  it("produces a different key for guest users with different sessions in the same minute", () => {
    const cart = { items: [{ product_id: "p1", quantity: 1 }] };
    const a = deriveContentIdempotencyKey({
      cart,
      caller: { userId: null, sessionId: "sess-aaa", guestPhone: "0500000001" },
      now: fixedNow,
    });
    const b = deriveContentIdempotencyKey({
      cart,
      caller: { userId: null, sessionId: "sess-bbb", guestPhone: "0500000002" },
      now: fixedNow,
    });
    expect(a).not.toBe(b);
  });

  it("produces a different key across the 60-second window boundary", () => {
    const k1 = deriveContentIdempotencyKey({
      cart: { items: [{ product_id: "p1", quantity: 1 }] },
      caller: { userId: "u-1", sessionId: null },
      now: new Date("2026-10-01T12:34:59.999Z"),
    });
    const k2 = deriveContentIdempotencyKey({
      cart: { items: [{ product_id: "p1", quantity: 1 }] },
      caller: { userId: "u-1", sessionId: null },
      // 1ms into the next minute — different truncation bucket.
      now: new Date("2026-10-01T12:35:00.000Z"),
    });
    expect(k1).not.toBe(k2);
  });

  it("canonicalises cart line order — item ordering does not change the key", () => {
    // The client may emit items in any order (React state updates
    // are not deterministic). Sorting inside the helper means two
    // semantically-identical carts hash to the same key.
    const a = deriveContentIdempotencyKey({
      cart: {
        items: [{ product_id: "p1", quantity: 1 }],
        vendor_groups: [
          {
            vendor_id: "v2",
            items: [{ product_id: "vp-b", quantity: 3 }],
          },
          {
            vendor_id: "v1",
            items: [{ product_id: "vp-a", quantity: 2 }],
          },
        ],
      },
      caller: { userId: "u-1", sessionId: null },
      now: fixedNow,
    });
    const b = deriveContentIdempotencyKey({
      cart: {
        items: [{ product_id: "p1", quantity: 1 }],
        vendor_groups: [
          {
            vendor_id: "v1",
            items: [{ product_id: "vp-a", quantity: 2 }],
          },
          {
            vendor_id: "v2",
            items: [{ product_id: "vp-b", quantity: 3 }],
          },
        ],
      },
      caller: { userId: "u-1", sessionId: null },
      now: fixedNow,
    });
    expect(a).toBe(b);
  });

  it("returns a 64-char hex string (sha256)", () => {
    const key = deriveContentIdempotencyKey({
      cart: { items: [{ product_id: "p1", quantity: 1 }] },
      caller: { userId: "u-1", sessionId: null },
      now: fixedNow,
    });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("truncates the window at the start of the containing minute", () => {
    // Boundary: now = 12:34:00.000 is the first ms of minute 12:34.
    // Both 12:34:00.000 and 12:34:59.999 fall in the same bucket.
    const kStart = deriveContentIdempotencyKey({
      cart: { items: [{ product_id: "p1", quantity: 1 }] },
      caller: { userId: "u-1", sessionId: null },
      now: new Date("2026-10-01T12:34:00.000Z"),
    });
    const kEnd = deriveContentIdempotencyKey({
      cart: { items: [{ product_id: "p1", quantity: 1 }] },
      caller: { userId: "u-1", sessionId: null },
      now: new Date("2026-10-01T12:34:59.999Z"),
    });
    expect(kStart).toBe(kEnd);

    // The next minute is a fresh bucket.
    const kNext = deriveContentIdempotencyKey({
      cart: { items: [{ product_id: "p1", quantity: 1 }] },
      caller: { userId: "u-1", sessionId: null },
      now: new Date("2026-10-01T12:35:00.000Z"),
    });
    expect(kEnd).not.toBe(kNext);
  });

  it("IDEMPOTENCY_WINDOW_MS is 60_000 ms", () => {
    expect(IDEMPOTENCY_WINDOW_MS).toBe(60_000);
  });
});