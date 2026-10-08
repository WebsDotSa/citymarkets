import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Unit tests for POST /api/v1/profile/delete — PCP-168 (Phase 16 backend).
 *
 * Verifies that account soft-delete:
 *   - Zeroes loyalty_points on the user record
 *   - Inserts an audit row into loyalty_transactions with type='adjust'
 *   - Captures the pre-delete balance in the loyalty_transactions row
 */

type QueryCall = { sql: string; params: unknown[] };
const calls: QueryCall[] = [];
const mockClient = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/^BEGIN/.test(sql)) return { rows: [] };
    if (/^COMMIT/.test(sql)) return { rows: [] };
    if (/^ROLLBACK/.test(sql)) return { rows: [] };
    if (/SELECT\s+deleted_at/.test(sql)) {
      return { rows: [{ deleted_at: null }], rowCount: 1 };
    }
    if (/SELECT\s+loyalty_points/.test(sql)) {
      return { rows: [{ loyalty_points: 250 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }),
  release: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn(async () => mockClient) },
  query: vi.fn(),
}));

const requireAuth = vi.fn();
vi.mock("@/lib/identity", () => ({
  COOKIE_NAME: "session",
  customerSessionCookieOptions: vi.fn(() => ({})),
}));
vi.mock("@/lib/identity/auth-helpers", () => ({
  requireAuth: (...args: unknown[]) => requireAuth(...args),
}));

const checkRateLimit = vi.fn().mockResolvedValue({ allowed: true });
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
}));

const getClientIp = vi.fn().mockReturnValue("127.0.0.1");
vi.mock("@/lib/request-ip", () => ({
  getClientIp: (...args: unknown[]) => getClientIp(...args),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { POST } from "./route";

function mockRequest(body: object = { confirmation: "DELETE" }): NextRequest {
  return {
    headers: { get: () => null },
    url: "http://x/api/v1/profile/delete",
    json: async () => body,
  } as unknown as NextRequest;
}

describe("POST /api/v1/profile/delete — PCP-168 loyalty zeroing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    requireAuth.mockResolvedValue({ user: { id: "user-test-1" } });
    checkRateLimit.mockResolvedValue({ allowed: true });
  });

  it("zeroes loyalty_points in the UPDATE users statement", async () => {
    await POST(mockRequest());
    const updateCall = calls.find(
      (c) => /^UPDATE\s+users/i.test(c.sql.trim()),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall!.sql).toMatch(/loyalty_points\s*=\s*0/i);
  });

  it("inserts a loyalty_transactions audit row of type 'adjust'", async () => {
    await POST(mockRequest());
    const txInsert = calls.find(
      (c) => /^INSERT\s+INTO\s+loyalty_transactions/i.test(c.sql.trim()),
    );
    expect(txInsert).toBeDefined();
    expect(txInsert!.sql).toMatch(/loyalty_transactions/i);
    expect(txInsert!.sql).toMatch(/'adjust'::loyalty_tx_type_enum|adjust/i);
  });

  it("captures the pre-delete balance in the loyalty_transactions row", async () => {
    await POST(mockRequest());
    const txInsert = calls.find(
      (c) => /^INSERT\s+INTO\s+loyalty_transactions/i.test(c.sql.trim()),
    );
    expect(txInsert).toBeDefined();
    // The mocked pre-delete balance was 250, so the audit row should
    // record 250 as the points that were zeroed.
    expect(txInsert!.params[1]).toBe(250);
  });

  it("includes the pre-delete reason in the loyalty_transactions row", async () => {
    await POST(mockRequest());
    const txInsert = calls.find(
      (c) => /^INSERT\s+INTO\s+loyalty_transactions/i.test(c.sql.trim()),
    );
    expect(txInsert).toBeDefined();
    const reason = txInsert!.params[2] as string;
    expect(reason).toMatch(/account_deletion/i);
    expect(reason).toContain("250");
  });
});
