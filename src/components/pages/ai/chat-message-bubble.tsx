import {
  Bot,
  ChefHat,
  Loader2,
  Mic,
  PackageX,
  ShoppingCart,
  User,
} from "lucide-react";
import type { ChatInputMode, ChatProductResult } from '@/lib/catalog/ai-chat-client-types';
import type { MealSuggestion } from '@/lib/catalog/ai-shopping-assistant';
import { ChatProductResults } from "./chat-product-results";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  inputMode?: ChatInputMode;
  matchedProducts?: ChatProductResult[];
  addedToCart?: string[];
  mealSuggestions?: MealSuggestion[];
  unmatched?: string[];
};

function MealSuggestionCard({
  meal,
  loading,
  disabled,
  onAdd,
}: {
  meal: MealSuggestion;
  loading: boolean;
  disabled: boolean;
  onAdd: (meal: MealSuggestion) => void;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-primary-100 bg-gradient-to-br from-white via-white to-amber-50/60 p-3.5 shadow-sm animate-slide-up">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-800 ring-1 ring-primary/10">
          <ChefHat className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-sm font-extrabold leading-tight text-secondary">
            {meal.title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-gray-600">{meal.description}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {meal.ingredients.map((ingredient, index) => (
          <span
            key={`${meal.id}-${ingredient.search_query}-${index}`}
            className="inline-flex items-center gap-1 rounded-full border border-gray-100 bg-white/90 px-2.5 py-1 text-[11px] text-gray-700"
          >
            <span className="font-semibold">{ingredient.search_query}</span>
            <span className="text-gray-400">
              {ingredient.note || `×${ingredient.quantity}`}
            </span>
          </span>
        ))}
      </div>

      <button
        type="button"
        disabled={disabled}
        aria-busy={loading}
        onClick={() => onAdd(meal)}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white shadow-md shadow-primary/15 transition duration-200 hover:-translate-y-0.5 hover:bg-primary-dark disabled:pointer-events-none disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <ShoppingCart className="h-4 w-4" aria-hidden="true" />
        )}
        أضف المكونات المتوفرة للسلة
      </button>
    </article>
  );
}

function FormattedMessage({ content }: { content: string }) {
  return content.split("**").map((part, index) =>
    index % 2 === 1 ? (
      <strong key={`${part}-${index}`} className="font-extrabold">
        {part}
      </strong>
    ) : (
      <span key={`${part}-${index}`} className="whitespace-pre-line">
        {part}
      </span>
    )
  );
}

export function ChatMessageBubble({
  message,
  mealLoadingId,
  onAddMeal,
}: {
  message: ChatMessage;
  mealLoadingId: string | null;
  onAddMeal: (meal: MealSuggestion) => void;
}) {
  const isUser = message.role === "user";
  const hasProductCards = Boolean(message.matchedProducts?.length);

  return (
    <article
      className={`flex gap-2.5 animate-fade-in ${isUser ? "flex-row-reverse" : ""}`}
      aria-label={isUser ? "رسالتك" : "رد شيف سيتي"}
    >
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white/70 ${
          isUser
            ? "bg-secondary text-white"
            : "bg-gradient-to-br from-primary to-primary-600 text-white shadow-sm shadow-primary/20"
        }`}
      >
        {isUser ? (
          <User className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Bot className="h-4 w-4" aria-hidden="true" />
        )}
      </div>

      <div
        className={`min-w-0 space-y-2 ${
          isUser ? "max-w-[82%]" : "w-full max-w-[92%] sm:max-w-[88%]"
        }`}
      >
        <div
          className={`relative rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm ${
            isUser
              ? "rounded-br-md bg-secondary text-white"
              : "rounded-bl-md border border-white/90 bg-white/95 text-secondary shadow-gray-900/[0.05]"
          }`}
        >
          {isUser && message.inputMode === "voice" && (
            <span className="mb-1.5 flex w-fit items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80">
              <Mic className="h-3 w-3" aria-hidden="true" />
              طلب صوتي
            </span>
          )}
          <FormattedMessage content={message.content} />
        </div>

        {message.mealSuggestions && message.mealSuggestions.length > 0 && (
          <section className="space-y-2.5" aria-label="اقتراحات الوجبات">
            <p className="px-1 text-[11px] font-semibold text-primary-800">
              اختر وجبة وسأضيف مكوناتها المتوفرة:
            </p>
            {message.mealSuggestions.map((meal) => (
              <MealSuggestionCard
                key={meal.id}
                meal={meal}
                loading={mealLoadingId === meal.id}
                disabled={mealLoadingId !== null}
                onAdd={onAddMeal}
              />
            ))}
          </section>
        )}

        {message.matchedProducts && message.matchedProducts.length > 0 && (
          <ChatProductResults products={message.matchedProducts} />
        )}

        {!hasProductCards && message.addedToCart && message.addedToCart.length > 0 && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-primary"
          >
            <ShoppingCart className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              <strong className="font-bold">أُضيف للسلة: </strong>
              {message.addedToCart.join(" · ")}
            </span>
          </div>
        )}

        {message.unmatched && message.unmatched.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
            <PackageX className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>غير متوفر حالياً: {message.unmatched.join("، ")}</span>
          </div>
        )}
      </div>
    </article>
  );
}
