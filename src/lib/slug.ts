/**
 * Smart slug generator that supports Arabic text and diacritics.
 * Strategy:
 *   1. Strip Arabic diacritics (tashkeel)
 *   2. Map common Arabic letters to transliteration
 *   3. Replace whitespace and unsafe chars with `-`
 *   4. Lowercase
 *   5. Collapse and trim dashes
 *
 * Examples:
 *   "فواكه وخضروات"  -> "fawakeh-wa-khodrawat"
 *   "بسكويت و كثر"    -> "biskwit-wa-kthar"
 *   "ألبان وأجبان"    -> "alban-wa-ajban"
 *   "Fruits & Veg"    -> "fruits-veg"
 */
const ARABIC_TO_LATIN: Record<string, string> = {
  أ: "a", إ: "e", آ: "a", ا: "a",
  ب: "b", ت: "t", ث: "th", ج: "j", ح: "h", خ: "kh",
  د: "d", ذ: "dh", ر: "r", ز: "z", س: "s", ش: "sh",
  ص: "s", ض: "d", ط: "t", ظ: "z", ع: "a", غ: "gh",
  ف: "f", ق: "q", ك: "k", ل: "l", م: "m", ن: "n",
  ه: "h", و: "wa", ي: "y", ى: "a", ة: "h", ئ: "y", ؤ: "w",
};

const DIACRITICS_REGEX = /[\u064B-\u0652\u0670\u0640]/g;

export function generateSlug(input: string): string {
  if (!input) return "";
  let s = input
    // 1) Strip Arabic diacritics
    .replace(DIACRITICS_REGEX, "")
    // 2) Alef variants -> single alef (a)
    .replace(/[إأآا]/g, "ا")
    // 3) Taa Marbuta -> ه
    .replace(/ة/g, "ه")
    // 4) Map Arabic letters to Latin
    .replace(/[\u0600-\u06FF]/g, (ch) => ARABIC_TO_LATIN[ch] ?? "")
    // 5) Lowercase Latin
    .toLowerCase()
    // 6) Replace any non-alphanumeric with dash
    .replace(/[^a-z0-9]+/g, "-")
    // 7) Collapse + trim dashes
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return s;
}

/**
 * Ensure slug uniqueness within a category (excluding a given id, optional).
 * Returns the original if it's free, otherwise appends -2, -3, ...
 */
export async function ensureUniqueSlug(
  baseSlug: string,
  checkFn: (slug: string) => Promise<boolean>,
  excludeId?: string
): Promise<string> {
  let candidate = baseSlug || "category";
  let counter = 2;

  while (true) {
    const exists = await checkFn(candidate);
    if (!exists) return candidate;
    candidate = `${baseSlug}-${counter}`;
    counter++;
    if (counter > 100) {
      // safety net
      return `${baseSlug}-${Date.now()}`;
    }
  }
}