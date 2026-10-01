import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for Moyasar SDK wrapper.
 *
 * Strategy: stub `globalThis.fetch` to capture the outbound request and
 * return a canned response, then assert that the wrapper shapes the
 * request correctly (auth header, idempotency key, methods array) and
 * surfaces provider errors verbatim.
 *
 * MOYASAR_SECRET_KEY is a module-scope constant in moyasar.ts read from
 * process.env at import time, so we use vi.hoisted to set a default
 * before the module loads. Tests that need to test the missing-key path
 * use vi.resetModules() + a fresh import.
 */

vi.hoisted(() => {
  process.env.MOYASAR_SECRET_KEY = "sk_test_secret";
  process.env.MOYASAR_PUBLISHABLE_KEY = "pk_test_secret";
});

import {
  createInvoice,
  fetchInvoiceDetails,
  fetchInvoice,
  fetchPayment,
  isMoyasarConfigured,
  isMoyasarInlineConfigured,
  isSarCurrency,
  mapMoyasarStatusToDb,
  toHalalas,
  getMoyasarPublishableKey,
  getMoyasarSiteUrl,
  getMoyasarApplePayLabel,
} from "./moyasar";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(impl: (input: string, init?: RequestInit) => Promise<Response> | Response) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH;
}

describe("toHalalas", () => {
  it("multiplies SAR by 100 and rounds", () => {
    expect(toHalalas(1)).toBe(100);
    expect(toHalalas(1.5)).toBe(150);
    expect(toHalalas(10.999)).toBe(1100);
  });

  it("enforces a minimum of 100 halalas (1 SAR)", () => {
    // A sub-1-SAR amount would round to 0 and break the provider; clamp
    // to 1 SAR so a 0.50 promo can't be silently zero-billed.
    expect(toHalalas(0)).toBe(100);
    expect(toHalalas(0.4)).toBe(100);
  });
});

describe("isMoyasarConfigured / isMoyasarInlineConfigured", () => {
  it("returns true when both keys are set (default from vi.hoisted)", () => {
    expect(isMoyasarConfigured()).toBe(true);
    expect(isMoyasarInlineConfigured()).toBe(true);
  });

  it("returns false when MOYASAR_SECRET_KEY is missing", async () => {
    vi.stubEnv("MOYASAR_SECRET_KEY", "");
    vi.resetModules();
    const mod = await import("./moyasar");
    expect(mod.isMoyasarConfigured()).toBe(false);
    expect(mod.isMoyasarInlineConfigured()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("treats whitespace-only keys as unconfigured (trim check)", async () => {
    vi.stubEnv("MOYASAR_SECRET_KEY", "   ");
    vi.stubEnv("MOYASAR_PUBLISHABLE_KEY", "   ");
    vi.resetModules();
    const mod = await import("./moyasar");
    expect(mod.isMoyasarConfigured()).toBe(false);
    expect(mod.isMoyasarInlineConfigured()).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("getMoyasarPublishableKey / getMoyasarSiteUrl / getMoyasarApplePayLabel", () => {
  it("returns the publishable key trimmed, or null when missing", async () => {
    vi.stubEnv("MOYASAR_PUBLISHABLE_KEY", "  pk_test_trim  ");
    vi.resetModules();
    const mod = await import("./moyasar");
    expect(mod.getMoyasarPublishableKey()).toBe("pk_test_trim");
    vi.unstubAllEnvs();

    vi.stubEnv("MOYASAR_PUBLISHABLE_KEY", "");
    vi.resetModules();
    const mod2 = await import("./moyasar");
    expect(mod2.getMoyasarPublishableKey()).toBeNull();
    vi.unstubAllEnvs();
  });

  it("returns the configured site URL (trimmed of trailing slash)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://staging.citymarkets.sa/");
    vi.resetModules();
    const mod = await import("./moyasar");
    expect(mod.getMoyasarSiteUrl()).toBe("https://staging.citymarkets.sa");
    vi.unstubAllEnvs();
  });

  it("returns the configured Apple Pay label, falling back to brand default", async () => {
    vi.stubEnv("MOYASAR_APPLE_PAY_LABEL", "");
    vi.resetModules();
    const mod = await import("./moyasar");
    expect(mod.getMoyasarApplePayLabel()).toBe("سيتي ماركت");
    vi.unstubAllEnvs();

    vi.stubEnv("MOYASAR_APPLE_PAY_LABEL", "  City Markets  ");
    const mod2 = await import("./moyasar");
    expect(mod2.getMoyasarApplePayLabel()).toBe("City Markets");
    vi.unstubAllEnvs();
  });
});

describe("createInvoice", () => {
  afterEach(() => {
    restoreFetch();
  });

  it("returns an error when no secret key is set", async () => {
    vi.stubEnv("MOYASAR_SECRET_KEY", "");
    vi.resetModules();
    const mod = await import("./moyasar");
    const res = await mod.createInvoice({
      amount: 50,
      orderId: "order-1",
      description: "طلب سيتي ماركت #abc",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/ميسر/);
  });

  it("POSTs to /invoices with Basic auth, all enabled methods, and idempotency key", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    mockFetch(async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({ id: "inv_123", url: "https://moyasar.com/i/inv_123" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const res = await createInvoice({
      amount: 75.5,
      orderId: "order-xyz-9999",
      description: "طلب رقم",
      customerName: "محمد",
      idempotencyKey: "idem-abc-1234567890",
    });

    expect(res.success).toBe(true);
    expect(res.paymentUrl).toBe("https://moyasar.com/i/inv_123");
    expect(res.invoiceId).toBe("inv_123");
    expect(capturedUrl).toContain("/invoices");
    // Basic auth header is base64("sk_test_secret:")
    const authHeader = (capturedInit?.headers as Record<string, string>).Authorization;
    expect(authHeader).toMatch(/^Basic /);
    const decoded = Buffer.from(authHeader!.slice(6), "base64").toString();
    expect(decoded).toBe("sk_test_secret:");

    // Body assertions
    const body = JSON.parse(capturedInit!.body as string);
    expect(body.amount).toBe(7550); // 75.5 * 100
    expect(body.currency).toBe("SAR");
    expect(body.methods).toEqual(["card", "mada", "applepay", "stcpay"]);
    expect(body.metadata.order_id).toBe("order-xyz-9999");
    expect(body.metadata.customer_name).toBe("محمد");
    expect(body.idempotency_key).toBe("idem-abc-1234567890");
    expect(body.success_url).toContain("/checkout/success?order_id=");
    expect(body.back_url).toMatch(/\/checkout$/);
    // Canonical HMAC-authenticated webhook (was /api/v1/payments/moyasar/callback,
    // a legacy duplicate removed in the 2026-09-29 production-completion audit).
    expect(body.callback_url).toContain("/api/v1/payments/webhook");
  });

  it("omits idempotency_key when not provided", async () => {
    let body = "";
    mockFetch(async (_input, init) => {
      body = init?.body as string;
      return new Response(JSON.stringify({ id: "inv_x", url: "https://x" }), { status: 200 });
    });

    await createInvoice({
      amount: 10,
      orderId: "o1",
      description: "d",
    });

    const parsed = JSON.parse(body);
    expect("idempotency_key" in parsed).toBe(false);
  });

  it("truncates idempotency_key to 64 chars (provider limit)", async () => {
    let body = "";
    mockFetch(async (_input, init) => {
      body = init?.body as string;
      return new Response(JSON.stringify({ id: "inv_x", url: "https://x" }), { status: 200 });
    });

    await createInvoice({
      amount: 10,
      orderId: "o1",
      description: "d",
      idempotencyKey: "x".repeat(200),
    });

    const parsed = JSON.parse(body);
    expect(parsed.idempotency_key.length).toBe(64);
  });

  it("truncates description to 500 chars and customer name to 100", async () => {
    let body = "";
    mockFetch(async (_input, init) => {
      body = init?.body as string;
      return new Response(JSON.stringify({ id: "inv_x", url: "https://x" }), { status: 200 });
    });

    await createInvoice({
      amount: 10,
      orderId: "o1",
      description: "d".repeat(800),
      customerName: "n".repeat(200),
    });

    const parsed = JSON.parse(body);
    expect(parsed.description.length).toBe(500);
    expect(parsed.metadata.customer_name.length).toBe(100);
  });

  it("surfaces provider message + field errors on HTTP 4xx", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          message: "Bad amount",
          errors: { amount: ["must be positive"] },
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await createInvoice({ amount: 10, orderId: "o1", description: "d" });
    expect(res.success).toBe(false);
    // BUGFIX (audit 2026-09-29): "amount" maps to a sanitised Arabic
    // message instead of echoing "Bad amount" to the customer.
    expect(res.error).toBe("قيمة الطلب غير صحيحة");
  });

  it("falls back to field errors when no top-level message", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ errors: { amount: ["too low"] } }), { status: 422 }),
    );

    const res = await createInvoice({ amount: 10, orderId: "o1", description: "d" });
    expect(res.success).toBe(false);
    // BUGFIX (audit 2026-09-29): the field-errors branch joins the
    // values ("too low") — that string doesn't contain "amount" or
    // "currency" keywords so it falls through to the generic 4xx
    // Arabic message rather than echoing the raw English value.
    expect(res.error).toBe("تعذّر إنشاء الفاتورة، حاول مرة أخرى");
  });

  it("falls back to HTTP status when no message and no errors", async () => {
    mockFetch(async () => new Response("{}", { status: 500 }));
    const res = await createInvoice({ amount: 10, orderId: "o1", description: "d" });
    // BUGFIX (audit 2026-09-29): 5xx → friendly "gateway temporarily
    // unavailable" Arabic. The previous `Moyasar HTTP 500` leak was
    // shipping the gateway name + status to end users.
    expect(res.error).toBe("بوابة الدفع غير متاحة مؤقتاً، حاول بعد قليل");
  });

  it("returns error when response is missing id or url", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ id: "inv_no_url" }), { status: 200 }),
    );
    const res = await createInvoice({ amount: 10, orderId: "o1", description: "d" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/غير صالحة/);
  });

  it("returns error when fetch throws (network failure)", async () => {
    mockFetch(async () => {
      throw new Error("ECONNRESET");
    });
    const res = await createInvoice({ amount: 10, orderId: "o1", description: "d" });
    expect(res.success).toBe(false);
    // BUGFIX (audit 2026-09-29): the previous version returned
    // `error.message` ("ECONNRESET") to the caller — replaced with a
    // generic Arabic message.
    expect(res.error).toBe("تعذّر الاتصال بميسر");
  });
});

describe("fetchInvoiceDetails / fetchInvoice", () => {
  afterEach(() => {
    restoreFetch();
  });

  it("returns amount + status from the invoice endpoint", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ status: "paid", amount: 5000 }), { status: 200 }),
    );
    const res = await fetchInvoiceDetails("inv_1");
    expect(res.success).toBe(true);
    expect(res.status).toBe("paid");
    expect(res.amountHalalas).toBe(5000);
  });

  it("surfaces provider message on non-2xx", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ message: "not found" }), { status: 404 }),
    );
    const res = await fetchInvoiceDetails("inv_missing");
    expect(res.success).toBe(false);
    // BUGFIX (audit 2026-09-29): we no longer echo the raw gateway
    // message — it's logged server-side and translated to a friendly
    // Arabic message. 404 falls into the generic 4xx bucket.
    expect(res.error).toBe("تعذّر إنشاء الفاتورة، حاول مرة أخرى");
  });

  it("fetchInvoice returns just the status", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ status: "initiated" }), { status: 200 }),
    );
    const res = await fetchInvoice("inv_2");
    expect(res.success).toBe(true);
    expect(res.status).toBe("initiated");
  });

  it("returns error when no secret key", async () => {
    vi.stubEnv("MOYASAR_SECRET_KEY", "");
    vi.resetModules();
    const mod = await import("./moyasar");
    const res = await mod.fetchInvoiceDetails("inv_1");
    expect(res.success).toBe(false);
  });
});

describe("fetchPayment", () => {
  afterEach(() => {
    restoreFetch();
  });

  it("returns id, status, amountHalalas, currency, metadata", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          id: "pay_1",
          status: "paid",
          amount: 2500,
          currency: "SAR",
          metadata: { order_id: "ord_42" },
        }),
        { status: 200 },
      ),
    );
    const res = await fetchPayment("pay_1");
    expect(res).toMatchObject({
      success: true,
      id: "pay_1",
      status: "paid",
      amountHalalas: 2500,
      currency: "SAR",
      metadata: { order_id: "ord_42" },
    });
  });

  it("surfaces provider message on 4xx", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ message: "forbidden" }), { status: 403 }),
    );
    const res = await fetchPayment("pay_bad");
    expect(res.success).toBe(false);
    // BUGFIX (audit 2026-09-29): 401/403 → Arabic "auth gateway" message,
    // raw gateway text is logged but never returned to the caller.
    expect(res.error).toBe("تعذّر التحقق من بوابة الدفع");
  });

  it("returns error when no secret key", async () => {
    vi.stubEnv("MOYASAR_SECRET_KEY", "");
    vi.resetModules();
    const mod = await import("./moyasar");
    const res = await mod.fetchPayment("pay_1");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/ميسر/);
  });
});

describe("mapMoyasarStatusToDb (P1-2/3/4)", () => {
  it("maps 'paid' and 'captured' to 'paid'", () => {
    expect(mapMoyasarStatusToDb("paid")).toBe("paid");
    expect(mapMoyasarStatusToDb("captured")).toBe("paid");
  });

  it("maps 'failed', 'voided' to 'failed' and 'refunded' to 'refunded'", () => {
    // PCP-81 — the customer's terminal state for a refund is 'refunded',
    // not a generic failure. Previously 'refunded' mapped to 'failed'
    // (and inline-confirm had it as 'pending' before that), which meant
    // the admin dashboard and customer timeline could not distinguish
    // a refund from a chargeback or a void.
    expect(mapMoyasarStatusToDb("failed")).toBe("failed");
    expect(mapMoyasarStatusToDb("voided")).toBe("failed");
    expect(mapMoyasarStatusToDb("refunded")).toBe("refunded");
  });

  it("defaults unknown statuses to 'pending'", () => {
    expect(mapMoyasarStatusToDb("initiated")).toBe("pending");
    expect(mapMoyasarStatusToDb("")).toBe("pending");
    expect(mapMoyasarStatusToDb("anything-else")).toBe("pending");
  });
});

describe("isSarCurrency (P1-3)", () => {
  it("returns true when currency is undefined or null (gateway may omit)", () => {
    // Gateways occasionally omit currency for refund / void events.
    // Treating absence as SAR lets the rest of the pipeline run.
    expect(isSarCurrency(undefined)).toBe(true);
    expect(isSarCurrency(null)).toBe(true);
    expect(isSarCurrency("")).toBe(true);
  });

  it("accepts exact 'SAR' regardless of whitespace / casing", () => {
    expect(isSarCurrency("SAR")).toBe(true);
    expect(isSarCurrency("sar")).toBe(true);
    expect(isSarCurrency("Sar")).toBe(true);
    expect(isSarCurrency("  SAR  ")).toBe(true);
  });

  it("rejects non-SAR currencies", () => {
    expect(isSarCurrency("USD")).toBe(false);
    expect(isSarCurrency("KWD")).toBe(false);
    expect(isSarCurrency("EUR")).toBe(false);
  });
});
