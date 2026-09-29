"use client";

/**
 * AIChatPage
 *
 * Top-level component for the /ai-chat route. Owns the conversation
 * state (messages, voice, login gating, persistence) and delegates
 * rendering to focused sub-components:
 *
 *   • ChatHeader       — pinned brand + new-chat button
 *   • ChatMessagesList — scrollable column with the typing indicator
 *   • ChatComposer     — pinned composer (mic + input + suggestions)
 *   • GuestLoginPrompt — modal for unauthenticated users
 *
 * Sub-components live in sibling files to keep this wrapper under
 * the 800-line soft cap while staying behavior-preserving.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useCartActions } from "@/contexts/cart-context";
import { useAuthState, useAuthActions } from "@/contexts/auth-context";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import type { Product } from "@/lib/types";
import type {
  ChatInputMode,
  MealSuggestion,
} from '@/lib/catalog';
import { csrfFetch } from "@/lib/csrf-client";
import {
  aiChatStorageKey,
  buildWelcomeMessage,
  clearChatLocalStorage,
  countPersistedMessages,
  loadChatFromLocalStorage,
  saveChatToLocalStorage,
  toStoredMessages,
  type StoredChatMessage,
} from '@/lib/catalog';
import {
  type AiChatResponse,
  type MatchedProduct,
  defaultMessages,
  friendlyError,
  storedToUiMessages,
  toChatProductResults,
  validatePhone,
} from "./ai-chat-helpers";
import { ChatHeader } from "./chat-header";
import { ChatMessagesList } from "./chat-messages-list";
import { ChatComposer } from "./chat-composer";
import { GuestLoginPrompt } from "./guest-login-prompt";
import { type ChatMessage } from "./chat-message-bubble";

const PENDING_INPUT_KEY = "ai-chat:pending-input";

export function AIChatPage() {
  const { addItem } = useCartActions();
  const { user } = useAuthState();
  const { signIn } = useAuthActions();
  const router = useRouter();
  const voice = useVoiceRecorder();
  const [messages, setMessages] = useState<ChatMessage[]>(defaultMessages);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeRequestMode, setActiveRequestMode] =
    useState<ChatInputMode | null>(null);
  const [mealLoadingId, setMealLoadingId] = useState<string | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const sentVoiceRef = useRef(false);
  const serverSessionIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Guest login popup state ──
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [loginPhone, setLoginPhone] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  // Snapshot of what the user typed before the popup so we can restore
  // it after the redirect-and-back round-trip.
  const pendingInputRef = useRef<{
    text: string;
    mode: ChatInputMode;
  } | null>(null);

  const isGuest = !user;

  const handleGuestLogin = async () => {
    if (!validatePhone(loginPhone)) {
      setLoginError("أدخل رقم جوال سعودي صحيح");
      return;
    }
    setLoginError(null);
    setLoginSubmitting(true);
    try {
      const { error } = await signIn(loginPhone.trim());
      if (error) {
        setLoginError(error);
        setLoginSubmitting(false);
        return;
      }
      // Hand off to the dedicated login page so the OTP field + verify
      // call + `redirect=/ai-chat` round-trip all happen in one place.
      if (pendingInputRef.current) {
        try {
          sessionStorage.setItem(
            PENDING_INPUT_KEY,
            JSON.stringify(pendingInputRef.current),
          );
        } catch {
          /* sessionStorage may be unavailable — non-fatal */
        }
      }
      router.push("/auth/login?redirect=/ai-chat");
    } catch {
      setLoginError("تعذّر إرسال رمز التحقق. حاول مرة أخرى.");
      setLoginSubmitting(false);
    }
  };

  // After the user comes back from /auth/login with a valid session,
  // re-emit the message they had started typing so the conversation
  // continues smoothly.
  useEffect(() => {
    if (!user) return;
    const raw = sessionStorage.getItem(PENDING_INPUT_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_INPUT_KEY);
    try {
      const parsed = JSON.parse(raw) as { text: string; mode: ChatInputMode };
      if (parsed?.text) {
        pendingInputRef.current = null;
        // Defer until after the hydration effect has finished loading
        // server history so we don't double-emit.
        setTimeout(() => {
          void sendMessage(parsed.text, parsed.mode ?? "text");
        }, 50);
      }
    } catch {
      /* malformed payload — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const storageKey = aiChatStorageKey(user?.id);

  useEffect(() => {
    // Recompute chat scroll position when the viewport size changes
    // (e.g. iOS keyboard opening). The layout itself is flex-based, so
    // this is a passive listener — no React state involved.
    //
    // Note: must use `behavior: "instant"` (no smooth scroll). On iOS
    // Safari a smooth `scrollIntoView` triggers a layout pass that
    // re-fires `visualViewport.resize`, which re-triggers the handler,
    // creating an infinite `up`/`ud` scheduler loop. Also debounced so
    // a burst of resize events coalesces into a single scroll, and we
    // bail out if the anchor is already in view to avoid any feedback
    // with the scroll container itself.
    let raf = 0;
    const scrollIfNeeded = () => {
      const node = messagesEnd.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const inView = rect.top >= 0 && rect.bottom <= window.innerHeight + 1;
      if (inView) return;
      node.scrollIntoView({ behavior: "instant", block: "end" });
    };
    const onResize = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        scrollIfNeeded();
      });
    };
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", onResize);
    window.addEventListener("resize", onResize);
    return () => {
      viewport?.removeEventListener("resize", onResize);
      window.removeEventListener("resize", onResize);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const localStored = loadChatFromLocalStorage(storageKey);
      const localUi =
        localStored && countPersistedMessages(localStored) > 0
          ? (storedToUiMessages(localStored) as unknown as ChatMessage[])
          : null;

      let serverUi: ChatMessage[] | null = null;
      let sessionId: string | null = null;

      if (user?.id) {
        try {
          const res = await fetch("/api/v1/ai-chat/history", {
            credentials: "include",
          });
          if (res.ok) {
            const data = (await res.json()) as {
              success?: boolean;
              messages?: StoredChatMessage[];
              sessionId?: string;
            };
            if (data.success && Array.isArray(data.messages)) {
              if (data.messages.length > 0) {
                serverUi = storedToUiMessages([
                  buildWelcomeMessage(),
                  ...data.messages,
                ]) as unknown as ChatMessage[];
              }
              sessionId = data.sessionId || null;
            }
          }
        } catch {
          /* offline — local only */
        }
      }

      if (cancelled) return;

      const localCount = localUi
        ? countPersistedMessages(toStoredMessages(localUi))
        : 0;
      const serverCount = serverUi
        ? countPersistedMessages(toStoredMessages(serverUi))
        : 0;

      if (serverUi && serverCount >= localCount) {
        setMessages(serverUi);
        saveChatToLocalStorage(storageKey, toStoredMessages(serverUi));
      } else if (localUi) {
        setMessages(localUi);
        if (user?.id && localCount > serverCount) {
          void csrfFetch("/api/v1/ai-chat/history", {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: toStoredMessages(localUi),
              sessionId: sessionId || undefined,
            }),
          }).then(async (r) => {
            if (!r.ok) return;
            const d = (await r.json()) as { sessionId?: string };
            if (d.sessionId) serverSessionIdRef.current = d.sessionId;
          });
        }
      } else {
        setMessages(defaultMessages());
      }

      serverSessionIdRef.current = sessionId;
      setHydrated(true);
    };
    setHydrated(false);
    void load();

    return () => {
      cancelled = true;
    };
  }, [storageKey, user?.id]);

  useEffect(() => {
    if (!hydrated) return;

    const stored = toStoredMessages(messages);
    saveChatToLocalStorage(storageKey, stored);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (!user?.id || stored.length === 0) return;
      void csrfFetch("/api/v1/ai-chat/history", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: stored,
          sessionId: serverSessionIdRef.current || undefined,
        }),
      })
        .then(async (r) => {
          if (!r.ok) return;
          const d = (await r.json()) as { sessionId?: string };
          if (d.sessionId) serverSessionIdRef.current = d.sessionId;
        })
        .catch(() => undefined);
    }, 600);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages, hydrated, storageKey, user?.id]);

  const startNewChat = useCallback(() => {
    clearChatLocalStorage(storageKey);
    serverSessionIdRef.current = null;
    setMessages(defaultMessages());
    if (user?.id) {
      void csrfFetch("/api/v1/ai-chat/history", {
        method: "DELETE",
        credentials: "include",
      });
    }
  }, [storageKey, user?.id]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const addMatchedToCart = useCallback(
    (matched: { product: Product; quantity: number }[]) => {
      const names: string[] = [];
      for (const m of matched) {
        addItem(m.product, m.quantity);
        names.push(`${m.product.name_ar} × ${m.quantity}`);
      }
      return names;
    },
    [addItem],
  );

  const matchMealIngredients = useCallback(
    async (meal: MealSuggestion) => {
      setMealLoadingId(meal.id);
      try {
        const items = meal.ingredients.map((i) => ({
          search_query: i.search_query,
          quantity: i.quantity,
        }));
        const res = await csrfFetch("/api/v1/ai-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchItems: items }),
        });
        const data: AiChatResponse = await res.json();
        if (!data.success || !data.matched) {
          throw new Error(data.error || "فشل المطابقة");
        }
        const added =
          data.matched.length > 0 ? addMatchedToCart(data.matched) : [];
        const matchedProducts =
          data.matched.length > 0
            ? toChatProductResults(data.matched, true)
            : undefined;
        const unmatched = data.unmatched?.length ? data.unmatched : undefined;

        setMessages((prev) => [
          ...prev,
          {
            id: `cart-${Date.now()}`,
            role: "assistant",
            content:
              added.length > 0
                ? `تمت إضافة **${meal.title}** — المنتجات المطابقة في المتجر أُضيفت للسلة.`
                : `لم أجد في المتجر مكونات كافية لـ **${meal.title}**. جرّب تعديل البحث أو تصفح الكتالوج.`,
            timestamp: new Date(),
            matchedProducts,
            addedToCart: added.length > 0 ? added : undefined,
            unmatched,
          },
        ]);
      } catch (caught) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: friendlyError(
              caught,
              "تعذّر إضافة المكونات. تحقق من الاتصال وحاول مرة أخرى.",
              "يلزم تسجيل الدخول لإضافة المكونات",
            ),
            timestamp: new Date(),
          },
        ]);
      } finally {
        setMealLoadingId(null);
      }
    },
    [addMatchedToCart],
  );

  const sendMessage = useCallback(
    async (text?: string, inputMode: ChatInputMode = "text") => {
      const messageText = (text || input).trim();
      if (!messageText || loading) return;

      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: "user",
        content: messageText,
        timestamp: new Date(),
        inputMode,
      };

      setMessages((previous) => [...previous, userMsg]);
      setInput("");
      setActiveRequestMode(inputMode);
      setLoading(true);

      try {
        const history = [...messages, userMsg]
          .filter((m) => m.id !== "welcome")
          .slice(-12)
          .map((m) => ({ role: m.role, content: m.content }));

        const res = await csrfFetch("/api/v1/ai-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: messageText, history }),
        });

        const data: AiChatResponse = await res.json();

        if (!data.success || data.reply === undefined) {
          throw new Error(data.error || "فشل الطلب");
        }

        const matched = (data.matched || []) as MatchedProduct[];
        const shouldAutoAdd = Boolean(data.autoAdd && matched.length > 0);
        const addedNames = shouldAutoAdd
          ? addMatchedToCart(matched)
          : undefined;
        const matchedProducts =
          matched.length > 0
            ? toChatProductResults(matched, shouldAutoAdd)
            : undefined;

        const assistantMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.reply || "",
          timestamp: new Date(),
          matchedProducts,
          addedToCart: addedNames,
          mealSuggestions: data.mealSuggestions,
          unmatched:
            data.unmatched && data.unmatched.length > 0
              ? data.unmatched
              : undefined,
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch (caught) {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: friendlyError(
              caught,
              "عذراً، لم أتمكن من الرد الآن. حاول مرة أخرى بعد لحظات.",
              "يلزم تسجيل الدخول لاستخدام المساعد",
            ),
            timestamp: new Date(),
          },
        ]);
      } finally {
        setLoading(false);
        setActiveRequestMode(null);
        voice.reset();
        sentVoiceRef.current = false;
      }
    },
    [input, loading, messages, addMatchedToCart, voice],
  );

  useEffect(() => {
    if (voice.state !== "done" || sentVoiceRef.current) return;
    const text = voice.transcript.trim();
    if (!text) return;
    sentVoiceRef.current = true;
    void sendMessage(text, "voice");
  }, [voice.state, voice.transcript, sendMessage]);

  const toggleMic = () => {
    if (voice.state === "recording" || voice.state === "requesting") {
      voice.stopRecording();
      return;
    }
    if (loading) return;
    if (isGuest) {
      pendingInputRef.current = { text: "", mode: "voice" };
      setLoginPromptOpen(true);
      setLoginError(null);
      return;
    }
    sentVoiceRef.current = false;
    voice.reset();
    void voice.startRecording();
  };

  const isRecording =
    voice.state === "recording" || voice.state === "requesting";

  const hasHistory =
    hydrated && countPersistedMessages(toStoredMessages(messages)) > 0;
  const isVoiceProcessing = loading && activeRequestMode === "voice";
  const showSuggestions =
    messages.length <= 2 && !loading && !isRecording && !voice.error;

  const openLoginPrompt = (text: string, mode: ChatInputMode) => {
    pendingInputRef.current = { text, mode };
    setLoginPromptOpen(true);
    setLoginError(null);
  };

  const handleComposerSubmit = (
    e: React.FormEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();
    if (isGuest) {
      openLoginPrompt(input, "text");
      return;
    }
    void sendMessage();
  };

  const handleInputFocus = () => {
    // Show the login prompt as soon as the guest taps the input — they
    // shouldn't be able to type freely until authenticated. Doesn't
    // auto-submit, so the user can still dismiss and continue browsing.
    if (isGuest && !loginPromptOpen) {
      openLoginPrompt(input, "text");
    }
  };

  const handlePickSuggestion = (text: string) => {
    if (isGuest) {
      openLoginPrompt(text, "text");
      return;
    }
    void sendMessage(text);
  };

  const handleLoginPromptClose = () => {
    if (loginSubmitting) return;
    setLoginPromptOpen(false);
  };

  return (
    <section
      id="main-content"
      aria-label="محادثة شيف سيتي"
      className="relative isolate flex min-h-0 w-full flex-1 flex-col bg-gradient-to-b from-[#eaf6ee] via-white to-[#f6fbf8]"
    >
      {/* Decorative background — non-interactive, sits behind everything */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute -right-24 -top-32 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-24 h-80 w-80 rounded-full bg-amber-200/25 blur-3xl" />
      </div>

      <ChatHeader hasHistory={hasHistory} onStartNewChat={startNewChat} />

      <ChatMessagesList
        messages={messages}
        loading={loading}
        isVoiceProcessing={isVoiceProcessing}
        mealLoadingId={mealLoadingId}
        onAddMeal={matchMealIngredients}
        messagesEndRef={messagesEnd}
      />

      <ChatComposer
        input={input}
        loading={loading}
        isRecording={isRecording}
        isGuest={isGuest}
        isVoiceProcessing={isVoiceProcessing}
        voiceError={voice.error}
        recordingTime={voice.recordingTime}
        formatTime={voice.formatTime}
        displayTranscript={voice.displayTranscript}
        onInputChange={setInput}
        onInputFocus={handleInputFocus}
        onSendSubmit={handleComposerSubmit}
        onToggleMic={toggleMic}
        onClearVoiceError={() => voice.reset()}
        onPickSuggestion={handlePickSuggestion}
        showSuggestions={showSuggestions}
      />

      <GuestLoginPrompt
        open={loginPromptOpen}
        submitting={loginSubmitting}
        phone={loginPhone}
        onPhoneChange={(value) => {
          setLoginPhone(value);
          if (loginError) setLoginError(null);
        }}
        error={loginError}
        onSubmit={handleGuestLogin}
        onClose={handleLoginPromptClose}
      />
    </section>
  );
}
