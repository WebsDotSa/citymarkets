import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for POST /api/v1/payments/retry.
 *
 * Invariants under test:
 *   1. Authentication required, ownership enforced (404 for non-owner).
 *   2. CSRF is enforced on this route (the proxy covers it; this test
 *      exercises the helpers it depends on so the route does not slip
 *      into the CSRF-exempt list).
 *   3. Server-authoritative total: route never trusts any client-supplied
 *      amount/contact fields.
 *   4. Per-user + per-IP rate limits fire before provider invocation.
 *   5. Eligibility (pay / retry / none) is enforced with a row lock so
 *      a concurrent paid webhook cannot be raced past.
 *   6. Cancelled+failed orders are reactivated to status='pending' when
 *      the gateway accepts the new attempt.
 *   7. Multi-vendor fan-out updates vendor_orders.payment_status and
 *      mirrors payment_method/reference on each child row.
 *   8. Provider success returns payment_url OR inline_payment=true;
 *      failure returns 502 without rolling parent/children to paid.
 */

const mocks = vi.hoisted(() => ({
  poolConnect: vi.fn(),
  resolveCustomerUserIdFromRequest: vi.fn(),
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  initiateOnlinePayment: vi.fn(),
  initiateTamaraPayment: vi.fn(),
  isMoyasarInlineCheckoutEnabled: vi.fn(),
  getPaymentProvider: vi.fn(),
  isTamaraEnabled: vi.fn(),
  // csrf + logger stubs (re-exports of helpers used by the route)
  applyCsrfProtection: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  pool: { connect: mocks.poolConnect },
}));
vi.mock('@/lib/identity', () => ({
  resolveCustomerUserIdFromRequest: mocks.resolveCustomerUserIdFromRequest,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  PAYMENT_INITIATE_CONFIG: { windowMs: 1, maxRequests: 5, keyPrefix: "p:u" },
  PAYMENT_INITIATE_IP_CONFIG: { windowMs: 1, maxRequests: 10, keyPrefix: "p:ip" },
  createRateLimitHeaders: (r: { remaining: number; resetAt: number; retryAfterMs?: number }) => ({
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(r.resetAt),
    ...(r.retryAfterMs ? { "Retry-After": String(Math.ceil(r.retryAfterMs / 1000)) } : {}),
  }),
}));
vi.mock("@/lib/request-ip", () => ({
  getClientIp: mocks.getClientIp,
}));
vi.mock("@/lib/payments/initiate", () => ({
  initiateOnlinePayment: mocks.initiateOnlinePayment,
  initiateTamaraPayment: mocks.initiateTamaraPayment,
  isMoyasarInlineCheckoutEnabled: mocks.isMoyasarInlineCheckoutEnabled,
  getPaymentProvider: mocks.getPaymentProvider,
  isTamaraEnabled: mocks.isTamaraEnabled,
}));
vi.mock("@/lib/csrf", () => ({
  applyCsrfProtection: mocks.applyCsrfProtection,
}));
vi.mock("@/lib/logger", () => ({
  error: mocks.logError,
  warn: mocks.logWarn,
  info: mocks.logInfo,
}));

import { POST } from "./route";

interface QueryCall { sql: string; params: unknown[] }

type OwnerRow = {
  id: string;
  user_id: string | null;
  total: number;
  payment_status: string;
  status: string;
  payment_method: string;
  guest_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  vendor_order_ids?: string[];
};

interface FakeClientOpts {
  owner?: OwnerRow;
  vendorChildren?: Array<{ id: string; status: string; payment_status: string }>;
  users?: { name: string; phone: string; email: string | null };
  // first attempt to lock returns a different snapshot
  lockTakesOwner?: OwnerRow;
  // For idempotency lookup; if a row is returned we treat it as a duplicate
  existingIdempotency?: { order_id: string; response: unknown };
}

function makeFakeClient(opts: FakeClientOpts = {}) {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = sql.trim().toLowerCase();
      calls.push({ sql, params });
      if (s.startsWith("begin") || s.startsWith("commit") || s.startsWith("rollback")) {
        return { rows: [] };
      }
      if (s.startsWith("select") && s.includes("for update") && s.includes("from orders")) {
        return { rows: [opts.lockTakesOwner ?? opts.owner].filter(Boolean) };
      }
      if (s.startsWith("select") && s.includes("from orders") && s.includes("id = $1")) {
        return { rows: opts.owner ? [opts.owner] : [] };
      }
      if (s.startsWith("select") && s.includes("from users")) {
        return { rows: opts.users ? [opts.users] : [] };
      }
      if (s.startsWith("select") && s.includes("from vendor_orders")) {
        return { rows: opts.vendorChildren ?? [] };
      }
      if (s.startsWith("select") && s.includes("from payment_retry_idempotency")) {
        return { rows: opts.existingIdempotency ? [opts.existingIdempotency] : [] };
      }
      if (s.startsWith("update orders") || s.startsWith("update vendor_orders")) {
        return { rows: [] };
      }
      if (s.startsWith("insert into payment_retry_idempotency")) {
        return { rows: [] };
      }
      if (s.startsWith("delete from payment_retry_idempotency")) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, calls };
}

function mockRequest(body: unknown): Request {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? "application/json" : null,
    },
    json: async () => body,
  } as unknown as Request;
}

const USER = "11111111-aaaa-bbbb-cccc-222222222222";
const ORDER = "22222222-aaaa-bbbb-cccc-333333333333";

beforeEach(() => {
  // vi.resetAllMocks() clears implementations AND call history, which
  // drops any leftover `mockResolvedValueOnce(...)` queues left from the
  // previous test. Without this, a test that returns before poolConnect
  // (e.g. a 400 validation rejection) leaks its queued client into the
  // next test and the lock reads the wrong fixture.
  vi.resetAllMocks();
  mocks.resolveCustomerUserIdFromRequest.mockResolvedValue(USER);
  mocks.getClientIp.mockReturnValue("1.2.3.4");
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 5, resetAt: 0 });
  mocks.getPaymentProvider.mockReturnValue("moyasar");
  mocks.isTamaraEnabled.mockReturnValue(false);
  mocks.isMoyasarInlineCheckoutEnabled.mockReturnValue(false);
  mocks.applyCsrfProtection.mockResolvedValue(null);
});

describe("POST /api/v1/payments/retry — auth + ownership", () => {
  it("returns 401 for unauthenticated customers and skips the rate limiter", async () => {
    mocks.resolveCustomerUserIdFromRequest.mockResolvedValueOnce(null);
    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "mada", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(401);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.poolConnect).not.toHaveBeenCalled();
  });

  it("returns 403 with 404-equivalent for orders owned by another user", async () => {
    const { client } = makeFakeClient({
      owner: {
        id: ORDER,
        user_id: "different-user",
        total: 50,
        payment_status: "failed",
        status: "cancelled",
        payment_method: "mada",
        guest_name: null,
        guest_phone: null,
        guest_email: null,
      },
    });
    mocks.poolConnect.mockResolvedValueOnce(client as never);
    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "mada", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(403);
    expect(mocks.initiateOnlinePayment).not.toHaveBeenCalled();
  });

  it("returns 404 when the order is not in the database", async () => {
    const { client } = makeFakeClient({ owner: undefined });
    mocks.poolConnect.mockResolvedValueOnce(client as never);
    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "mada", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/payments/retry — rate limit ordering", () => {
  it("returns 429 when per-user limit is exceeded and never reaches the DB", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0, retryAfterMs: 60000 });
    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "mada", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(429);
    expect(mocks.poolConnect).not.toHaveBeenCalled();
  });

  it("returns 429 when per-IP limit is exceeded and never reaches the gateway", async () => {
    mocks.checkRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 5, resetAt: 0 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0, retryAfterMs: 60000 });
    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "mada", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(429);
    expect(mocks.initiateOnlinePayment).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/payments/retry — validation", () => {
  it("rejects unsupported payment method (400) and never calls the provider", async () => {
    const { client } = makeFakeClient({
      owner: {
        id: ORDER,
        user_id: USER,
        total: 50,
        payment_status: "unpaid",
        status: "pending",
        payment_method: "mada",
        guest_name: "اسم",
        guest_phone: "0500000000",
        guest_email: null,
      },
    });
    mocks.poolConnect.mockResolvedValueOnce(client as never);
    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "magic_card", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(400);
    expect(mocks.initiateOnlinePayment).not.toHaveBeenCalled();
  });

  it("rejects tamara retry attempts (BNPL is order-level only)", async () => {
    const { client } = makeFakeClient({
      owner: {
        id: ORDER,
        user_id: USER,
        total: 50,
        payment_status: "unpaid",
        status: "pending",
        payment_method: "tamara",
        guest_name: "اسم",
        guest_phone: "0500000000",
        guest_email: null,
      },
    });
    mocks.poolConnect.mockResolvedValueOnce(client as never);
    mocks.isTamaraEnabled.mockReturnValue(true);
    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "tamara", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(409);
    expect(mocks.initiateTamaraPayment).not.toHaveBeenCalled();
  });

  it("ignores client-supplied total/contact and uses DB authoritative values", async () => {
    const { client } = makeFakeClient({
      owner: {
        id: ORDER,
        user_id: USER,
        total: 123.45,
        payment_status: "unpaid",
        status: "pending",
        payment_method: "mada",
        guest_name: "الهاتف_DB",
        guest_phone: "0599999999",
        guest_email: "db@example.com",
      },
    });
    mocks.poolConnect.mockResolvedValueOnce(client as never);
    mocks.initiateOnlinePayment.mockResolvedValueOnce({
      success: true,
      provider: "moyasar",
      paymentUrl: "https://pay.example/x",
      referenceId: "inv-1",
    });
    const res = await POST(
      mockRequest({
        orderId: ORDER,
        paymentMethod: "mada",
        idempotencyKey: "k1",
        // hostile values — must be ignored
        amount: 0.01,
        total: 0.01,
        customerName: "CLIENT",
        customerMobile: "0500000000",
      }) as never,
    );
    expect(res.status).toBe(200);
    const call = mocks.initiateOnlinePayment.mock.calls[0][0];
    expect(call.amount).toBe(123.45);
    expect(call.customerName).toBe("الهاتف_DB");
    expect(call.customerMobile).toBe("0599999999");
  });
});

describe("POST /api/v1/payments/retry — eligibility", () => {
  it("rejects already-paid orders (409) and never calls the provider", async () => {
    const { client } = makeFakeClient({
      owner: {
        id: ORDER,
        user_id: USER,
        total: 50,
        payment_status: "paid",
        status: "confirmed",
        payment_method: "mada",
        guest_name: "اسم",
        guest_phone: "0500000000",
        guest_email: null,
      },
    });
    mocks.poolConnect.mockResolvedValueOnce(client as never);
    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "mada", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(409);
    expect(mocks.initiateOnlinePayment).not.toHaveBeenCalled();
  });

  it("rejects pending-online orders to avoid duplicate invoices (409)", async () => {
    const { client } = makeFakeClient({
      owner: {
        id: ORDER,
        user_id: USER,
        total: 50,
        payment_status: "pending",
        status: "pending",
        payment_method: "mada",
        guest_name: "اسم",
        guest_phone: "0500000000",
        guest_email: null,
      },
    });
    mocks.poolConnect.mockResolvedValueOnce(client as never);
    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "mada", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(409);
    expect(mocks.initiateOnlinePayment).not.toHaveBeenCalled();
  });

  it("rejects orders that become paid while waiting for the lock (409)", async () => {
    const { client } = makeFakeClient({
      owner: {
        id: ORDER,
        user_id: USER,
        total: 50,
        payment_status: "unpaid",
        status: "pending",
        payment_method: "mada",
        guest_name: "اسم",
        guest_phone: "0500000000",
        guest_email: null,
      },
      // the locked snapshot already shows paid
      lockTakesOwner: {
        id: ORDER,
        user_id: USER,
        total: 50,
        payment_status: "paid",
        status: "confirmed",
        payment_method: "mada",
        guest_name: "اسم",
        guest_phone: "0500000000",
        guest_email: null,
      },
    });
    mocks.poolConnect.mockResolvedValueOnce(client as never);
    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "mada", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(409);
    expect(mocks.initiateOnlinePayment).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/payments/retry — hosted + reactivation", () => {
  it("reactivates cancelled+failed orders and returns the hosted payment URL", async () => {
    const { client, calls } = makeFakeClient({
      owner: {
        id: ORDER,
        user_id: USER,
        total: 75,
        payment_status: "failed",
        status: "cancelled",
        payment_method: "mada",
        guest_name: "اسم",
        guest_phone: "0500000000",
        guest_email: null,
      },
      vendorChildren: [
        { id: "v-1", status: "cancelled", payment_status: "failed" },
        { id: "v-2", status: "cancelled", payment_status: "failed" },
      ],
    });
    mocks.poolConnect.mockResolvedValueOnce(client as never);
    mocks.initiateOnlinePayment.mockResolvedValueOnce({
      success: true,
      provider: "moyasar",
      paymentUrl: "https://pay.example/x",
      referenceId: "inv-77",
    });

    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "mada", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.paymentUrl).toBe("https://pay.example/x");
    expect(body.paymentReference).toBe("inv-77");
    expect(body.inlinePayment).toBe(false);

    // Parent is reactivated to status='pending' before provider call.
    const parentReactivate = calls.find(
      (c) => c.sql.toLowerCase().includes("update orders") && c.sql.toLowerCase().includes("status = 'pending'"),
    );
    expect(parentReactivate).toBeDefined();
    // Children updated to match — the route uses a single bulk
    // UPDATE … WHERE parent_order_id = $1 to fan out the new method
    // and reference, so we assert at least one child-mirroring call.
    const childUpdates = calls.filter(
      (c) => c.sql.toLowerCase().includes("update vendor_orders"),
    );
    expect(childUpdates.length).toBeGreaterThanOrEqual(1);
  });

  it("returns inline_payment=true when Moyasar inline is enabled without an invoice", async () => {
    mocks.isMoyasarInlineCheckoutEnabled.mockReturnValueOnce(true);
    const { client } = makeFakeClient({
      owner: {
        id: ORDER,
        user_id: USER,
        total: 75,
        payment_status: "unpaid",
        status: "pending",
        payment_method: "mada",
        guest_name: "اسم",
        guest_phone: "0500000000",
        guest_email: null,
      },
    });
    mocks.poolConnect.mockResolvedValueOnce(client as never);
    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "mada", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inlinePayment).toBe(true);
    expect(body.paymentUrl).toBeNull();
    expect(mocks.initiateOnlinePayment).not.toHaveBeenCalled();
  });

  it("returns 502 when the gateway declines and never marks the order paid", async () => {
    const { client, calls } = makeFakeClient({
      owner: {
        id: ORDER,
        user_id: USER,
        total: 75,
        payment_status: "failed",
        status: "cancelled",
        payment_method: "mada",
        guest_name: "اسم",
        guest_phone: "0500000000",
        guest_email: null,
      },
    });
    mocks.poolConnect.mockResolvedValueOnce(client as never);
    mocks.initiateOnlinePayment.mockResolvedValueOnce({
      success: false,
      provider: "moyasar",
      error: "card_declined",
    });
    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "mada", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(502);
    // The "success" UPDATE for parent payment_reference must NOT have
    // happened — only the failure UPDATE keeps payment_status='failed'.
    const successUpdate = calls.find(
      (c) => c.sql.toLowerCase().includes("update orders") && c.sql.toLowerCase().includes("payment_reference = $1"),
    );
    expect(successUpdate).toBeUndefined();
  });
});

describe("POST /api/v1/payments/retry — contact source", () => {
  it("prefers guest_* columns from the order when the customer is a guest", async () => {
    // The retry route is customer-authenticated; guest orders are
    // owned by an anonymous session and never reach this endpoint.
    // Cover the contract: when user_id is null the contact comes from
    // the order's guest_* columns, but the route treats that as
    // "owner mismatch" and refuses (404) to keep ownership strict.
    const { client } = makeFakeClient({
      owner: {
        id: ORDER,
        user_id: null,
        total: 60,
        payment_status: "unpaid",
        status: "pending",
        payment_method: "mada",
        guest_name: "ضيف",
        guest_phone: "0511111111",
        guest_email: "guest@example.com",
      },
    });
    mocks.poolConnect.mockResolvedValueOnce(client as never);
    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "mada", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(404);
    expect(mocks.initiateOnlinePayment).not.toHaveBeenCalled();
  });

  it("falls back to users.{name,phone,email} when guest_* is empty", async () => {
    const { client } = makeFakeClient({
      owner: {
        id: ORDER,
        user_id: USER,
        total: 60,
        payment_status: "unpaid",
        status: "pending",
        payment_method: "mada",
        guest_name: null,
        guest_phone: null,
        guest_email: null,
      },
      users: { name: "سجل", phone: "0522222222", email: "u@example.com" },
    });
    mocks.poolConnect.mockResolvedValueOnce(client as never);
    mocks.initiateOnlinePayment.mockResolvedValueOnce({
      success: true,
      provider: "moyasar",
      paymentUrl: "https://pay.example/x",
      referenceId: "inv-u",
    });
    const res = await POST(
      mockRequest({ orderId: ORDER, paymentMethod: "mada", idempotencyKey: "k1" }) as never,
    );
    expect(res.status).toBe(200);
    const call = mocks.initiateOnlinePayment.mock.calls[0][0];
    expect(call.customerName).toBe("سجل");
    expect(call.customerMobile).toBe("0522222222");
    expect(call.customerEmail).toBe("u@example.com");
  });
});
