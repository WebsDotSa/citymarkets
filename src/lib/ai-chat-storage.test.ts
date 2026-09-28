import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ChatInputMode,
  ChatProductResult,
} from "./ai-chat-client-types";
import {
  AI_CHAT_WELCOME_ID,
  aiChatStorageKey,
  loadChatFromLocalStorage,
  saveChatToLocalStorage,
  toStoredMessages,
  type StoredChatMessage,
} from "./ai-chat-storage";

const productResult: ChatProductResult = {
  productId: "11111111-1111-4111-8111-111111111111",
  name: "حليب كامل الدسم",
  imageUrl: "/images/milk.jpg",
  unit: "1 لتر",
  displayPrice: 7.5,
  originalPrice: 9,
  vendorName: "أسواق سيتي",
  quantity: 2,
  query: "حليب",
  addedToCart: true,
  vendorId: "v-1",
};

describe("ai-chat storage rich messages", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("persists voice input mode and compact matched-product snapshots", () => {
    const inputMode: ChatInputMode = "voice";
    const stored = toStoredMessages([
      {
        id: "voice-1",
        role: "user",
        content: "أضف حبتين حليب",
        timestamp: new Date("2026-08-02T10:00:00.000Z"),
        inputMode,
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "تمت الإضافة",
        timestamp: new Date("2026-08-02T10:00:01.000Z"),
        matchedProducts: [productResult],
      },
    ]);

    expect(stored[0].inputMode).toBe("voice");
    expect(stored[1].matchedProducts).toEqual([productResult]);
  });

  it("round-trips rich messages while accepting legacy messages", () => {
    const key = aiChatStorageKey("customer-1");
    const messages: StoredChatMessage[] = [
      {
        id: "legacy-1",
        role: "assistant",
        content: "رسالة قديمة",
        timestamp: "2026-08-02T09:00:00.000Z",
        addedToCart: ["حليب × 1"],
      },
      {
        id: "rich-1",
        role: "assistant",
        content: "رسالة جديدة",
        timestamp: "2026-08-02T10:00:00.000Z",
        inputMode: "voice",
        matchedProducts: [productResult],
      },
    ];

    saveChatToLocalStorage(key, messages);
    const loaded = loadChatFromLocalStorage(key);

    expect(loaded?.[0].id).toBe(AI_CHAT_WELCOME_ID);
    expect(loaded?.[1].addedToCart).toEqual(["حليب × 1"]);
    expect(loaded?.[1].matchedProducts).toBeUndefined();
    expect(loaded?.[2].inputMode).toBe("voice");
    expect(loaded?.[2].matchedProducts).toEqual([productResult]);
  });

  it("keeps only the latest 80 persistable messages", () => {
    const messages = Array.from({ length: 85 }, (_, index) => ({
      id: index === 0 ? AI_CHAT_WELCOME_ID : `message-${index}`,
      role: "assistant" as const,
      content: `رسالة ${index}`,
      timestamp: new Date(2026, 7, 2, 10, index),
    }));

    const stored = toStoredMessages(messages);

    expect(stored).toHaveLength(80);
    expect(stored.some((message) => message.id === AI_CHAT_WELCOME_ID)).toBe(false);
    expect(stored.at(-1)?.id).toBe("message-84");
  });
});
