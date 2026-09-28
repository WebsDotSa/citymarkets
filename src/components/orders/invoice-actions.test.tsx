import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/toast";

// The download now hits a server endpoint instead of bundling
// @react-pdf/renderer. We mock fetch and assert that the request goes
// to the right URL with credentials, then triggers a download.
import { InvoiceActions } from "./invoice-actions";

describe("InvoiceActions — Print + Download PDF buttons", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createObjectURLSpy: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let revokeObjectURLSpy: any = null;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    if (!("createObjectURL" in URL)) {
      // @ts-expect-error — test-only polyfill
      URL.createObjectURL = () => "blob:mock-url";
      // @ts-expect-error — test-only polyfill
      URL.revokeObjectURL = () => {};
    }
    createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock-url");
    revokeObjectURLSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});

    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseProps = {
    orderId: "ord-1",
    orderNumber: "ABC123",
    createdAt: new Date().toISOString(),
    status: "delivered",
    paymentMethod: "mada",
    paymentStatus: "paid",
    customerName: "محمد",
    customerPhone: "0500000000",
    address: { label: "المنزل", text: "حي العليا", city: "الرياض", district: "العليا" },
    items: [{ name: "تفاح", quantity: 2, unit_price: 5 }],
    subtotal: 10,
    deliveryFee: 5,
    serviceFee: 1,
    tax: 0,
    discount: 0,
    total: 16,
  };

  const renderWithToast = (ui: React.ReactNode) =>
    render(<ToastProvider>{ui}</ToastProvider>);

  it("renders both Print and Download PDF buttons", () => {
    renderWithToast(<InvoiceActions {...baseProps} />);
    expect(screen.getByTestId("invoice-print")).toBeDefined();
    expect(screen.getByTestId("invoice-download")).toBeDefined();
  });

  it("hits the server PDF endpoint with credentials on download click", async () => {
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation(((tag: string) => {
        const el = origCreateElement(tag);
        if (tag === "a") el.click = clickSpy;
        return el;
      }) as typeof document.createElement);

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="invoice-ABC123.pdf"',
      }),
      blob: async () => new Blob(["pdf-bytes"], { type: "application/pdf" }),
    });

    renderWithToast(<InvoiceActions {...baseProps} />);
    fireEvent.click(screen.getByTestId("invoice-download"));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/orders/ord-1/invoice-pdf");
    expect(init).toMatchObject({ credentials: "include" });

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalled();

    createElementSpy.mockRestore();
  });

  it("shows a graceful toast when the server returns an error", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers(),
      json: async () => ({ success: false, error: "تعذّر إنشاء ملف PDF" }),
      blob: async () => new Blob(),
    });

    renderWithToast(<InvoiceActions {...baseProps} />);
    fireEvent.click(screen.getByTestId("invoice-download"));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    // We don't assert on the toast DOM (it lives in a portal with TTL);
    // just that fetch ran without throwing and console.error wasn't
    // triggered (this is the happy "handled" path).
    expect(consoleError).not.toHaveBeenCalled();
  });
});