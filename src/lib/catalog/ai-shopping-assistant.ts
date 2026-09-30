import { query } from "@/lib/db";
import { error as logError } from "@/lib/logger";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type AiProductRequest = {
  search_query: string;
  quantity: number;
};

// Meal types are defined once in the client-safe `ai-chat-client-types`
// module and re-exported here for existing server-side importers.
import type { MealIngredient, MealSuggestion } from "./ai-chat-client-types";
export type { MealIngredient, MealSuggestion };

export type AiAssistantPayload = {
  reply: string;
  products: AiProductRequest[];
  meal_suggestions: MealSuggestion[];
};

const SYSTEM_PROMPT = `أنت شيف رقمي ومساعد تسوق لسوبرماركت "أسواق سيتي" في السعودية.
- تحدث بالعربية الفصحى البسيطة بلهجة ودودة ومحلية حيث يناسب.
- ساعِد في: أفكار وجبات (فطور/غداء/عشاء)، وصفات، وقوائم تسوق واقعية من المنتجات الشائعة في السوبرماركت.

## متى تستخدم meal_suggestions
استخدمها عندما يطلب العميل **أفكاراً** أو **ماذا أطبخ** أو **اقترح عشاء** أو **قائمة فطور** أو **وجبات سريعة** — دون طلب صريح بشراء كل شيء الآن.
- أعطِ 2 إلى 4 اقتراحات وجبات متنوعة.
- لكل وجبة: عنوان جذاب، وصف سطر أو سطرين، وقائمة مكونات كـ search_query قصيرة بالعربية (مثل: دجاج، رز بسمتي، بصل، طماطم، لبن زبادي، توابل كبسة، زيت).
- اترك products فارغة [] في هذه الحالة (لا تُجبر العميل على شراء تلقائي).

## متى تستخدم products
استخدمها عندما يقول العميل بوضوح أنه يريد **شراء** أو **جهّز لي** أو **أضف** أو **أبي أسوي كبسة** أو يسمّي منتجات محددة — أخرج مكونات للبحث في المتجر.
- search_query: اسم شائع للمنتج في السوبرماركت السعودي.

## JSON فقط (بدون نص خارج JSON):
{
  "reply": "نص الرد مع عناوين مختصرة إن لزم، يمكن استخدام \\n",
  "products": [
    { "search_query": "اسم للبحث في المتجر", "quantity": 1 }
  ],
  "meal_suggestions": [
    {
      "id": "slug-latin-no-spaces",
      "title": "عنوان الوجبة",
      "description": "وصف قصير",
      "ingredients": [
        { "search_query": "رز بسمتي", "quantity": 1, "note": "اختياري مثل كيلو" }
      ]
    }
  ]
}

قواعد:
- إما meal_suggestions تحتوي أفكاراً و products = []، أو products للشراء المباشر و meal_suggestions = [] غالباً.
- لا تترك reply فارغاً.
- quantity بين 1 و 99.`;

async function getStoreCatalogHint(): Promise<string> {
  try {
    // Slice 1: read from `products_unified` so the LLM hint surfaces
    // third-party vendor listings too. Honour `track_stock` so vendors
    // who opt out of stock tracking (fresh produce, bread, etc.) still
    // appear in the suggestion pool — same semantics as the public
    // /api/v1/products?inStock=true filter.
    const result = await query(
      `SELECT p.name_ar, c.name_ar AS category_name
       FROM products_unified p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.is_active = true
         AND (p.track_stock = false OR p.stock_qty > 0)
       ORDER BY p.is_featured DESC NULLS LAST, p.name_ar ASC
       LIMIT 100`
    );
    if (result.rows.length === 0) return "لا توجد منتجات في القائمة حالياً.";
    return result.rows
      .map(
        (r) =>
          `- ${String((r as { name_ar: string }).name_ar)} (${String((r as { category_name?: string }).category_name || "عام")})`
      )
      .join("\n");
  } catch {
    return "";
  }
}

function parseAssistantJson(raw: string): AiAssistantPayload {
  const trimmed = raw.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("invalid_json");
    parsed = JSON.parse(match[0]);
  }

  const obj = parsed as Record<string, unknown>;
  const reply = String(obj.reply || "").trim();
  const productsRaw = Array.isArray(obj.products) ? obj.products : [];

  const products: AiProductRequest[] = productsRaw
    .map((p) => {
      const item = p as Record<string, unknown>;
      const search_query = String(
        item.search_query || item.name || item.query || ""
      ).trim();
      const quantity = Math.max(
        1,
        Math.min(99, parseInt(String(item.quantity || 1), 10) || 1)
      );
      return { search_query, quantity };
    })
    .filter((p) => p.search_query.length > 0);

  const mealRaw = Array.isArray(obj.meal_suggestions)
    ? obj.meal_suggestions
    : Array.isArray((obj as { mealSuggestions?: unknown }).mealSuggestions)
      ? ((obj as { mealSuggestions: unknown[] }).mealSuggestions)
      : [];
  const meal_suggestions: MealSuggestion[] = [];
  for (const m of mealRaw) {
    const row = m as Record<string, unknown>;
    const id = String(row.id || "").trim().slice(0, 64).replace(/\s+/g, "-") || `meal-${meal_suggestions.length}`;
    const title = String(row.title || "").trim();
    const description = String(row.description || "").trim();
    const ingRaw = Array.isArray(row.ingredients) ? row.ingredients : [];
    const ingredients: MealIngredient[] = [];
    for (const x of ingRaw) {
      const it = x as Record<string, unknown>;
      const search_query = String(
        it.search_query || it.name || it.item || ""
      ).trim();
      if (!search_query) continue;
      const quantity = Math.max(
        1,
        Math.min(99, parseInt(String(it.quantity || 1), 10) || 1)
      );
      const note = it.note != null ? String(it.note).trim() : undefined;
      ingredients.push({ search_query, quantity, note });
    }
    if (title && ingredients.length > 0) {
      meal_suggestions.push({
        id,
        title,
        description: description || title,
        ingredients,
      });
    }
  }

  if (!reply) {
    throw new Error("empty_reply");
  }

  return { reply, products, meal_suggestions };
}

export async function runShoppingAssistant(
  userMessage: string,
  history: ChatTurn[]
): Promise<AiAssistantPayload> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("missing_openai_key");
  }

  const catalog = await getStoreCatalogHint();
  const systemWithCatalog = `${SYSTEM_PROMPT}\n\nعينة من منتجات المتجر المتوفرة:\n${catalog}`;

  const recentHistory = history.slice(-10).map((h) => ({
    role: h.role,
    content: h.content,
  }));

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemWithCatalog },
        ...recentHistory,
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    logError("OpenAI error", undefined, { status: response.status, body: errText.slice(0, 500) });
    throw new Error("openai_request_failed");
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("empty_openai_response");

  return parseAssistantJson(content);
}
