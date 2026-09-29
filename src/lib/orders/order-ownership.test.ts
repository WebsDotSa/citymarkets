/**
 * Tests for src/lib/order-ownership.ts — the positive ownership proof
 * for /api/v1/orders/[id]/* endpoints.
 *
 * SECURITY (F1): the legacy negative check
 *
 *   if (order.user_id && order.user_id !== userId) → 403
 *
 * silently allowed any caller through on guest orders (user_id IS NULL).
 * The new helper REQUIRES explicit proof for both branches:
 *   - Logged-in: order.user_id === userId
 *   - Guest:     order.idempotency_key === providedKey
 */
import { describe, expect, it, vi } from "vitest";

import {
  assertOrderOwnership,
  idempotencyKeyFromBody,
  idempotencyKeyFromQuery,
} from "./order-ownership";

function makeClient(row: unknown) {
  return {
    query: vi.fn(async () => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 })),
  };
}

const GUEST_KEY = "guest-secret-key-must-be-64-chars-or-fewer-aaaaaaaaaaaaaaaa";

describe("assertOrderOwnership — logged-in orders", () => {
  it("allows the matching user", async () => {
    const client = makeClient({
      user_id: "user-1",
      status: "pending",
      idempotency_key: null,
    });
    const r = await assertOrderOwnership({
      orderId: "ord-1",
      userId: "user-1",
      providedIdempotencyKey: null,
      client: client as never,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.userId).toBe("user-1");
      expect(r.status).toBe("pending");
    }
  });

  it("rejects a different user (the FORMER failure mode — only blocked if user_id matched)", async () => {
    const client = makeClient({
      user_id: "user-1",
      status: "pending",
      idempotency_key: null,
    });
    const r = await assertOrderOwnership({
      orderId: "ord-1",
      userId: "user-2",
      providedIdempotencyKey: null,
      client: client as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(403);
  });

  it("rejects an anonymous caller hitting a logged-in order", async () => {
    const client = makeClient({
      user_id: "user-1",
      status: "pending",
      idempotency_key: null,
    });
    const r = await assertOrderOwnership({
      orderId: "ord-1",
      userId: null,
      providedIdempotencyKey: null,
      client: client as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(403);
  });
});

describe("assertOrderOwnership — guest orders", () => {
  it("allows with matching idempotency_key", async () => {
    const client = makeClient({
      user_id: null,
      status: "pending",
      idempotency_key: GUEST_KEY,
    });
    const r = await assertOrderOwnership({
      orderId: "ord-2",
      userId: null,
      providedIdempotencyKey: GUEST_KEY,
      client: client as never,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.userId).toBeNull();
      expect(r.status).toBe("pending");
    }
  });

  it("REJECTS without an idempotency_key (the legacy bypass)", async () => {
    // SECURITY: this is the regression the audit caught. The old
    // `if (order.user_id && ...)` skipped any check when user_id was
    // NULL — i.e., on every guest order. The new helper must reject.
    const client = makeClient({
      user_id: null,
      status: "pending",
      idempotency_key: GUEST_KEY,
    });
    const r = await assertOrderOwnership({
      orderId: "ord-2",
      userId: null,
      providedIdempotencyKey: null,
      client: client as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(403);
  });

  it("rejects a wrong idempotency_key", async () => {
    const client = makeClient({
      user_id: null,
      status: "pending",
      idempotency_key: GUEST_KEY,
    });
    const r = await assertOrderOwnership({
      orderId: "ord-2",
      userId: null,
      providedIdempotencyKey: "wrong-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      client: client as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(403);
  });

  it("rejects a same-length-but-different key (catches off-by-one brute force)", async () => {
    const client = makeClient({
      user_id: null,
      status: "pending",
      idempotency_key: GUEST_KEY,
    });
    // 60 chars but every character differs from the stored key.
    const wrong = GUEST_KEY.split("").map((c) => (c === "a" ? "b" : "a")).join("");
    const r = await assertOrderOwnership({
      orderId: "ord-2",
      userId: null,
      providedIdempotencyKey: wrong,
      client: client as never,
    });
    expect(r.ok).toBe(false);
  });

  it("ignores provided key for logged-in orders (JWT is authoritative)", async () => {
    const client = makeClient({
      user_id: "user-1",
      status: "pending",
      idempotency_key: "anything",
    });
    const r = await assertOrderOwnership({
      orderId: "ord-3",
      userId: "user-1",
      providedIdempotencyKey: "wrong-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      client: client as never,
    });
    expect(r.ok).toBe(true);
  });
});

describe("assertOrderOwnership — missing order", () => {
  it("returns 404", async () => {
    const client = makeClient(null);
    const r = await assertOrderOwnership({
      orderId: "ord-missing",
      userId: "user-1",
      providedIdempotencyKey: null,
      client: client as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(404);
  });
});

describe("idempotencyKeyFromBody / FromQuery helpers", () => {
  it("reads a valid key from body", () => {
    expect(idempotencyKeyFromBody({ idempotency_key: "abc12345" })).toBe("abc12345");
  });
  it("trims whitespace", () => {
    expect(idempotencyKeyFromBody({ idempotency_key: "  abc12345  " })).toBe("abc12345");
  });
  it("returns null on missing/wrong-type/empty/too-long", () => {
    expect(idempotencyKeyFromBody({})).toBeNull();
    expect(idempotencyKeyFromBody({ idempotency_key: 123 })).toBeNull();
    expect(idempotencyKeyFromBody({ idempotency_key: "" })).toBeNull();
    expect(idempotencyKeyFromBody({ idempotency_key: "x".repeat(65) })).toBeNull();
    expect(idempotencyKeyFromBody(null)).toBeNull();
    expect(idempotencyKeyFromBody("string")).toBeNull();
  });
  it("reads from query string `key` and `idempotency_key`", () => {
    const u1 = new URL("https://x/?key=abc12345");
    expect(idempotencyKeyFromQuery(u1)).toBe("abc12345");
    const u2 = new URL("https://x/?idempotency_key=abc12345");
    expect(idempotencyKeyFromQuery(u2)).toBe("abc12345");
    const u3 = new URL("https://x/");
    expect(idempotencyKeyFromQuery(u3)).toBeNull();
  });
});
