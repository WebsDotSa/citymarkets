import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockRouterPush = vi.fn();
const mocks = vi.hoisted(() => ({
  csrfFetch: vi.fn(),
  readCsrfToken: vi.fn(),
}));

vi.mock("@/lib/csrf-client", () => ({
  csrfFetch: mocks.csrfFetch,
  readCsrfToken: mocks.readCsrfToken,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn(), back: vi.fn() }),
}));
vi.mock(import('@/lib/orders'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    PAYMENT_METHOD_AR: {
      mada: "مدى",
      visa: "فيزا",
      mastercard: "ماستركارد",
      apple_pay: "Apple Pay",
      stc_pay: "STC Pay",
    },
  };
});

import { OrderPaymentAction } from "./order-payment-action";

const ORDER = "22222222-aaaa-bbbb-cccc-333333333333";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readCsrfToken.mockReturnValue("csrf-token");
});

describe("OrderPaymentAction", () => {
  it("renders nothing for terminal/paid orders (action = none)", () => {
    const { container } = render(
      <OrderPaymentAction
        orderId={ORDER}
        status="delivered"
        paymentStatus="paid"
        paymentMethod="mada"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows 'إعادة الدفع' for cancelled+failed orders and POSTs the retry API", async () => {
    mocks.csrfFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        mode: "hosted",
        paymentUrl: "https://pay.example/hosted",
        paymentReference: "inv-1",
        total: 50,
        paymentMethod: "mada",
        totalSar: 50,
      }),
    });
    // Spy on window.location.href assignment.
    const originalLocation = window.location;
    delete (window as unknown as { location: unknown }).location;
    (window as unknown as { location: { href: string } }).location = { href: "" };

    render(
      <OrderPaymentAction
        orderId={ORDER}
        status="cancelled"
        paymentStatus="failed"
        paymentMethod="mada"
      />,
    );
    const submit = screen.getByTestId("order-payment-submit");
    expect(submit.textContent).toBe("إعادة الدفع");
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.csrfFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mocks.csrfFetch.mock.calls[0];
    expect(url).toBe("/api/v1/payments/retry");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.orderId).toBe(ORDER);
    expect(body.paymentMethod).toBe("mada");
    expect(body.idempotencyKey).toBe(`${ORDER}:mada`);

    // Hosted URL navigation
    await waitFor(() =>
      expect(window.location.href).toBe("https://pay.example/hosted"),
    );

    (window as unknown as { location: typeof originalLocation }).location = originalLocation;
  });

  it("shows 'ادفع إلكترونياً' for unpaid orders and navigates inline to /checkout/pay", async () => {
    mocks.csrfFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        mode: "inline",
        paymentUrl: null,
        paymentReference: null,
        total: 80,
        paymentMethod: "mada",
        totalSar: 80,
      }),
    });
    render(
      <OrderPaymentAction
        orderId={ORDER}
        status="pending"
        paymentStatus="unpaid"
        paymentMethod="mada"
      />,
    );
    const submit = screen.getByTestId("order-payment-submit");
    expect(submit.textContent).toBe("ادفع إلكترونياً");
    fireEvent.click(submit);
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledTimes(1));
    expect(mockRouterPush.mock.calls[0][0]).toBe(
      `/checkout/pay?order_id=${ORDER}&method=mada`,
    );
  });

  it("displays the Arabic error message and does not navigate on a 502", async () => {
    mocks.csrfFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({
        success: false,
        error: "تعذّر فتح بوابة الدفع الإلكتروني",
      }),
    });
    render(
      <OrderPaymentAction
        orderId={ORDER}
        status="pending"
        paymentStatus="unpaid"
        paymentMethod="mada"
      />,
    );
    fireEvent.click(screen.getByTestId("order-payment-submit"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("تعذّر فتح بوابة الدفع الإلكتروني");
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("prevents double-submit while a request is in flight", async () => {
    let resolve: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve = r;
    });
    mocks.csrfFetch.mockReturnValueOnce(pending as unknown as Promise<Response>);
    render(
      <OrderPaymentAction
        orderId={ORDER}
        status="pending"
        paymentStatus="unpaid"
        paymentMethod="mada"
      />,
    );
    const submit = screen.getByTestId("order-payment-submit") as HTMLButtonElement;
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(mocks.csrfFetch).toHaveBeenCalledTimes(1);
    resolve({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        mode: "hosted",
        paymentUrl: "https://pay.example/x",
        paymentReference: "inv-1",
        total: 50,
        paymentMethod: "mada",
        totalSar: 50,
      }),
    });
  });

  it("switches method selection before submitting", async () => {
    mocks.csrfFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        mode: "hosted",
        paymentUrl: "https://pay.example/x",
        paymentReference: "inv-1",
        total: 50,
        paymentMethod: "visa",
        totalSar: 50,
      }),
    });
    delete (window as unknown as { location: unknown }).location;
    (window as unknown as { location: { href: string } }).location = { href: "" };
    render(
      <OrderPaymentAction
        orderId={ORDER}
        status="pending"
        paymentStatus="unpaid"
        paymentMethod="mada"
      />,
    );
    fireEvent.click(screen.getByTestId("order-payment-method-visa"));
    fireEvent.click(screen.getByTestId("order-payment-submit"));
    await waitFor(() => expect(mocks.csrfFetch).toHaveBeenCalled());
    const body = JSON.parse(mocks.csrfFetch.mock.calls[0][1].body as string);
    expect(body.paymentMethod).toBe("visa");
    expect(body.idempotencyKey).toBe(`${ORDER}:visa`);
  });
});
