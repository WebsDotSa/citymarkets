import type {
  ChatInputMode,
  ChatProductResult,
  MealSuggestion,
} from "@/lib/ai-chat-client-types";

export const AI_CHAT_WELCOME_ID = "welcome";
const STORAGE_PREFIX = "citymarket_ai_chat_v1";
const MAX_STORED = 80;

export type StoredChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  inputMode?: ChatInputMode;
  matchedProducts?: ChatProductResult[];
  addedToCart?: string[];
  mealSuggestions?: MealSuggestion[];
  unmatched?: string[];
};

export function aiChatStorageKey(userId?: string | null): string {
  return userId
    ? `${STORAGE_PREFIX}:user:${userId}`
    : `${STORAGE_PREFIX}:guest`;
}

export function buildWelcomeMessage(): StoredChatMessage {
  return {
    id: AI_CHAT_WELCOME_ID,
    role: "assistant",
    content:
      "مرحباً في **مطبخ ومتجر سيتي** 👨‍🍳\n\n" +
      "• اسألني **وش أطبخ العشا؟** لأعرض أفكاراً مع **مكونات** تقدر تختار أي وجبة وتضيف أسبابها المتوفرة بالمتجر للسلة.\n" +
      "• أو قلّي **أبي أسوي كبسة** وسأبحث عن **منتجات** مناسبة في أسواق سيتي.",
    timestamp: new Date().toISOString(),
  };
}

export function isPersistableMessage(id: string): boolean {
  return id !== AI_CHAT_WELCOME_ID;
}

export function toStoredMessages(
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
    inputMode?: ChatInputMode;
    matchedProducts?: ChatProductResult[];
    addedToCart?: string[];
    mealSuggestions?: MealSuggestion[];
    unmatched?: string[];
  }[]
): StoredChatMessage[] {
  return messages
    .filter((m) => isPersistableMessage(m.id))
    .slice(-MAX_STORED)
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp:
        m.timestamp instanceof Date
          ? m.timestamp.toISOString()
          : String(m.timestamp),
      inputMode: m.inputMode,
      matchedProducts: m.matchedProducts,
      addedToCart: m.addedToCart,
      mealSuggestions: m.mealSuggestions,
      unmatched: m.unmatched,
    }));
}

export function fromStoredMessages(stored: StoredChatMessage[]): StoredChatMessage[] {
  const welcome = buildWelcomeMessage();
  if (!stored.length) return [welcome];
  return [welcome, ...stored];
}

export function loadChatFromLocalStorage(
  key: string
): StoredChatMessage[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(
      (m): m is StoredChatMessage =>
        Boolean(m) &&
        typeof m === "object" &&
        typeof (m as StoredChatMessage).id === "string" &&
        ((m as StoredChatMessage).role === "user" ||
          (m as StoredChatMessage).role === "assistant") &&
        typeof (m as StoredChatMessage).content === "string"
    );
    return valid.length > 0 ? fromStoredMessages(valid) : null;
  } catch {
    return null;
  }
}

export function saveChatToLocalStorage(
  key: string,
  messages: StoredChatMessage[]
): void {
  if (typeof window === "undefined") return;
  try {
    const toSave = messages.filter((m) => isPersistableMessage(m.id));
    localStorage.setItem(key, JSON.stringify(toSave.slice(-MAX_STORED)));
  } catch {
    /* quota / private mode */
  }
}

export function clearChatLocalStorage(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function countPersistedMessages(messages: StoredChatMessage[]): number {
  return messages.filter((m) => isPersistableMessage(m.id)).length;
}
