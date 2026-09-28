/** أنواع استجابة المساعد — آمنة للاستيراد من العميل (بدون db) */

export type MealIngredient = {
  search_query: string;
  quantity: number;
  note?: string;
};

export type MealSuggestion = {
  id: string;
  title: string;
  description: string;
  ingredients: MealIngredient[];
};

export type ChatInputMode = "text" | "voice";

export type ChatProductResult = {
  productId: string;
  vendorId: string | null;
  name: string;
  imageUrl: string | null;
  unit: string | null;
  displayPrice: number;
  originalPrice: number | null;
  vendorName: string | null;
  quantity: number;
  query: string;
  addedToCart: boolean;
};
