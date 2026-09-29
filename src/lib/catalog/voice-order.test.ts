import { describe, it, expect } from "vitest";
import {
  normalizeArabicDigits,
  parseVoiceTranscript,
  tokenizeProductQuery,
} from "./voice-order";

describe("normalizeArabicDigits", () => {
  it("converts all Arabic-Indic digits ٠-٩ to ASCII 0-9", () => {
    expect(normalizeArabicDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
  });

  it("leaves ASCII digits untouched", () => {
    expect(normalizeArabicDigits("0123")).toBe("0123");
  });

  it("returns the input when no Arabic digits are present", () => {
    expect(normalizeArabicDigits("Hello")).toBe("Hello");
  });

  it("mixes Arabic and ASCII digits in one string", () => {
    expect(normalizeArabicDigits("Order ٠١٢ shipped")).toBe("Order 012 shipped");
  });
});

describe("parseVoiceTranscript", () => {
  it("returns [] for an empty / whitespace input", () => {
    expect(parseVoiceTranscript("")).toEqual([]);
    expect(parseVoiceTranscript("   ")).toEqual([]);
  });

  it("splits on the Arabic comma (،) and dedupes parts", () => {
    const out = parseVoiceTranscript("تفاح، موز");
    expect(out).toHaveLength(2);
    expect(out[0].query).toBe("تفاح");
    expect(out[1].query).toBe("موز");
  });

  it("splits on AND / and connectors", () => {
    const out = parseVoiceTranscript("apple and banana");
    expect(out).toHaveLength(2);
  });

  it("splits on the Arabic 'و' connector", () => {
    const out = parseVoiceTranscript("تفاح وموز");
    expect(out).toHaveLength(2);
  });

  it("normalizes Arabic digits in transcript before splitting", () => {
    const out = parseVoiceTranscript("تفاح ٣");
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(3);
  });

  it("extracts a leading numeric quantity with no suffix", () => {
    const out = parseVoiceTranscript("٢ تفاح");
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(2);
    expect(out[0].query).toBe("تفاح");
  });

  it("extracts a quantity with ×/x suffix", () => {
    const out = parseVoiceTranscript("3x تفاح");
    expect(out[0].quantity).toBe(3);
    expect(out[0].query).toBe("تفاح");
  });

  it("extracts a quantity with حبة / قطعة suffix", () => {
    const out = parseVoiceTranscript("تفاح ٣ حبة");
    expect(out[0].quantity).toBe(3);
  });

  it("defaults quantity to 1 when no number is found", () => {
    const out = parseVoiceTranscript("تفاح");
    expect(out[0].quantity).toBe(1);
  });

  it("clamps quantities between 1 and 99", () => {
    expect(parseVoiceTranscript("999 تفاح")[0].quantity).toBe(99);
    expect(parseVoiceTranscript("0 تفاح")[0].quantity).toBe(1);
  });
});

describe("tokenizeProductQuery", () => {
  it("splits on whitespace, lowercases, and keeps tokens ≥ 2 chars", () => {
    expect(tokenizeProductQuery("Apple Banana")).toEqual([
      "apple",
      "banana",
    ]);
  });

  it("filters out stop words (Arabic and short)", () => {
    const out = tokenizeProductQuery("تفاح في من و");
    expect(out).toEqual(["تفاح"]);
  });

  it("drops punctuation", () => {
    const out = tokenizeProductQuery("apple, banana!");
    expect(out).toEqual(["apple", "banana"]);
  });

  it("preserves Arabic letter ranges", () => {
    const out = tokenizeProductQuery("حليب طازج");
    expect(out).toContain("حليب");
    expect(out).toContain("طازج");
  });

  it("drops single-character noise", () => {
    expect(tokenizeProductQuery("a b apple")).toEqual(["apple"]);
  });

  it("returns [] when everything is filtered", () => {
    expect(tokenizeProductQuery("و في من")).toEqual([]);
  });
});
