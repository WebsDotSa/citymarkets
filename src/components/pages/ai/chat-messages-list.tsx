"use client";

/**
 * ChatMessagesList
 *
 * Middle column — only this column scrolls. Renders the bubble for each
 * message via `ChatMessageBubble`, plus the "thinking…" indicator when
 * a request is in flight. The parent owns the scroll-end ref so it can
 * auto-scroll on every new message.
 *
 * Top + bottom fade masks hint at the pinned header / composer behind
 * them. The `pb-[calc(...)]` reserves space at the bottom for the pinned
 * composer + BottomNavV2, so messages never sit under either of them.
 */

import { ChefHat } from "lucide-react";
import type { MealSuggestion } from '@/lib/catalog';
import {
  ChatMessageBubble,
  type ChatMessage,
} from "./chat-message-bubble";

export interface ChatMessagesListProps {
  messages: ChatMessage[];
  loading: boolean;
  isVoiceProcessing: boolean;
  mealLoadingId: string | null;
  onAddMeal: (meal: MealSuggestion) => Promise<void>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

export function ChatMessagesList({
  messages,
  loading,
  isVoiceProcessing,
  mealLoadingId,
  onAddMeal,
  messagesEndRef,
}: ChatMessagesListProps) {
  return (
    <div
      className="relative flex-1 overflow-y-auto overscroll-contain px-3 sm:px-6 pb-[calc(220px+env(safe-area-inset-bottom,0px))] md:pb-[180px]"
      style={{
        maskImage:
          "linear-gradient(to bottom, transparent 0, black 18px, black calc(100% - 22px), transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0, black 18px, black calc(100% - 22px), transparent 100%)",
      }}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 pb-4 pt-3">
        {messages.map((msg) => (
          <ChatMessageBubble
            key={msg.id}
            message={msg}
            mealLoadingId={mealLoadingId}
            onAddMeal={onAddMeal as (meal: MealSuggestion) => void}
          />
        ))}

        {loading ? <ThinkingDots isVoiceProcessing={isVoiceProcessing} /> : null}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

function ThinkingDots({ isVoiceProcessing }: { isVoiceProcessing: boolean }) {
  return (
    <div
      className="flex gap-2.5 animate-fade-in"
      aria-live="polite"
      aria-label="جاري التفكير"
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-700 text-white shadow-sm shadow-primary/20 ring-4 ring-white/70">
        <ChefHat className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="rounded-2xl rounded-bl-md border border-white/90 bg-white/95 px-4 py-3 shadow-sm shadow-gray-900/[0.05]">
        <div className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full bg-primary-400 animate-bounce"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="h-2 w-2 rounded-full bg-primary-400 animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="h-2 w-2 rounded-full bg-primary-400 animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
          <span className="mr-2 text-[11px] font-semibold text-primary-700">
            {isVoiceProcessing
              ? "جاري البحث عن منتجاتك…"
              : "جاري التفكير…"}
          </span>
        </div>
      </div>
    </div>
  );
}
