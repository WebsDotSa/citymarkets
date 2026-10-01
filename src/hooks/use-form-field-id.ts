"use client";

import { useId, useMemo } from "react";

/**
 * Returns an SSR-safe, stable id derived from the form's scope and the
 * field's label/key. Use it to wire `<label htmlFor>` to `<input id>` in
 * forms that are not driven by the schema-driven admin form-fields
 * helpers (`DefaultField`, `CheckboxField`, etc., which already bind
 * `field-${key}`).
 *
 * The id is prefixed with `scope` to keep it unique when a page renders
 * the same form multiple times (e.g. multiple vendor settings on one
 * page, or admin delivery + scheduling forms side-by-side). `useId()`
 * gives a per-render suffix so the same component used twice on the same
 * page (e.g. multiple `<CouponEditor />` instances) still resolves to a
 * unique id per instance — without that, screen readers would announce
 * the wrong label for the duplicate instance.
 *
 * @example
 *   const baseFareId = useFormFieldId("delivery-form", "base-fare");
 *   <label htmlFor={baseFareId}>السعر الأساسي</label>
 *   <input id={baseFareId} type="number" ... />
 */
export function useFormFieldId(
  scope: string,
  fieldKey: string,
): string {
  const reactId = useId();
  return useMemo(() => {
    const safeScope = slugify(scope, "scope");
    const safeField = slugify(fieldKey, "field");
    return `${safeScope}-${safeField}-${reactId}`;
  }, [scope, fieldKey, reactId]);
}

/**
 * Variant that takes a raw Arabic/English label string and produces a
 * stable slug from it. Useful when the field has no explicit key — e.g.
 * one-off forms that derive identity from the visible label text.
 *
 * The id still gets a `useId()` suffix so multiple instances on the same
 * page do not collide.
 */
export function useFormFieldIdFromLabel(
  scope: string,
  label: string,
): string {
  const reactId = useId();
  return useMemo(() => {
    const safeScope = slugify(scope, "scope");
    const safeLabel = slugify(label, "field");
    return `${safeScope}-${safeLabel}-${reactId}`;
  }, [scope, label, reactId]);
}

/**
 * Returns an id factory for fields rendered inside a `.map(...)` so each
 * iteration gets a unique `id`/`htmlFor`. The factory closes over the
 * parent component's `useId()` so siblings of the loop don't collide.
 *
 * @example
 *   const slotRowId = useIndexedFieldIds("admin-delivery", "slot");
 *   {items.map((it, i) => (
 *     <>
 *       <label htmlFor={slotRowId(i, "label")}>الاسم</label>
 *       <input id={slotRowId(i, "label")} ... />
 *     </>
 *   ))}
 */
export function useIndexedFieldIds(
  scope: string,
  prefix: string,
): (index: number, key: string) => string {
  const reactId = useId();
  return useMemo(() => {
    const safeScope = slugify(scope, "scope");
    const safePrefix = slugify(prefix, "row");
    return (index: number, key: string) =>
      `${safeScope}-${safePrefix}-${index}-${slugify(key, "field")}-${reactId}`;
  }, [scope, prefix, reactId]);
}

/**
 * Strip diacritics, transliterate Arabic → Latin, lowercase, and join
 * non-alphanumerics with `-`. Falls back to `fallback` when the result
 * is empty.
 */
export function slugify(value: string, fallback = "field"): string {
  // Strip Arabic tatweel and Arabic combining marks first so they
  // don't interleave with the transliteration map. U+0610..U+061A and
  // U+064B..U+065F + U+0670 + U+06D6..U+06ED cover the Arabic
  // diacritics (harakat, dagger alef, etc.); NFKD of ا+همزة decomposes
  // into ا (U+0627) + ٔ (U+0654) which we don't want to surface in
  // the slug.
  let s = value.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
  s = s.replace(/[\u0640]/g, "");
  s = s.split("").map((ch) => ARABIC_TO_LATIN[ch] ?? ch).join("");
  const trimmed = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return trimmed || fallback;
}

// Minimal Arabic → Latin map. Covers the letters used in citymarkets
// admin/vendor labels. Anything not mapped falls through (e.g. Persian
// or Urdu chars) and will be dropped by the ASCII slug.
const ARABIC_TO_LATIN: Record<string, string> = {
  ا: "a",
  أ: "a",
  إ: "i",
  آ: "a",
  ٱ: "a",
  ب: "b",
  ت: "t",
  ث: "th",
  ج: "j",
  ح: "h",
  خ: "kh",
  د: "d",
  ذ: "th",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  ع: "a",
  غ: "gh",
  ف: "f",
  ق: "q",
  ك: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  و: "w",
  ي: "y",
  ى: "a",
  ة: "h",
  ء: "",
  ئ: "",
  ؤ: "",
};
