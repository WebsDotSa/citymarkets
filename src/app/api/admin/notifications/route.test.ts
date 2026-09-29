import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for /api/admin/notifications.
 *
 * Bug D6: the PUT endpoint was a documented no-op that returned
 * `{ success: true }` without writing anywhere. Every "Mark as
 * read" / "Mark all read" reverted on page reload because the GET
 * handler re-derived `is_read` from data shape with no persisted
 * state.
 *
 * These tests pin down:
 *   1. PUT with `id` writes a row into `admin_notification_reads`.
 *   2. PUT with `markAll: true` writes rows for every displayable
 *      notification.
 *   3. PUT is idempotent — repeated calls do not error.
 *   4. PUT returns 400 when neither `id` nor `markAll` is supplied.
 *   5. GET joins the read-state table and surfaces persisted state.
 */

type QueryCall = { sql: string; params: unknown[] };

/**
 * Build a minimal `pg.QueryResult` shape for mock returns. `vi.mocked(query)`
 * rejects partial returns (it requires `command, rowCount, oid, fields` in
 * addition to `rows`). These fields are unused by the route handlers — they
 * only read `.rows` — so the placeholder values are fine.
 */
function qr<R>(rows: ReadonlyArray<R>) {
  return {
    rows: rows as R[],
    command: "",
    rowCount: rows.length,
    oid: 0,
    fields: [] as never[],
  };
}

function makeFakeClient(opts: {
  readRows?: Array<{ notification_id: string }>;
  orders?: Array<{ id: string; status: string; total: number; payment_method: string | null; created_at: string; customer_name: string | null; guest_phone: string | null; user_phone: string | null }>;
} = {}) {
  const calls: QueryCall[] = [];
  const writes: QueryCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const upper = sql.trim().toUpperCase();
      const record = { sql, params };
      if (upper.startsWith('INSERT')) writes.push(record);
      calls.push(record);
      if (upper.startsWith('SELECT NOTIFICATION_ID FROM ADMIN_NOTIFICATION_READS')) {
        return { rows: opts.readRows ?? [] };
      }
      if (upper.startsWith('SELECT ID FROM ORDERS')) {
        return { rows: (opts.orders ?? []).map((o) => ({ id: o.id })) };
      }
      if (upper.startsWith('SELECT ID FROM PRODUCTS_UNIFIED')) {
        return qr([]);
      }
      return qr([]);
    }),
    release: vi.fn(),
  };
  return { client, calls, writes };
}

vi.mock('@/lib/db', () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(),
}));

vi.mock('@/lib/identity/admin-api-auth-db', () => ({
  requireAdminApi: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { query } from '@/lib/db';
import { requireAdminApi } from '@/lib/identity/admin-api-auth-db';
import { GET, PUT } from './route';
import type { NextRequest } from 'next/server';

const ADMIN_ID = '11111111-2222-3333-4444-555555555555';

function mockRequest(body: unknown): NextRequest {
  return {
    url: 'http://localhost/api/admin/notifications',
    headers: { get: () => null },
    json: async () => body,
  } as unknown as NextRequest;
}

describe("PUT /api/admin/notifications — D6 fix: read-state persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: { id: ADMIN_ID } } as never);
  });

  it("writes a single (admin_id, notification_id) row when `id` is supplied", async () => {
    const writes: QueryCall[] = [];
    vi.mocked(query).mockImplementation(async (sql: string, params: unknown[] = []) => {
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('INSERT')) writes.push({ sql, params });
      return qr([]);
    });

    const res = await PUT(mockRequest({ id: 'order-abc-123' }) as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Exactly one INSERT must have been issued, with the admin id +
    // notification id the caller provided.
    expect(writes).toHaveLength(1);
    expect(writes[0].sql.toUpperCase()).toContain('INSERT INTO ADMIN_NOTIFICATION_READS');
    expect(writes[0].params).toEqual([ADMIN_ID, 'order-abc-123']);
  });

  it("uses ON CONFLICT DO NOTHING so repeated calls are idempotent (no error)", async () => {
    const writes: QueryCall[] = [];
    vi.mocked(query).mockImplementation(async (sql: string, params: unknown[] = []) => {
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('INSERT')) writes.push({ sql, params });
      return qr([]);
    });

    // Same id, twice.
    await PUT(mockRequest({ id: 'lowstock-x' }) as never);
    await PUT(mockRequest({ id: 'lowstock-x' }) as never);

    expect(writes).toHaveLength(2);
    // Both INSERTs must include the ON CONFLICT clause so the second
    // call doesn't raise a unique-constraint error.
    for (const w of writes) {
      expect(w.sql.toUpperCase()).toContain('ON CONFLICT');
      expect(w.sql.toUpperCase()).toContain('DO NOTHING');
    }
  });

  it("writes a row for every currently-displayable notification when `markAll` is true", async () => {
    const writes: QueryCall[] = [];
    vi.mocked(query).mockImplementation(async (sql: string, params: unknown[] = []) => {
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('INSERT')) writes.push({ sql, params });
      // Materialize call: synthesize two orders.
      if (upper.startsWith('SELECT ID FROM ORDERS')) {
        return qr([{ id: 'o-1' }, { id: 'o-2' }]);
      }
      if (upper.startsWith('SELECT ID FROM PRODUCTS_UNIFIED')) {
        return qr([{ id: 'p-1' }, { id: 'p-2' }]);
      }
      return qr([]);
    });

    const res = await PUT(mockRequest({ markAll: true }) as never);

    expect(res.status).toBe(200);

    // Exactly one bulk INSERT (UNNEST) is expected — the per-row
    // inserts from the old code path would explode to many writes.
    expect(writes).toHaveLength(1);
    expect(writes[0].sql.toUpperCase()).toContain('UNNEST');
    expect(writes[0].params[0]).toBe(ADMIN_ID);
    // Second param is the text[] of synthetic IDs.
    const ids = writes[0].params[1] as string[];
    expect(ids).toContain('order-o-1');
    expect(ids).toContain('order-o-2');
    expect(ids).toContain('lowstock-p-1');
    expect(ids).toContain('lowstock-p-2');
  });

  it("returns 400 when neither `id` nor `markAll` is supplied", async () => {
    const writes: QueryCall[] = [];
    vi.mocked(query).mockImplementation(async (sql: string, params: unknown[] = []) => {
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('INSERT')) writes.push({ sql, params });
      return qr([]);
    });

    const res = await PUT(mockRequest({}) as never);

    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it("scopes writes to the authenticated admin — admin A's read state does not appear in admin B's GET", async () => {
    const writes: QueryCall[] = [];
    vi.mocked(query).mockImplementation(async (sql: string, params: unknown[] = []) => {
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('INSERT')) writes.push({ sql, params });
      return qr([]);
    });

    await PUT(mockRequest({ id: 'order-1' }) as never);

    // The admin_id used in the INSERT must be the one returned by
    // requireAdminApi, NOT a value the client could supply.
    expect(writes[0].params[0]).toBe(ADMIN_ID);
    // The request body only contained `{ id }`; the admin id came
    // from the verified JWT, not from the body.
    expect(writes[0].params[1]).toBe('order-1');
  });
});

describe("GET /api/admin/notifications — D6 fix: persists read state into the response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApi).mockResolvedValue({ admin: { id: ADMIN_ID } } as never);
  });

  it("queries admin_notification_reads for the authenticated admin", async () => {
    const readsCalls: QueryCall[] = [];
    vi.mocked(query).mockImplementation(async (sql: string, params: unknown[] = []) => {
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('SELECT NOTIFICATION_ID FROM ADMIN_NOTIFICATION_READS')) {
        readsCalls.push({ sql, params });
        return qr([]);
      }
      return qr([]);
    });

    const res = await GET(mockRequest(undefined) as never);

    expect(readsCalls).toHaveLength(1);
    expect(readsCalls[0].params).toEqual([ADMIN_ID]);
    expect(res.status).toBe(200);
  });

  it("marks an order notification as read if admin_notification_reads contains its id", async () => {
    // Seed: admin has marked `order-XYZ` as read. Also add an
    // order row in the past 7 days so the notification is surfaced.
    vi.mocked(query).mockImplementation(async (sql: string) => {
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('SELECT NOTIFICATION_ID FROM ADMIN_NOTIFICATION_READS')) {
        return qr([{ notification_id: 'order-ORDERXYZ' }]);
      }
      if (upper.startsWith('SELECT') && upper.includes('FROM ORDERS')) {
        return qr([
          {
            id: 'ORDERXYZ',
            status: 'pending',
            total: 50,
            payment_method: 'cash',
            created_at: new Date().toISOString(),
            customer_name: 'Tester',
            guest_phone: null,
            user_phone: null,
          },
        ]);
      }
      return qr([]);
    });

    const res = await GET(mockRequest(undefined) as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Find the order-ORDERXYZ item and verify is_read=true.
    const orderItem = body.data.find((i: { id: string; is_read: boolean }) => i.id === 'order-ORDERXYZ');
    expect(orderItem).toBeDefined();
    expect(orderItem.is_read).toBe(true);
  });

  it("does not mark an order notification as read if it is not in admin_notification_reads", async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('SELECT NOTIFICATION_ID FROM ADMIN_NOTIFICATION_READS')) {
        return qr([]); // no read state
      }
      if (upper.startsWith('SELECT') && upper.includes('FROM ORDERS')) {
        return qr([
          {
            id: 'UNREADORDER',
            status: 'pending',
            total: 50,
            payment_method: 'cash',
            created_at: new Date().toISOString(),
            customer_name: 'Tester',
            guest_phone: null,
            user_phone: null,
          },
        ]);
      }
      return qr([]);
    });

    const res = await GET(mockRequest(undefined) as never);
    const body = await res.json();
    const item = body.data.find((i: { id: string; is_read: boolean }) => i.id === 'order-UNREADORDER');
    expect(item).toBeDefined();
    expect(item.is_read).toBe(false);
  });
});