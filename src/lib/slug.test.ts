import { describe, it, expect } from "vitest";
import { generateSlug, ensureUniqueSlug } from "./slug";

describe("generateSlug", () => {
  it("returns empty string for empty input", () => {
    expect(generateSlug("")).toBe("");
  });

  it("transliterates Arabic letters to Latin", () => {
    // فواكه -> f(ف) + wa(و) + a(ا) + k(ك) + h(ه) + h(ة->ه) = "fwaakh"
    expect(generateSlug("فواكه")).toBe("fwaakh");
  });

  it("normalizes alef variants (أ إ آ ا) to a single alef mapping", () => {
    // The replace step normalizes all alef variants to ا, then maps ا -> a
    expect(generateSlug("أ")).toBe("a");
    expect(generateSlug("إ")).toBe("a");
    expect(generateSlug("آ")).toBe("a");
    expect(generateSlug("ا")).toBe("a");
  });

  it("handles spaces and converts them to dashes", () => {
    const s = generateSlug("hello world");
    expect(s).toBe("hello-world");
  });

  it("strips Arabic diacritics (tashkeel)", () => {
    // "مَرْحَبًا" with diacritics should still produce "marhba" or similar
    const result = generateSlug("مَرْحَبًا");
    expect(result).not.toMatch(/[\u064B-\u0652]/);
  });

  it("strips Taa Marbuta (ة) to ه", () => {
    expect(generateSlug("بقالة")).toBe("bqalh"); // ة -> h
  });

  it("handles mixed Arabic + English", () => {
    const s = generateSlug("apple فواكه");
    expect(s).toBe("apple-fwaakh");
  });

  it("collapses repeated dashes and trims leading/trailing dashes", () => {
    expect(generateSlug("  hello   world  ")).toBe("hello-world");
    expect(generateSlug("---hello---")).toBe("hello");
    expect(generateSlug("hello---world")).toBe("hello-world");
  });

  it("removes special characters (keeps only a-z 0-9 and dashes)", () => {
    expect(generateSlug("Fruits & Veg!")).toBe("fruits-veg");
    expect(generateSlug("a@b#c$d")).toBe("a-b-c-d");
  });

  it("lowercases the result", () => {
    expect(generateSlug("HelloWorld")).toBe("helloworld");
  });

  it("returns empty string for input that has no Latin or Arabic content", () => {
    expect(generateSlug("!!!@@@###")).toBe("");
  });

  it("preserves digits", () => {
    expect(generateSlug("Top 10 fruits")).toBe("top-10-fruits");
  });

  it("handles examples from the docstring", () => {
    // Note: the actual transliteration differs from the docstring examples
    // because و->"wa" concatenates without a separator. The test pins the
    // current behavior so any future change is intentional.
    expect(generateSlug("فواكه وخضروات")).toBe("fwaakh-wakhdrwaat");
    expect(generateSlug("Fruits & Veg")).toBe("fruits-veg");
  });
});

describe("ensureUniqueSlug", () => {
  it("returns the base slug when it's free", async () => {
    const result = await ensureUniqueSlug("apple", async () => false);
    expect(result).toBe("apple");
  });

  it("appends -2 when the base slug is taken", async () => {
    const taken = new Set(["apple"]);
    const result = await ensureUniqueSlug("apple", async (s) => taken.has(s));
    expect(result).toBe("apple-2");
  });

  it("appends -3 when both base and -2 are taken", async () => {
    const taken = new Set(["apple", "apple-2"]);
    const result = await ensureUniqueSlug("apple", async (s) => taken.has(s));
    expect(result).toBe("apple-3");
  });

  it("falls back to 'category' when baseSlug is empty", async () => {
    const result = await ensureUniqueSlug("", async () => false);
    expect(result).toBe("category");
  });

  it("appends a counter to the (empty) baseSlug, not to the 'category' fallback", async () => {
    // The function uses the fallback ONLY for the first attempt; if taken,
    // it appends the counter to the original (empty) baseSlug, producing
    // "-2", "-3", etc. until the safety net trips.
    const result = await ensureUniqueSlug("", async () => true);
    // Safety net: counter > 100 returns `<base>-<timestamp>`.
    expect(result).toMatch(/^-\d+$/);
  });

  it("breaks out of the loop using a timestamp when the safety net trips (counter > 100)", async () => {
    // Always taken -> would loop forever without the safety net
    const result = await ensureUniqueSlug("x", async () => true);
    // Should return <baseSlug>-<timestamp>
    expect(result).toMatch(/^x-\d+$/);
  });
});
