import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL = { ...process.env };

vi.mock("./moyasar", async (orig) => {
  const actual = await orig<typeof import("./moyasar")>();
  return {
    ...actual,
    isMoyasarConfigured: () => Boolean(process.env.MOYASAR_SECRET_KEY),
    isMoyasarInlineConfigured: () => Boolean(process.env.MOYASAR_PUBLISHABLE_KEY),
    createInvoice: vi.fn(),
  };
});

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(ORIGINAL)) {
    process.env[k] = v;
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getPaymentProvider", () => {
  it("returns 'none' when no provider is configured", async () => {
    delete process.env.PAYMENT_PROVIDER;
    delete process.env.MOYASAR_SECRET_KEY;
    const mod = await import("./initiate");
    expect(mod.getPaymentProvider()).toBe("none");
  });

  it("returns 'moyasar' when MOYASAR_SECRET_KEY is set", async () => {
    delete process.env.PAYMENT_PROVIDER;
    process.env.MOYASAR_SECRET_KEY = "secret";
    const mod = await import("./initiate");
    expect(mod.getPaymentProvider()).toBe("moyasar");
  });

  it("ignores PAYMENT_PROVIDER overrides that point at unsupported providers", async () => {
    process.env.PAYMENT_PROVIDER = "myfatoorah";
    process.env.MOYASAR_SECRET_KEY = "secret";
    const mod = await import("./initiate");
    expect(mod.getPaymentProvider()).toBe("moyasar");
  });
});

describe("isMoyasarInlineCheckoutEnabled", () => {
  it("is true only when provider is moyasar AND inline keys are set", async () => {
    process.env.MOYASAR_SECRET_KEY = "secret";
    process.env.MOYASAR_PUBLISHABLE_KEY = "pub";
    delete process.env.PAYMENT_PROVIDER;
    const mod = await import("./initiate");
    expect(mod.isMoyasarInlineCheckoutEnabled()).toBe(true);
  });

  it("is false when provider is 'none'", async () => {
    delete process.env.PAYMENT_PROVIDER;
    delete process.env.MOYASAR_SECRET_KEY;
    process.env.MOYASAR_PUBLISHABLE_KEY = "pub";
    const mod = await import("./initiate");
    expect(mod.isMoyasarInlineCheckoutEnabled()).toBe(false);
  });

  it("is false when inline keys are not configured", async () => {
    process.env.MOYASAR_SECRET_KEY = "secret";
    delete process.env.MOYASAR_PUBLISHABLE_KEY;
    delete process.env.PAYMENT_PROVIDER;
    const mod = await import("./initiate");
    expect(mod.isMoyasarInlineCheckoutEnabled()).toBe(false);
  });
});

describe("initiateOnlinePayment", () => {
  it("returns success:false with 'none' provider when no provider is configured", async () => {
    delete process.env.PAYMENT_PROVIDER;
    delete process.env.MOYASAR_SECRET_KEY;
    const mod = await import("./initiate");
    const out = await mod.initiateOnlinePayment({
      amount: 100,
      orderId: "order-1",
      customerName: "Mohammed",
      customerMobile: "+966500000000",
      items: [],
    });
    expect(out).toEqual({
      success: false,
      provider: "none",
      error: "بوابة الدفع غير مُعدّة",
    });
  });

  it("routes to Moyasar when configured", async () => {
    delete process.env.PAYMENT_PROVIDER;
    process.env.MOYASAR_SECRET_KEY = "secret";
    const { initiateOnlinePayment } = await import("./initiate");
    const { createInvoice } = await import("./moyasar");
    (createInvoice as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      paymentUrl: "https://moyasar.example/invoice/1",
      invoiceId: "INV-1",
    });
    const out = await initiateOnlinePayment({
      amount: 200,
      orderId: "order-moyasar-123456789",
      customerName: "Sara",
      customerMobile: "+966500000001",
      items: [{ name: "X", quantity: 1, unitPrice: 200 }],
      idempotencyKey: "idem-1",
    });
    expect(out).toMatchObject({
      success: true,
      provider: "moyasar",
      paymentUrl: "https://moyasar.example/invoice/1",
      referenceId: "INV-1",
    });
    expect(createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 200,
        idempotencyKey: "idem-1",
        description: expect.stringContaining("سيتي ماركت"),
      }),
    );
  });
});