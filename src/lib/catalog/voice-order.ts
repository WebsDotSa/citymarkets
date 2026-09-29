const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

const STOP_WORDS = new Set([
  "و",
  "في",
  "من",
  "ال",
  "الى",
  "إلى",
  "على",
  "عن",
  "مع",
  "لتر",
  "لترين",
  "كيلو",
  "كغ",
  "جرام",
  "غ",
  "حبة",
  "حبات",
  "قطعة",
  "قطع",
  "علبة",
  "علب",
  "باكيت",
  "عبوة",
  "اريد",
  "أريد",
  "ابي",
  "أبي",
  "عطني",
  "اعطني",
  "أعطني",
  "اضف",
  "أضف",
  "للسلة",
]);

export function normalizeArabicDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => ARABIC_DIGITS[d] ?? d);
}

export type ParsedVoiceLine = {
  raw: string;
  query: string;
  quantity: number;
};

/** Split spoken order into product lines with optional quantities */
export function parseVoiceTranscript(transcript: string): ParsedVoiceLine[] {
  const normalized = normalizeArabicDigits(transcript)
    .replace(/[؟!.\u061F]/g, " ")
    .trim();

  if (!normalized) return [];

  const parts = normalized
    .split(/\s+و\s*|\s*,\s*|\s*،\s*|\s*\|\s+|\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);

  return parts.map((raw) => {
    let quantity = 1;
    let query = raw;

    const qtyMatch = raw.match(
      /(?:^|\s)(\d{1,3})(?:\s*(?:x|×|قطعة|حبة|علبة))?(?:\s|$)/i
    );
    if (qtyMatch) {
      quantity = Math.min(99, Math.max(1, parseInt(qtyMatch[1], 10)));
      query = raw.replace(qtyMatch[0], " ").trim();
    }

    query = query.replace(/\s+/g, " ").trim();
    return { raw, query, quantity };
  });
}

export function tokenizeProductQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, ""))
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}
