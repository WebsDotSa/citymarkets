import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  pool: { query: mocks.poolQuery },
}));

vi.mock('@/lib/identity', () => ({
  resolveCustomerUserIdFromRequest: mocks.resolveUser,
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { PUT } from "./route";

function requestWith(messages: unknown[]) {
  return new NextRequest("http://localhost/api/v1/ai-chat/history", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
  });
}

describe("PUT /api/v1/ai-chat/history rich message normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveUser.mockResolvedValue("customer-1");
    mocks.poolQuery.mockResolvedValue({
      rows: [
        {
          id: "session-1",
          created_at: "2026-08-02T10:00:00.000Z",
        },
      ],
    });
  });

  it("preserves valid voice mode and sanitized product snapshots", async () => {
    const response = await PUT(
      requestWith([
        {
          id: "assistant-1",
          role: "assistant",
          content: "تمت الإضافة",
          timestamp: "2026-08-02T10:00:00.000Z",
          inputMode: "voice",
          matchedProducts: [
            {
              productId: "product-1",
              name: "حليب كامل الدسم",
              imageUrl: "/images/milk.jpg",
              unit: "1 لتر",
              displayPrice: 7.5,
              originalPrice: 9,
              vendorName: "أسواق سيتي",
              quantity: 2,
              query: "حليب",
              addedToCart: true,
              ignored: "not persisted",
            },
          ],
        },
      ])
    );

    expect(response.status).toBe(200);
    const persisted = JSON.parse(mocks.poolQuery.mock.calls[0][1][1]);
    expect(persisted[0].inputMode).toBe("voice");
    expect(persisted[0].matchedProducts).toEqual([
      {
        productId: "product-1",
        vendorId: null,
        name: "حليب كامل الدسم",
        imageUrl: "/images/milk.jpg",
        unit: "1 لتر",
        displayPrice: 7.5,
        originalPrice: 9,
        vendorName: "أسواق سيتي",
        quantity: 2,
        query: "حليب",
        addedToCart: true,
      },
    ]);
  });

  it("caps product snapshots and clamps quantities", async () => {
    const matchedProducts = Array.from({ length: 20 }, (_, index) => ({
      productId: `product-${index}`,
      name: `منتج ${index}`,
      imageUrl: null,
      unit: null,
      displayPrice: index + 1,
      originalPrice: null,
      vendorName: null,
      quantity: index === 0 ? 999 : 1,
      query: `منتج ${index}`,
      addedToCart: true,
    }));

    await PUT(
      requestWith([
        {
          id: "assistant-1",
          role: "assistant",
          content: "تمت الإضافة",
          timestamp: "2026-08-02T10:00:00.000Z",
          matchedProducts,
        },
      ])
    );

    const persisted = JSON.parse(mocks.poolQuery.mock.calls[0][1][1]);
    expect(persisted[0].matchedProducts).toHaveLength(12);
    expect(persisted[0].matchedProducts[0].quantity).toBe(99);
    expect(persisted[0].matchedProducts.at(-1).productId).toBe("product-11");
  });

  it("drops malformed product snapshots and invalid input modes", async () => {
    await PUT(
      requestWith([
        {
          id: "assistant-1",
          role: "assistant",
          content: "تمت الإضافة",
          timestamp: "2026-08-02T10:00:00.000Z",
          inputMode: "camera",
          matchedProducts: [
            { productId: "", name: "حليب", quantity: 1, query: "حليب" },
            { productId: "product-1", name: "", quantity: 1, query: "حليب" },
            null,
          ],
        },
      ])
    );

    const persisted = JSON.parse(mocks.poolQuery.mock.calls[0][1][1]);
    expect(persisted[0].inputMode).toBeUndefined();
    expect(persisted[0].matchedProducts).toBeUndefined();
  });
});
