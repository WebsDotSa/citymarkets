import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pool.connect so we can observe query counts and responses
// without hitting Postgres. Each `connect()` returns a fake client
// whose `query(sql, params)` returns a pre-baked result depending on
// the SQL keyword.
type FakeClient = {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

function makeFakeClient(scenario: "existing" | "new"): FakeClient {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client: FakeClient = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const s = sql.trim().toUpperCase();

      if (s.startsWith("INSERT INTO USERS")) {
        // ON CONFLICT DO NOTHING — no row returned, but the
        // consequence differs by scenario.
        if (scenario === "existing") {
          return { rows: [] }; // conflict, no insert
        }
        return {
          rows: [{ id: "new-user-uuid" }],
        };
      }

      if (s.startsWith("SELECT ID, PHONE, NAME FROM USERS")) {
        return {
          rows: scenario === "existing"
            ? [{ id: "existing-user-uuid", phone: params[0], name: null }]
            : [{ id: "new-user-uuid", phone: params[0], name: null }],
        };
      }

      if (s.startsWith("INSERT INTO USER_OTPS")) {
        return { rows: [] };
      }

      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return client;
}

vi.mock("@/lib/db", () => ({
  pool: {
    connect: vi.fn(),
  },
}));

vi.mock("@/lib/env", () => ({
  isLegacyPhoneOtpAllowed: () => true,
  // apple-review.ts reads these at module init; the route imports the
  // resulting constants. Default the Apple Review shortcut off so the
  // test exercises the normal OTP flow.
  isAppleReviewEnabled: () => false,
  getAppleReviewPhone: () => null,
  getAppleReviewOtp: () => null,
  getAppleReviewName: () => null,
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/lib/twilio-messaging", () => ({
  isTwilioMessagingConfigured: () => true,
  twilioSendSms: vi.fn(async () => ({ ok: true, sid: "SM-test-sid" })),
}));

import { pool } from "@/lib/db";
import { POST } from "./route";

function mockRequest(body: unknown): Request {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Request;
}

describe("POST /api/v1/auth/login — enumeration resistance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the same number of DB queries whether the phone is new or existing", async () => {
    const scenarios: Array<"existing" | "new"> = ["existing", "new"];
    const counts: number[] = [];

    for (const scenario of scenarios) {
      const client = makeFakeClient(scenario);
      vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
      const res = await POST(
        mockRequest({ phone: "+966500000000" }) as never
      );
      expect(res.status).toBe(200);
      counts.push(client.query.mock.calls.length);
    }

    // Both branches must perform the same number of queries
    // (SELECT → INSERT, or INSERT → SELECT, in the same order).
    expect(counts[0]).toBe(counts[1]);
    expect(counts[0]).toBeGreaterThanOrEqual(3); // upsert + select + otp insert
  });

  it("returns an identical response shape for new and existing users", async () => {
    const seen: Array<{ status: number; body: unknown }> = [];
    for (const scenario of ["existing", "new"] as const) {
      const client = makeFakeClient(scenario);
      vi.mocked(pool.connect).mockResolvedValueOnce(client as never);
      const res = await POST(
        mockRequest({ phone: "+966500000001" }) as never
      );
      const body = await res.json();
      seen.push({ status: res.status, body });
    }

    // Same status, same top-level keys, same message, same requireVerification.
    expect(seen[0].status).toBe(seen[1].status);
    expect(Object.keys(seen[0].body as object).sort()).toEqual(
      Object.keys(seen[1].body as object).sort()
    );
    const a = seen[0].body as Record<string, unknown>;
    const b = seen[1].body as Record<string, unknown>;
    expect(a.message).toBe(b.message);
    expect(a.requireVerification).toBe(b.requireVerification);
    // userId is intentionally different per scenario (it's the lookup
    // result, not a secret), but both responses contain a non-empty one.
    expect(typeof a.userId).toBe("string");
    expect(typeof b.userId).toBe("string");
  });

  it("rejects a missing phone with 400 before any DB work", async () => {
    const res = await POST(mockRequest({}) as never);
    expect(res.status).toBe(400);
    expect(vi.mocked(pool.connect)).not.toHaveBeenCalled();
  });
});
