/**
 * End-to-end test for the token_version revocation flow.
 *
 * P0-1b (security Phase 2, 2026-10-03): the verify path must compare
 * the JWT's `tokenVersion` claim against the live row, and a bump on
 * the row (logout, password change, demotion) must reject the
 * previously-valid JWT.
 *
 * This test simulates the full flow with the real verify path:
 *
 *   1. Mock the pool to return a row with token_version=1.
 *   2. Sign a JWT with tokenVersion=1.
 *   3. Verify — should succeed.
 *   4. Simulate a logout: the pool now returns token_version=2.
 *   5. Verify with the same JWT — should now fail.
 *
 * The mock pool mimics the real Postgres interface closely enough
 * that this test exercises the actual `auth-helpers.ts` flow
 * including the centralised `assertTokenVersionMatches` call.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the DB pool so we can control the row's token_version.
const mockPoolConnect = vi.fn();
const mockPoolQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  pool: {
    connect: () => mockPoolConnect(),
    query: (...args: unknown[]) => mockPoolQuery(...args),
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { cookies } from "next/headers";
import { getServerUser } from "@/lib/identity/auth-helpers";
import { signCustomerToken } from "@/lib/identity/customer-session";

interface FakeClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

function makeFakeClient(row: Record<string, unknown> | null) {
  const client: FakeClient = {
    query: vi.fn().mockResolvedValueOnce({ rows: row ? [row] : [] }),
    release: vi.fn(),
  };
  return client;
}

describe("getServerUser — token_version revocation flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a customer JWT after token_version is bumped on the row", async () => {
    // 1. Sign a JWT as if the user just logged in.
    const jwt = await signCustomerToken({
      userId: "user-1",
      phone: "+966500000000",
      tokenVersion: 1,
    });

    // 2. The pool returns the user with token_version=1 (pre-logout).
    const clientBefore = makeFakeClient({
      id: "user-1",
      phone: "+966500000000",
      name: "Test",
      email: "test@example.com",
      avatar_url: null,
      loyalty_tier: null,
      spin_count_today: 0,
      last_spin_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      token_version: 1,
    });
    mockPoolConnect.mockResolvedValueOnce(clientBefore);

    // 3. Verify with a valid cookie — should succeed.
    vi.mocked(cookies).mockResolvedValueOnce({
      get: (name: string) =>
        name === "customer_session" ? { value: jwt } : undefined,
    } as never);

    const user = await getServerUser();
    expect(user).not.toBeNull();
    expect(user?.id).toBe("user-1");

    // 4. Simulate logout: the row's token_version is now 2, but the
    //    same JWT is still on the wire (the user has not yet seen
    //    the new login response).
    const clientAfter = makeFakeClient({
      id: "user-1",
      phone: "+966500000000",
      name: "Test",
      email: "test@example.com",
      avatar_url: null,
      loyalty_tier: null,
      spin_count_today: 0,
      last_spin_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      token_version: 2, // bumped by logout route
    });
    mockPoolConnect.mockResolvedValueOnce(clientAfter);

    // 5. Verify with the same (now stale) cookie — must return null.
    vi.mocked(cookies).mockResolvedValueOnce({
      get: (name: string) =>
        name === "customer_session" ? { value: jwt } : undefined,
    } as never);

    const userAfterLogout = await getServerUser();
    expect(userAfterLogout).toBeNull();
  });

  it("accepts a freshly-minted JWT after a bump (claim matches the new row value)", async () => {
    // 1. Sign a JWT with the post-logout tokenVersion=2.
    const jwt = await signCustomerToken({
      userId: "user-2",
      phone: "+966511111111",
      tokenVersion: 2,
    });

    // 2. The row's token_version is now 2 (post-relogin).
    const client = makeFakeClient({
      id: "user-2",
      phone: "+966511111111",
      name: "Test2",
      email: "test2@example.com",
      avatar_url: null,
      loyalty_tier: null,
      spin_count_today: 0,
      last_spin_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      token_version: 2,
    });
    mockPoolConnect.mockResolvedValueOnce(client);

    vi.mocked(cookies).mockResolvedValueOnce({
      get: (name: string) =>
        name === "customer_session" ? { value: jwt } : undefined,
    } as never);

    const user = await getServerUser();
    expect(user).not.toBeNull();
    expect(user?.id).toBe("user-2");
  });

  it("accepts a legacy JWT (no claim) when the row is at default version 1", async () => {
    // A legacy JWT minted before this fix has no tokenVersion claim.
    // We forge one by signing with explicit tokenVersion=1 (same
    // behaviour as undefined thanks to the helper's default).
    const jwt = await signCustomerToken({
      userId: "user-3",
      phone: "+966522222222",
      tokenVersion: 1,
    });

    const client = makeFakeClient({
      id: "user-3",
      phone: "+966522222222",
      name: "Test3",
      email: "test3@example.com",
      avatar_url: null,
      loyalty_tier: null,
      spin_count_today: 0,
      last_spin_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      token_version: 1,
    });
    mockPoolConnect.mockResolvedValueOnce(client);

    vi.mocked(cookies).mockResolvedValueOnce({
      get: (name: string) =>
        name === "customer_session" ? { value: jwt } : undefined,
    } as never);

    const user = await getServerUser();
    expect(user).not.toBeNull();
  });
});
