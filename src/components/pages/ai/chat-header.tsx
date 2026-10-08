"use client";

/**
 * ChatHeader
 *
 * Pinned top of /ai-chat. Holds the brand badge (chef hat + sparkles)
 * and the "new conversation" trash button — only shown when there's
 * at least one persisted user message.
 *
 * Sticky below the global page header so it stays in view while the
 * conversation scrolls. Backdrop blur + low white opacity give it the
 * "frosted glass" feel without blocking the gradient behind.
 */

import { ChefHat, Sparkles, Trash2 } from "lucide-react";

interface ChatHeaderProps {
  hasHistory: boolean;
  onStartNewChat: () => void;
}

export function ChatHeader({ hasHistory, onStartNewChat }: ChatHeaderProps) {
  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-white/70 bg-white/85 shadow-[0_2px_18px_-12px_rgba(15,40,30,0.18)] backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-3 py-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-700 text-white shadow-md shadow-primary/25">
            <ChefHat className="h-5 w-5" aria-hidden="true" />
            <span className="absolute -bottom-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-300 ring-2 ring-white">
              <Sparkles
                className="h-2.5 w-2.5 text-amber-900"
                aria-hidden="true"
              />
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate font-display text-base font-black tracking-tight text-secondary sm:text-lg">
                شيف سيتي
              </h1>
              <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                متصل بالمتجر
              </span>
            </div>
            <p className="truncate text-tiny text-gray-500 sm:text-2xs">
              اطلب بصوتك أو اسأل عن وجبة ومكوناتها
            </p>
          </div>
        </div>

        {hasHistory ? (
          <button
            type="button"
            onClick={onStartNewChat}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-2xs font-bold text-gray-500 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
            aria-label="بدء محادثة جديدة"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            جديد
          </button>
        ) : null}
      </div>
    </header>
  );
}
