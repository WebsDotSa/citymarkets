import { NextRequest, NextResponse } from "next/server";
import {
  runShoppingAssistant,
  type ChatTurn,
  type MealSuggestion,
} from '@/lib/catalog/ai-shopping-assistant';
import { runLocalShoppingAssistant } from '@/lib/catalog';
import { matchProductsFromList, type MatchedProduct } from "@/lib/catalog/product-search";
import { parseVoiceTranscript } from '@/lib/catalog';
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { checkRateLimitSync } from "@/lib/rate-limit";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export const dynamic = "force-dynamic";

/** طلب مطابقة منتجات فقط (بدون نموذج لغوي) — زر «أضف للسلة» تحت اقتراح وجبة */
function normalizeMatchItems(raw: unknown): { search_query: string; quantity: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { search_query: string; quantity: number }[] = [];
  for (const item of raw) {
    const row = item as Record<string, unknown>;
    const search_query = String(
      row.search_query || row.query || row.name || ""
    ).trim();
    if (!search_query) continue;
    const quantity = Math.max(
      1,
      Math.min(99, parseInt(String(row.quantity || 1), 10) || 1)
    );
    out.push({ search_query, quantity });
  }
  return out;
}

async function localAssistantFallback(message: string, history: ChatTurn[]) {
  const ai = runLocalShoppingAssistant(message, history);
  const mealOnly =
    ai.meal_suggestions.length > 0 && ai.products.length === 0;

  if (mealOnly) {
    return {
      reply: ai.reply,
      matched: [] as MatchedProduct[],
      unmatched: [] as string[],
      mealSuggestions: ai.meal_suggestions,
      autoAdd: false,
    };
  }

  if (ai.products.length === 0) {
    const lines = parseVoiceTranscript(message);
    const items =
      lines.length > 0
        ? lines.map((line) => ({
            search_query: line.query || line.raw,
            quantity: line.quantity,
          }))
        : [{ search_query: message, quantity: 1 }];
    const { matched, unmatched } = await matchProductsFromList(items);
    let reply =
      matched.length > 0
        ? "تمام! بحثت في المتجر عن طلبك:"
        : "لم أجد منتجات مطابقة. جرّب أسماء أوضح (مثل: حليب، خبز، بيض) أو اسألني «وش أطبخ العشا؟» لاقتراحات وجبات.";
    if (matched.length > 0) {
      reply +=
        "\n" +
        matched.map((m) => `• ${m.product.name_ar} × ${m.quantity}`).join("\n");
    }
    if (unmatched.length > 0) {
      reply += `\n\nلم أجد: ${unmatched.join("، ")}`;
    }
    return { reply, matched, unmatched, autoAdd: matched.length > 0 };
  }

  const { matched, unmatched } = await matchProductsFromList(ai.products);
  let reply =
    ai.reply ||
    (matched.length > 0
      ? "تمام! بحثت في المتجر عن المكونات:"
      : "فهمت طلبك. جرّب صياغة أوضح أو اختر وجبة من الاقتراحات.");

  if (matched.length > 0) {
    reply +=
      "\n\n✅ متوفر في المتجر:\n" +
      matched.map((m) => `• ${m.product.name_ar} × ${m.quantity}`).join("\n");
  }
  if (unmatched.length > 0) {
    reply += `\n\n⚠️ غير متوفر حالياً: ${unmatched.join("، ")}`;
  }

  return {
    reply,
    matched,
    unmatched,
    autoAdd: matched.length > 0,
  };
}

function buildResponse(
  reply: string,
  matched: MatchedProduct[],
  unmatched: string[],
  opts?: { mealSuggestions?: MealSuggestion[]; autoAdd?: boolean }
) {
  const autoAdd =
    opts?.autoAdd !== undefined ? opts.autoAdd : matched.length > 0;
  return NextResponse.json({
    success: true,
    reply,
    matched,
    unmatched,
    autoAdd,
    mealSuggestions: opts?.mealSuggestions?.length
      ? opts.mealSuggestions
      : undefined,
  });
}

export async function POST(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "يجب تسجيل الدخول لاستخدام المساعد" },
      { status: 401 }
    );
  }
  // 30 messages per minute per user; in-memory bucket (single-replica MVP).
  const rl = checkRateLimitSync(userId, {
    windowMs: 60_000,
    maxRequests: 30,
    keyPrefix: "ai-chat",
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "طلبات كثيرة، حاول بعد دقيقة" },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil((rl.retryAfterMs ?? 60_000) / 1000).toString(),
        },
      }
    );
  }

  try {
    const body = await request.json();

    const matchOnly = normalizeMatchItems(body.matchItems);
    if (matchOnly.length > 0) {
      const { matched, unmatched } = await matchProductsFromList(matchOnly);
      return buildResponse("", matched, unmatched, { autoAdd: false });
    }

    const message = String(body.message || "").trim();
    const historyRaw = Array.isArray(body.history) ? body.history : [];

    if (!message) {
      return NextResponse.json(
        { success: false, error: "الرسالة فارغة" },
        { status: 400 }
      );
    }

    const history: ChatTurn[] = historyRaw
      .map((h: { role?: string; content?: string }) => ({
        role: h.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: String(h.content || "").trim(),
      }))
      .filter((h: ChatTurn) => h.content.length > 0);

    try {
      const ai = await runShoppingAssistant(message, history);
      const mealOnly =
        ai.meal_suggestions.length > 0 && ai.products.length === 0;

      if (mealOnly) {
        return buildResponse(ai.reply, [], [], {
          mealSuggestions: ai.meal_suggestions,
          autoAdd: false,
        });
      }

      const { matched, unmatched } =
        ai.products.length > 0
          ? await matchProductsFromList(ai.products)
          : { matched: [], unmatched: [] as string[] };

      let reply = ai.reply;
      if (matched.length > 0) {
        const lines = matched.map(
          (m) => `• ${m.product.name_ar} × ${m.quantity}`
        );
        reply += `\n\n✅ تم العثور على ${matched.length} منتج(ات):\n${lines.join("\n")}`;
      }
      if (unmatched.length > 0) {
        reply += `\n\n⚠️ لم نجد في المتجر: ${unmatched.join("، ")}`;
      }

      return buildResponse(reply, matched, unmatched, {
        autoAdd: matched.length > 0,
      });
    } catch (openAiError) {
      logWarn("OpenAI unavailable, using local fallback", { error: openAiError });
      const fallback = await localAssistantFallback(message, history);
      return buildResponse(
        fallback.reply,
        fallback.matched,
        fallback.unmatched,
        {
          mealSuggestions: fallback.mealSuggestions,
          autoAdd: fallback.autoAdd,
        }
      );
    }
  } catch (e) {
    logError("ai-chat error:", e);
    return NextResponse.json(
      { success: false, error: "تعذر معالجة الرسالة. حاول مرة أخرى." },
      { status: 500 }
    );
  }
}
