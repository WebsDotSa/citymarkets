import type {
  AiAssistantPayload,
  AiProductRequest,
  ChatTurn,
  MealSuggestion,
} from "./ai-shopping-assistant";
import { parseVoiceTranscript } from "./voice-order";

type Intent = "meal_ideas" | "recipe_shop" | "product_list";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[؟?!.,،]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PRODUCT_WORDS = [
  "حليب",
  "لبن",
  "خبز",
  "بيض",
  "جبن",
  "جبنة",
  "زبدة",
  "أرز",
  "رز",
  "دجاج",
  "لحم",
  "بصل",
  "طماطم",
  "بطاطس",
  "زيت",
  "سكر",
  "دقيق",
  "معكرونة",
  "مكرونة",
  "شاي",
  "قهوة",
  "ماء",
  "عصير",
  "زبادي",
  "لبنة",
  "تونة",
  "فاصوليا",
  "عدس",
  "حمص",
  "خيار",
  "فلفل",
  "ثوم",
  "ليمون",
];

function countProductWords(text: string): number {
  const n = normalize(text);
  return PRODUCT_WORDS.filter((w) => n.includes(w)).length;
}

function detectIntent(message: string, history: ChatTurn[]): Intent {
  const n = normalize(message);
  const historyText = history
    .slice(-4)
    .map((h) => h.content)
    .join(" ");
  const combined = `${historyText} ${n}`;

  const recipeShop =
    /(أبي|ابي|أريد|اريد|جهز|حضّر|حضر)\s*(أسوي|اسوي|اعمل|أعمل|طبخ)/.test(n) ||
    /مكونات\s/.test(n) ||
    /(كبسة|مندي|مقلوبة|شوربة|برياني|مسقعة|مكرونة|باستا|شاورما|برجر)/.test(
      n
    );

  if (recipeShop) return "recipe_shop";

  const mealIdeas =
    /(وش|ماذا|ايش)\s*(أطبخ|اطبخ|نطبخ|اكل|أكل)/.test(n) ||
    /اقترح|اقتراحات|أفكار|افكار|وجبات?/.test(n) ||
    /(فطور|غداء|عشاء|عشا|سحور|وجبة)\s/.test(n) ||
    /(فطور|غداء|عشاء|عشا)\s*(سريع|للعائلة|خفيف|صحي)/.test(n) ||
    /سريع\s*للعائلة/.test(n) ||
    /للعائلة/.test(n) && /(فطور|غداء|عشاء|وجبة)/.test(combined);

  if (mealIdeas) return "meal_ideas";

  const lines = parseVoiceTranscript(message);
  if (lines.length >= 2) return "product_list";
  if (countProductWords(n) >= 2) return "product_list";
  if (countProductWords(n) === 1 && n.length < 40) return "product_list";

  if (
    /(أضف|اضف|أبي|ابي|عطني|اعطني|اشتري|جيب)/.test(n) &&
    countProductWords(n) >= 1
  ) {
    return "product_list";
  }

  // عبارات عامة عن الطبخ بدون منتجات محددة → أفكار وجبات
  if (n.length > 8 && countProductWords(n) === 0) return "meal_ideas";

  return "product_list";
}

function mealContext(message: string): "breakfast" | "lunch" | "dinner" | "general" {
  const n = normalize(message);
  if (/فطور|سحور/.test(n)) return "breakfast";
  if (/غداء|غدا/.test(n)) return "lunch";
  if (/عشاء|عشا/.test(n)) return "dinner";
  return "general";
}

const BREAKFAST_MEALS: MealSuggestion[] = [
  {
    id: "breakfast-arabic",
    title: "فطور عربي سريع",
    description: "خبز طازج مع جبنة وزيتون وخضار — مناسب للعائلة صباحاً.",
    ingredients: [
      { search_query: "خبز", quantity: 2 },
      { search_query: "جبن", quantity: 1 },
      { search_query: "زيتون", quantity: 1 },
      { search_query: "طماطم", quantity: 1 },
      { search_query: "خيار", quantity: 1 },
      { search_query: "شاي", quantity: 1 },
    ],
  },
  {
    id: "breakfast-eggs",
    title: "بيض مقلي مع خبز",
    description: "وجبة سريعة ومشبعة للأطفال والكبار.",
    ingredients: [
      { search_query: "بيض", quantity: 2 },
      { search_query: "خبز", quantity: 1 },
      { search_query: "زبدة", quantity: 1 },
      { search_query: "حليب", quantity: 1 },
    ],
  },
  {
    id: "breakfast-paratha",
    title: "لبنة وحليب مع خبز",
    description: "فطور خفيف جاهز في دقائق.",
    ingredients: [
      { search_query: "لبنة", quantity: 1 },
      { search_query: "حليب", quantity: 2 },
      { search_query: "خبز", quantity: 1 },
      { search_query: "عسل", quantity: 1, note: "إن وُجد" },
    ],
  },
  {
    id: "breakfast-cereal",
    title: "حبوب الإفطار مع الحليب",
    description: "خيار عملي للأيام المزدحمة.",
    ingredients: [
      { search_query: "حليب", quantity: 2 },
      { search_query: "شوفان", quantity: 1, note: "أو حبوب جاهزة" },
      { search_query: "موز", quantity: 1, note: "إن وُجد" },
    ],
  },
];

const DINNER_MEALS: MealSuggestion[] = [
  {
    id: "dinner-chicken-rice",
    title: "دجاج مشوي مع أرز",
    description: "عشاء كلاسيكي يناسب أغلب أفراد العائلة.",
    ingredients: [
      { search_query: "دجاج", quantity: 1 },
      { search_query: "رز", quantity: 1 },
      { search_query: "بصل", quantity: 1 },
      { search_query: "طماطم", quantity: 2 },
      { search_query: "زيت", quantity: 1 },
    ],
  },
  {
    id: "dinner-pasta",
    title: "معكرونة بالصلصة",
    description: "سريعة ولذيذة — يمكن إضافة دجاج أو لحم مفروم.",
    ingredients: [
      { search_query: "معكرونة", quantity: 2 },
      { search_query: "صلصة طماطم", quantity: 2, note: "أو معجون" },
      { search_query: "جبن", quantity: 1 },
      { search_query: "زيت", quantity: 1 },
    ],
  },
  {
    id: "dinner-soup",
    title: "شوربة خضار مع خبز",
    description: "عشاء خفيف ومريح.",
    ingredients: [
      { search_query: "عدس", quantity: 1, note: "أو خضار مجمدة" },
      { search_query: "بطاطس", quantity: 1 },
      { search_query: "جزر", quantity: 1, note: "إن وُجد" },
      { search_query: "خبز", quantity: 1 },
    ],
  },
];

const LUNCH_MEALS: MealSuggestion[] = [
  {
    id: "lunch-rice-meal",
    title: "أرز بالدجاج",
    description: "غداء مشبع وسهل التحضير.",
    ingredients: [
      { search_query: "دجاج", quantity: 1 },
      { search_query: "رز", quantity: 1 },
      { search_query: "بصل", quantity: 1 },
      { search_query: "زيت", quantity: 1 },
    ],
  },
  {
    id: "lunch-sandwich",
    title: "ساندويتشات وتونة",
    description: "غداء سريع بدون طبخ طويل.",
    ingredients: [
      { search_query: "خبز", quantity: 1 },
      { search_query: "تونة", quantity: 2 },
      { search_query: "جبن", quantity: 1 },
      { search_query: "خس", quantity: 1, note: "إن وُجد" },
    ],
  },
];

const GENERAL_MEALS: MealSuggestion[] = [
  ...BREAKFAST_MEALS.slice(0, 2),
  ...DINNER_MEALS.slice(0, 2),
];

function pickMealSuggestions(message: string): MealSuggestion[] {
  const ctx = mealContext(message);
  if (ctx === "breakfast") return BREAKFAST_MEALS;
  if (ctx === "dinner") return DINNER_MEALS;
  if (ctx === "lunch") return LUNCH_MEALS;
  return GENERAL_MEALS;
}

function recipeToProducts(message: string): AiProductRequest[] {
  const n = normalize(message);
  if (/كبسة/.test(n)) {
    return [
      { search_query: "دجاج", quantity: 1 },
      { search_query: "رز بسمتي", quantity: 1 },
      { search_query: "بصل", quantity: 2 },
      { search_query: "طماطم", quantity: 2 },
      { search_query: "زيت", quantity: 1 },
      { search_query: "لبن زبادي", quantity: 1 },
      { search_query: "توابل", quantity: 1 },
    ];
  }
  if (/مندي/.test(n)) {
    return [
      { search_query: "لحم", quantity: 1 },
      { search_query: "رز بسمتي", quantity: 1 },
      { search_query: "بصل", quantity: 2 },
      { search_query: "زيت", quantity: 1 },
    ];
  }
  if (/شوربة/.test(n)) {
    return [
      { search_query: "عدس", quantity: 1 },
      { search_query: "بطاطس", quantity: 1 },
      { search_query: "جزر", quantity: 1 },
      { search_query: "بصل", quantity: 1 },
    ];
  }
  if (/مكرونة|باستا/.test(n)) {
    return [
      { search_query: "معكرونة", quantity: 2 },
      { search_query: "صلصة", quantity: 2 },
      { search_query: "جبن", quantity: 1 },
    ];
  }
  return [
    { search_query: "دجاج", quantity: 1 },
    { search_query: "رز", quantity: 1 },
    { search_query: "بصل", quantity: 1 },
    { search_query: "طماطم", quantity: 2 },
    { search_query: "زيت", quantity: 1 },
  ];
}

function productsFromMessage(message: string): AiProductRequest[] {
  const lines = parseVoiceTranscript(message);
  if (lines.length > 0) {
    return lines.map((l) => ({
      search_query: l.query || l.raw,
      quantity: l.quantity,
    }));
  }
  const found: AiProductRequest[] = [];
  const n = normalize(message);
  for (const w of PRODUCT_WORDS) {
    if (n.includes(w)) found.push({ search_query: w, quantity: 1 });
  }
  if (found.length > 0) return found;
  return [{ search_query: message.trim(), quantity: 1 }];
}

function mealReply(message: string): string {
  const ctx = mealContext(message);
  if (ctx === "breakfast") {
    return (
      "أكيد! هذه أفكار **فطور سريع للعائلة** — اختر الوجبة التي تعجبك وسأبحث عن المكونات المتوفرة في أسواق سيتي وأضيفها للسلة بضغطة واحدة."
    );
  }
  if (ctx === "dinner") {
    return (
      "تفضل أفكار **للعشاء** — اختر وجبة لعرض المكونات وإضافة ما هو متوفر من المتجر إلى سلتك."
    );
  }
  if (ctx === "lunch") {
    return (
      "إليك اقتراحات **للغداء** — اضغط «أضف المتوفر من المكونات للسلة» تحت أي وجبة."
    );
  }
  return (
    "إليك بعض **أفكار الوجبات** المناسبة لطلبك — اختر وجبة وسأطابق مكوناتها مع منتجات المتجر."
  );
}

/** مساعد محلي عند تعذّر OpenAI — يدعم اقتراح وجبات وقوائم شراء */
export function runLocalShoppingAssistant(
  message: string,
  history: ChatTurn[] = []
): AiAssistantPayload {
  const intent = detectIntent(message, history);

  if (intent === "meal_ideas") {
    return {
      reply: mealReply(message),
      products: [],
      meal_suggestions: pickMealSuggestions(message),
    };
  }

  if (intent === "recipe_shop") {
    const products = recipeToProducts(message);
    const dish =
      normalize(message).match(
        /(كبسة|مندي|شوربة|مكرونة|باستا|مقلوبة)/
      )?.[1] || "الوجبة";
    return {
      reply: `حاضر! هذه مكونات **${dish}** الشائعة — سأبحث عنها في المتجر. يمكنك تعديل الكميات من السلة لاحقاً.`,
      products,
      meal_suggestions: [],
    };
  }

  return {
    reply: "",
    products: productsFromMessage(message),
    meal_suggestions: [],
  };
}
