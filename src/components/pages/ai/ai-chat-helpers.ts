/**
 * Pure helpers + types for the AI chat page.
 *
 * Extracted from ai-chat-page.tsx so the main component can stay
 * focused on state orchestration + JSX. None of these touch React.
 */

import type { Product } from "@/lib/types";
import type { ChatProductResult } from '@/lib/catalog/ai-chat-client-types';
import type { MealSuggestion } from '@/lib/catalog/ai-shopping-assistant';
import {
  buildWelcomeMessage,
  type StoredChatMessage,
} from '@/lib/catalog';

export type MatchedProduct = {
  product: Product;
  quantity: number;
  query: string;
};

export type AiChatResponse = {
  success: boolean;
  reply?: string;
  error?: string;
  matched?: MatchedProduct[];
  unmatched?: string[];
  autoAdd?: boolean;
  mealSuggestions?: MealSuggestion[];
};

export type ChatInputMode = "text" | "voice";

/* ------------------------------------------------------------------------- */
/* Quick-pick suggestions shown under the composer when the chat is empty   */
/* ------------------------------------------------------------------------- */

export const SUGGESTIONS: { text: string; emoji: string }[] = [
  { text: "وش أطبخ العشا؟", emoji: "🌙" },
  { text: "أبي أسوي كبسة", emoji: "🍗" },
  { text: "فطور سريع للعائلة", emoji: "🥐" },
  { text: "حليب وخبز وبيض", emoji: "🛒" },
];

/* ------------------------------------------------------------------------- */
/* Message mappers                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Convert the AI server's `matched` array into the display-shape used
 * by `ChatMessageBubble`. Single source of truth — both the initial
 * reply path and the "match ingredients" path call this so the bubble
 * doesn't have to know about `Product`.
 */
export function toChatProductResults(
  matched: MatchedProduct[],
  addedToCart: boolean,
): ChatProductResult[] {
  return matched.map(({ product, quantity, query }) => {
    const listPrice = Number(product.price) || 0;
    const displayPrice = Number(
      product.effective_price ?? product.discount_price ?? listPrice,
    );

    return {
      productId: product.id,
      vendorId: product.vendor_id || null,
      name: product.name_ar,
      imageUrl: product.image_url || product.images?.[0] || null,
      unit: product.unit || null,
      displayPrice: Number.isFinite(displayPrice) ? displayPrice : listPrice,
      originalPrice: listPrice > displayPrice ? listPrice : null,
      vendorName: product.vendor_name || null,
      quantity,
      query,
      addedToCart,
    };
  });
}

/** Hydrate a stored message back into the in-memory UI shape. */
export function storedToUiMessages<T extends StoredChatMessage>(
  stored: T[],
): Array<Omit<T, "timestamp"> & { timestamp: Date }> {
  // We can't perfectly re-export the ChatMessage type from here (it would
  // create a circular import with chat-message-bubble.tsx) so callers
  // rely on the runtime shape — `timestamp` switches from `string`
  // (stored) to `Date` (in-memory). This helper stays loose so both
  // shapes compile.
  return stored.map((message) => ({
    ...(message as object),
    timestamp: new Date(message.timestamp),
  })) as Array<Omit<T, "timestamp"> & { timestamp: Date }>;
}

/** Build the very first conversation (just the welcome message). */
export function defaultMessages() {
  // Re-exported as a function so callers can call it lazily; this matches
  // the original behavior where `useState(() => defaultMessages())` only
  // runs once on mount.
  const welcome = buildWelcomeMessage();
  return storedToUiMessages([welcome]);
}

/* ------------------------------------------------------------------------- */
/* Error formatting                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Distinguish auth failures from generic ones so the chat can show a
 * helpful next-step ("sign in to continue") vs a generic retry prompt.
 *
 * Server errors are typically localized Arabic strings, so we match on
 * well-known phrases plus the English `unauthor`/`Auth` literals.
 */
export function friendlyError(
  caught: unknown,
  fallbackMessage: string,
  authHint: string,
): string {
  const rawMessage =
    caught instanceof Error && caught.message ? caught.message : "";
  if (!rawMessage) return fallbackMessage;
  const isAuthError =
    rawMessage.includes("تسجيل الدخول") ||
    rawMessage.includes("مصادقة") ||
    rawMessage.includes("unauthor") ||
    rawMessage.includes("Auth");
  return isAuthError ? `${authHint} (${rawMessage})` : `${fallbackMessage}: ${rawMessage}`;
}

/* ------------------------------------------------------------------------- */
/* Phone validation                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Accept Saudi local (05xxxxxxxx, 10 digits) or E.164 international
 * (+966…). Lenient on length — anything 9-15 digits passes.
 */
export function validatePhone(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15;
}
