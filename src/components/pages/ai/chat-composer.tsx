"use client";

/**
 * ChatComposer
 *
 * Bottom pinned composer of /ai-chat. Holds the mic button, the text
 * input, and the send button — plus the suggestion rail that appears
 * when the conversation is empty.
 *
 * Behavior:
 *   • Guests (no user session) get bounced into the login prompt the
 *     moment they focus the input or tap the mic — they shouldn't be
 *     able to type freely until they're authenticated.
 *   • The mic toggles recording on/off; while recording it swaps to a
 *     pulsing red waveform UI inline.
 *
 * All callbacks are owned by the parent so this stays purely
 * presentational.
 */

import { FormEvent } from "react";
import { Loader2, Mic, MicOff, Send, Volume2 } from "lucide-react";
import type { ChatInputMode } from '@/lib/catalog';
import { SUGGESTIONS } from "./ai-chat-helpers";

interface ChatComposerProps {
  input: string;
  loading: boolean;
  isRecording: boolean;
  isGuest: boolean;
  isVoiceProcessing: boolean;
  voiceError: string | null;
  recordingTime: number;
  formatTime: (seconds: number) => string;
  displayTranscript: string;
  onInputChange: (value: string) => void;
  onInputFocus: () => void;
  onSendSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleMic: () => void;
  onClearVoiceError: () => void;
  onPickSuggestion: (text: string) => void;
  showSuggestions: boolean;
}

export function ChatComposer({
  input,
  loading,
  isRecording,
  isGuest,
  isVoiceProcessing,
  voiceError,
  recordingTime,
  formatTime,
  displayTranscript,
  onInputChange,
  onInputFocus,
  onSendSubmit,
  onToggleMic,
  onClearVoiceError,
  onPickSuggestion,
  showSuggestions,
}: ChatComposerProps) {
  return (
    <footer className="fixed bottom-16 left-0 right-0 z-40 border-t border-white/70 bg-gradient-to-t from-white via-white/95 to-white/70 pt-2 shadow-[0_-12px_30px_-18px_rgba(15,40,30,0.18)] backdrop-blur-xl md:bottom-0">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-3 sm:px-6">
        {voiceError ? (
          <VoiceErrorBanner
            message={voiceError}
            onRetry={onClearVoiceError}
          />
        ) : null}

        {isRecording ? (
          <RecordingIndicator
            recordingTime={recordingTime}
            formatTime={formatTime}
            displayTranscript={displayTranscript}
          />
        ) : null}

        {showSuggestions ? (
          <SuggestionsRail onPick={onPickSuggestion} />
        ) : null}

        <form
          onSubmit={onSendSubmit}
          className="rounded-2xl border border-white/80 bg-white/90 p-2 shadow-lg shadow-primary-950/[0.06] backdrop-blur-xl"
        >
          <div className="flex items-end gap-2">
            <MicButton
              isRecording={isRecording}
              loading={loading}
              onClick={onToggleMic}
            />

            <label className="sr-only" htmlFor="ai-chat-input">
              اكتب طلبك
            </label>
            <input
              id="ai-chat-input"
              type="text"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onFocus={onInputFocus}
              placeholder="مثال: وش أطبخ العشا؟ أو أبي مكونات شورمة…"
              disabled={isRecording}
              autoComplete="off"
              enterKeyHint="send"
              className="h-11 min-w-0 flex-1 rounded-xl border border-transparent bg-gray-50/80 px-4 text-sm leading-6 text-secondary placeholder:text-gray-400 focus:border-primary/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            />

            <SendButton
              disabled={!input.trim() || loading || isRecording}
              loading={loading && !isRecording}
            />
          </div>
          <p className="mt-1.5 px-1 text-center text-tiny leading-4 text-gray-400">
            الأفكار الغذائية اقتراحات فقط. المنتجات حسب توفر أسواق سيتي.
          </p>
        </form>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------------- */
/* Composer sub-pieces                                                      */
/* ------------------------------------------------------------------------- */

function MicButton({
  isRecording,
  loading,
  onClick,
}: {
  isRecording: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading && !isRecording}
      aria-label={isRecording ? "إيقاف التسجيل" : "بدء تسجيل صوتي"}
      aria-pressed={isRecording}
      className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all duration-200 disabled:opacity-40 ${
        isRecording
          ? "bg-red-500 text-white shadow-md shadow-red-500/30 ring-2 ring-red-200"
          : "bg-primary-50 text-primary hover:bg-primary hover:text-white"
      }`}
    >
      {isRecording ? (
        <>
          <Volume2 className="h-5 w-5" aria-hidden="true" />
          <span className="pointer-events-none absolute inset-0 animate-ping rounded-xl bg-red-500/30" />
        </>
      ) : (
        <Mic className="h-5 w-5" aria-hidden="true" />
      )}
    </button>
  );
}

function SendButton({
  disabled,
  loading,
}: {
  disabled: boolean;
  loading: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      aria-label="إرسال"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-md shadow-primary/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary-700 hover:shadow-lg disabled:pointer-events-none disabled:opacity-40"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Send className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}

function RecordingIndicator({
  recordingTime,
  formatTime,
  displayTranscript,
}: {
  recordingTime: number;
  formatTime: (seconds: number) => string;
  displayTranscript: string;
}) {
  return (
    <div
      aria-live="polite"
      className="flex items-center gap-3 rounded-2xl border border-red-100 bg-gradient-to-br from-red-50 via-white to-rose-50 px-3 py-2.5 shadow-sm animate-slide-up"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow-md shadow-red-500/30">
        <span className="h-2.5 w-2.5 animate-ping rounded-full bg-white" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between text-2xs font-bold text-red-800">
          <span>جاري الاستماع…</span>
          <span className="tabular-nums">{formatTime(recordingTime)}</span>
        </div>
        <div
          className="mt-1.5 flex h-5 items-end gap-0.5"
          aria-hidden="true"
        >
          {Array.from({ length: 18 }).map((_, index) => (
            <span
              key={index}
              className="block w-1 origin-bottom rounded-full bg-red-400/80 animate-pulse"
              style={{
                height: `${30 + ((index * 13) % 70)}%`,
                animationDelay: `${index * 80}ms`,
                animationDuration: "0.9s",
              }}
            />
          ))}
        </div>
        {displayTranscript ? (
          <p className="mt-1.5 truncate text-xs text-gray-700">
            {displayTranscript}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function VoiceErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-2xl border border-red-100 bg-red-50/90 px-3 py-2 text-xs text-red-700 animate-slide-up"
    >
      <MicOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md px-2 py-0.5 text-2xs font-bold text-red-800 underline-offset-2 hover:underline"
      >
        إعادة المحاولة
      </button>
    </div>
  );
}

function SuggestionsRail({
  onPick,
}: {
  onPick: (text: string) => void;
}) {
  return (
    <div className="pt-1">
      <p className="mb-1.5 px-1 text-tiny font-semibold uppercase tracking-wider text-gray-500">
        اقتراحات سريعة
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {SUGGESTIONS.map((s, index) => (
          <button
            key={s.text}
            type="button"
            onClick={() => onPick(s.text)}
            style={{ animationDelay: `${index * 60}ms` }}
            className="flex shrink-0 animate-slide-up items-center gap-2 rounded-2xl border border-white/80 bg-white/85 px-3.5 py-2 text-xs font-semibold text-secondary shadow-sm shadow-gray-900/[0.04] backdrop-blur transition duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <span className="text-base" aria-hidden="true">
              {s.emoji}
            </span>
            {s.text}
          </button>
        ))}
      </div>
    </div>
  );
}
