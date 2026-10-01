import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for POST /api/v1/addresses/[id]/default (D12 fix).
 *
 * Pre-fix: profile-new.tsx called this endpoint but the route did
 * not exist. The fetch 404'd and the toggle silently failed. Today
 * the route delegates to the canonical address service, which performs
 * the "clear-others + set-target" toggle inside one transaction.
 *
 * P2-3: the route no longer inlines the three queries (ownership check
 * + clear-others UPDATE + set-this UPDATE). We mock pool.connect() so
 * the service's transaction body runs against a fake client that
 * returns the rowCount/rows the test wants.
 */

type QueryCall = { sql: string; params: unknown[] };

function makeFakeClient(opts?: { rows?: unknown[] }) {
  const txCalls: QueryCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      txCalls.push({ sql, params });
      const s = sql.trim().toUpperCase();
      if (s.startsWith("BEGIN") || s.startsWith("ROLLBACK") || s.startsWith("COMMIT")) {
        return { rows: [] };
      }
      // The service issues 2 UPDATEs:
      //   1) SET is_default = false WHERE user_id = $1 AND id <> $2
      //   2) SET is_default = true WHERE id = $2 AND user_id = $1 RETURNING ...
      // We return rows only on the second one (the "this row became default" one).
      if (s.includes("SET IS_DEFAULT = TRUE") && s.includes("RETURNING")) {
        return { rows: opts?.rows ?? [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", is_default: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return { client, txCalls };
}

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(),
}));

vi.mock("@/lib/identity", () => ({
  resolveCustomerUserIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { pool } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from "@/lib/identity";
import { POST } from "./route";
import type { NextRequest } from "next/server";

function mockRequest(url = "http://localhost/api/v1/addresses/addr-1/default"): NextRequest {
  return {
    headers: { get: () => null },
    url,
  } as unknown as NextRequest;
}

const PARAMS = (id: string) => Promise.resolve({ id });

describe("POST /api/v1/addresses/[id]/default (D12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no customer is resolved", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue(null);
    const res = await POST(mockRequest() as never, { params: PARAMS("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa") });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("غير مصرح");
    // No DB activity — the auth gate fires first.
    expect(vi.mocked(pool.connect)).not.toHaveBeenCalled();
  });

  it("returns 404 when the address does not belong to the caller", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("00000000-0000-0000-0000-000000000001");
    // Service returns null when the target row isn't owned → 404.
    const { client } = makeFakeClient({ rows: [] });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);

    const res = await POST(mockRequest() as never, { params: PARAMS("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa") });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("العنوان غير موجود");
  });

  it("toggles defaults via the service (clear-others + set-target in one tx)", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("00000000-0000-0000-0000-000000000001");
    const { client, txCalls } = makeFakeClient({ rows: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", is_default: true }] });
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never);

    const res = await POST(mockRequest() as never, { params: PARAMS("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa") });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Transaction body: BEGIN → clear UPDATE → set UPDATE → COMMIT.
    // The service uses [userId, id] as params (owner first, then id).
    const setFalse = txCalls.find(
      (c) => /SET is_default = false/i.test(c.sql) && /id <> \$2::uuid/i.test(c.sql),
    );
    expect(setFalse).toBeDefined();
    expect(setFalse!.params).toEqual(["00000000-0000-0000-0000-000000000001", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);

    const setTrue = txCalls.find(
      (c) => /SET is_default = true/i.test(c.sql) && /RETURNING/i.test(c.sql),
    );
    expect(setTrue).toBeDefined();
    expect(setTrue!.params).toEqual(["00000000-0000-0000-0000-000000000001", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);

    // The transaction must commit (not leave the rowCount=0 placeholder).
    const commit = txCalls.find((c) => c.sql.trim().toUpperCase().startsWith("COMMIT"));
    expect(commit).toBeDefined();
  });

  it("returns 500 on DB error from the service", async () => {
    vi.mocked(resolveCustomerUserIdFromRequest).mockResolvedValue("00000000-0000-0000-0000-000000000001");
    // Force pool.connect().query() to throw — exercises the catch-all.
    const errorClient = {
      query: vi.fn().mockRejectedValue(new Error("db_down")),
      release: vi.fn(),
    };
    vi.mocked(pool.connect).mockResolvedValueOnce(errorClient as never);

    const res = await POST(mockRequest() as never, { params: PARAMS("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa") });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("فشل تحديد العنوان الافتراضي");
  });
});
