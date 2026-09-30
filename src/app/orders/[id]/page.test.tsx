import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// P1-9 (full-system audit 2026-09-30): regression — the /orders/[id]
// route used to 404 because no `app/orders/[id]/page.tsx` existed.
// Customers were routed to an in-state detail view inside
// `OrdersNew` instead. The route was added but never had a test;
// this file pins the contract so a future refactor that breaks the
// import path is caught immediately.

// Mock the heavy detail client so jsdom doesn't pull in the polling
// + invoice + chat surface area. The route's only job is to forward
// `params.id` to `OrderDetailClient`.
const mockedId = vi.hoisted(() => ({ received: "" }));
vi.mock("@/components/pages/direct-order/order-detail-client", () => ({
  OrderDetailClient: ({ orderId }: { orderId: string }) => {
    mockedId.received = orderId;
    return <div data-testid="order-detail" data-order-id={orderId} />;
  },
}));

// Mock `next/navigation` so `useRouter` (used elsewhere) doesn't blow up
// if the detail client is ever wired in. Pure safety net.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

import OrderDetailPage from "./page";

describe("GET /orders/[id] page (P1-9)", () => {
  it("forwards params.id to OrderDetailClient", async () => {
    const Page = await OrderDetailPage({
      params: Promise.resolve({ id: "abc-123" }),
    } as never);
    // `OrderDetailPage` is a server component that returns JSX; render
    // it through React's testing renderer to inspect the forwarded id.
    render(Page as React.ReactElement);
    const detail = screen.getByTestId("order-detail");
    expect(detail).toHaveAttribute("data-order-id", "abc-123");
    expect(mockedId.received).toBe("abc-123");
  });
});