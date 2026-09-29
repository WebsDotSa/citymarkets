/**
 * Tests for src/lib/payments/event-ledger.ts
 *
 * Idempotency contract (regression guard for migration 073):
 *   - recordPaymentEvent INSERTs (invoice_id, gateway, event_type, raw_payload).
 *   - On UNIQUE violation (23505), returns 'duplicate' (does NOT throw).
 *   - On any other error, throws.
 *   - finalizePaymentEvent UPDATEs status, processed_at, order_id.
 *   - Idempotent finalize: re-running it sets processed_at twice (acceptable;
 *     the row stays at the same terminal status).
 *
 * Mocking strategy: stub a minimal PoolClient shape (.query) so we don't
 * need a live DB connection. Each test specifies the exact pg error
 * shape for the duplicate-violation path to verify the 23505 detection
 * logic in recordPaymentEvent.
 */

import { describe, expect, it, vi } from "vitest";
import {
  recordPaymentEvent,
  finalizePaymentEvent,
} from "./event-ledger";
import type { PoolClient } from "pg";

/** Minimal pg error shape (matches pg's `DatabaseError`). */
function pgError(code: string): Error & { code: string } {
  const e = new Error(`pg error ${code}`) as Error & { code: string };
  e.code = code;
  return e;
}

/** Fake PoolClient that records every query and returns a canned result. */
function fakeClient(handlers: {
  insert?: () => Promise<{ rows: unknown[]; rowCount: number | null }>;
  update?: () => Promise<{ rows: unknown[]; rowCount: number | null }>;
}): PoolClient {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      // dispatch by SQL prefix
      if (/INSERT INTO payment_events/.test(sql)) {
        if (!handlers.insert) throw new Error("unexpected INSERT");
        return handlers.insert();
      }
      if (/UPDATE payment_events/.test(sql)) {
        if (!handlers.update) throw new Error("unexpected UPDATE");
        return handlers.update();
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  } as unknown as PoolClient;
}

describe("event-ledger: recordPaymentEvent", () => {
  it("INSERTs and returns 'inserted' on first call", async () => {
    const insert = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const client = fakeClient({ insert });

    const result = await recordPaymentEvent(client, {
      invoiceId: "inv-123",
      gateway: "moyasar",
      eventType: "payment.paid",
      raw: { id: "inv-123", status: "paid" },
    });

    expect(result).toBe("inserted");
    expect(insert).toHaveBeenCalledOnce();
  });

  it("returns 'duplicate' on UNIQUE violation (23505) without throwing", async () => {
    const insert = vi.fn(async () => {
      throw pgError("23505");
    });
    const client = fakeClient({ insert });

    const result = await recordPaymentEvent(client, {
      invoiceId: "inv-dup",
      gateway: "tamara",
      eventType: "tamara.approved",
      raw: { tamara_order_id: "inv-dup" },
    });

    expect(result).toBe("duplicate");
  });

  it("throws on non-23505 errors (does NOT swallow real DB failures)", async () => {
    const insert = vi.fn(async () => {
      throw pgError("23503"); // foreign_key_violation — real error
    });
    const client = fakeClient({ insert });

    await expect(
      recordPaymentEvent(client, {
        invoiceId: "inv-fk",
        gateway: "moyasar",
        eventType: "payment.paid",
        raw: {},
      }),
    ).rejects.toThrow(/23503/);
  });

  it("throws on non-pg errors (does NOT swallow programmer errors)", async () => {
    const insert = vi.fn(async () => {
      throw new TypeError("not a pg error");
    });
    const client = fakeClient({ insert });

    await expect(
      recordPaymentEvent(client, {
        invoiceId: "inv-x",
        gateway: "moyasar",
        eventType: "payment.paid",
        raw: {},
      }),
    ).rejects.toThrow(TypeError);
  });

  it("pre-serialises object payloads to JSON for the JSONB column", async () => {
    const insert = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const client = fakeClient({ insert });

    await recordPaymentEvent(client, {
      invoiceId: "inv-json",
      gateway: "moyasar",
      eventType: "payment.paid",
      raw: { foo: "bar", nested: { x: 1 } },
    });

    const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const params = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(sql).toMatch(/INSERT INTO payment_events/);
    // 4 params: invoice_id, gateway, event_type, raw_payload (JSON-stringified)
    expect(params).toHaveLength(4);
    expect(params[3]).toBe('{"foo":"bar","nested":{"x":1}}');
  });

  it("passes string payloads through without re-stringifying", async () => {
    const insert = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const client = fakeClient({ insert });

    const preStringified = '{"already":"json"}';
    await recordPaymentEvent(client, {
      invoiceId: "inv-str",
      gateway: "tamara",
      eventType: "tamara.approved",
      raw: preStringified,
    });

    const params = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(params[3]).toBe(preStringified);
  });
});

describe("event-ledger: finalizePaymentEvent", () => {
  it("UPDATEs status='processed' with order_id", async () => {
    const update = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const client = fakeClient({ update });

    await finalizePaymentEvent(client, {
      invoiceId: "inv-1",
      gateway: "moyasar",
      eventType: "payment.paid",
      status: "processed",
      orderId: "00000000-0000-0000-0000-000000000abc",
    });

    expect(update).toHaveBeenCalledOnce();
    const params = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][1];
    // 5 params: invoice_id, gateway, event_type, status, orderId
    expect(params).toHaveLength(5);
    expect(params[3]).toBe("processed");
    expect(params[4]).toBe("00000000-0000-0000-0000-000000000abc");
  });

  it("uses COALESCE so re-finalizing preserves the original order_id", async () => {
    const update = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const client = fakeClient({ update });

    // First call sets order_id.
    await finalizePaymentEvent(client, {
      invoiceId: "inv-2",
      gateway: "tamara",
      eventType: "tamara.approved",
      status: "processed",
      orderId: "order-aaa",
    });

    // Second call has NO order_id — the SQL uses COALESCE so the existing
    // value is preserved (the parameter is passed as NULL).
    await finalizePaymentEvent(client, {
      invoiceId: "inv-2",
      gateway: "tamara",
      eventType: "tamara.approved",
      status: "processed",
      // orderId omitted
    });

    const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(sql).toMatch(/COALESCE\(\$5, order_id\)/);
    const params = (client.query as ReturnType<typeof vi.fn>).mock.calls[1][1];
    expect(params[4]).toBeNull();
  });

  it("accepts status='failed' for error outcomes", async () => {
    const update = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const client = fakeClient({ update });

    await finalizePaymentEvent(client, {
      invoiceId: "inv-3",
      gateway: "moyasar",
      eventType: "payment.failed",
      status: "failed",
    });

    const params = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(params[3]).toBe("failed");
  });
});

describe("event-ledger: replay-protection contract (gate for webhook handlers)", () => {
  /**
   * This is the regression test the webhook routes RELY on:
   *
   *   const result = await recordPaymentEvent(client, {...});
   *   if (result === 'duplicate') {
   *     await client.query('COMMIT');
   *     return NextResponse.json({ received: true, duplicate: true });
   *   }
   *
   * If the duplicate-detection logic breaks, gateways will retry the
   * webhook forever and the order will be re-processed (with potential
   * duplicate side effects — loyalty credit, abandoned-cart recovery,
   * push notifications).
   */

  it("two calls with the same triple: first='inserted', second='duplicate'", async () => {
    let callCount = 0;
    const insert = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) return { rows: [], rowCount: 1 };
      // simulate UNIQUE violation on the second call
      throw pgError("23505");
    });
    const client = fakeClient({ insert });

    const first = await recordPaymentEvent(client, {
      invoiceId: "inv-replay",
      gateway: "moyasar",
      eventType: "payment.paid",
      raw: { x: 1 },
    });
    const second = await recordPaymentEvent(client, {
      invoiceId: "inv-replay",
      gateway: "moyasar",
      eventType: "payment.paid",
      raw: { x: 1 },
    });

    expect(first).toBe("inserted");
    expect(second).toBe("duplicate");
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("different event_type for the same invoice is allowed (NOT a duplicate)", async () => {
    const insert = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const client = fakeClient({ insert });

    const r1 = await recordPaymentEvent(client, {
      invoiceId: "inv-multi",
      gateway: "moyasar",
      eventType: "payment.paid",
      raw: {},
    });
    const r2 = await recordPaymentEvent(client, {
      invoiceId: "inv-multi",
      gateway: "moyasar",
      eventType: "payment.refunded",
      raw: {},
    });

    expect(r1).toBe("inserted");
    expect(r2).toBe("inserted");
  });
});