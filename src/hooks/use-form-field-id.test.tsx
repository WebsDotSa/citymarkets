import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  slugify,
  useFormFieldId,
  useFormFieldIdFromLabel,
  useIndexedFieldIds,
} from "./use-form-field-id";

describe("slugify", () => {
  it("lowercases ASCII and joins non-word chars with hyphens", () => {
    expect(slugify("Base Fare (SAR)")).toBe("base-fare-sar");
  });

  it("transliterates common Arabic letters to Latin", () => {
    expect(slugify("السعر الأساسي")).toBe("alsar-alasasy");
    expect(slugify("اسم المتجر")).toBe("asm-almtjr");
  });

  it("strips diacritics and tatweel before transliterating", () => {
    // Combining marks (fatha, kasra, etc.) and tatweel should not produce
    // stray hyphens in the middle of words.
    expect(slugify("الـــسعر")).toBe("alsar");
    expect(slugify("السِّعْر")).toBe("alsar");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("__hello__")).toBe("hello");
  });

  it("falls back when input produces an empty slug", () => {
    expect(slugify("???", "field")).toBe("field");
    expect(slugify("")).toBe("field");
  });
});

describe("useFormFieldId", () => {
  it("combines scope, field key, and a React useId() suffix", () => {
    const { result } = renderHook(() => useFormFieldId("delivery-form", "base-fare"));
    // useId() format from React 18+: ":r0:" / ":r1:" etc. Accept anything
    // that starts with the slug and ends with the react id.
    expect(result.current).toMatch(/^delivery-form-base-fare-:.+:$/);
  });

  it("returns the same id across re-renders with stable inputs", () => {
    const { result, rerender } = renderHook(
      ({ scope, key }: { scope: string; key: string }) =>
        useFormFieldId(scope, key),
      { initialProps: { scope: "s", key: "k" } },
    );
    const first = result.current;
    rerender({ scope: "s", key: "k" });
    expect(result.current).toBe(first);
  });

  it("changes the id when scope or field key changes", () => {
    const { result, rerender } = renderHook(
      ({ scope, key }: { scope: string; key: string }) =>
        useFormFieldId(scope, key),
      { initialProps: { scope: "s", key: "k" } },
    );
    const first = result.current;
    rerender({ scope: "s", key: "k2" });
    expect(result.current).not.toBe(first);
  });
});

describe("useFormFieldIdFromLabel", () => {
  it("slugifies the visible label into the id", () => {
    const { result } = renderHook(() =>
      useFormFieldIdFromLabel("vendor-settings", "السعر الأساسي"),
    );
    expect(result.current).toMatch(/^vendor-settings-alsar-alasasy-:.+:$/);
  });
});

describe("useIndexedFieldIds", () => {
  it("produces a unique id per (index, key) pair", () => {
    const { result } = renderHook(() =>
      useIndexedFieldIds("admin-delivery", "slot"),
    );
    const idAt = result.current;
    const idLabel0 = idAt(0, "label");
    const idLabel1 = idAt(1, "label");
    const idStart0 = idAt(0, "start");
    expect(idLabel0).not.toBe(idLabel1);
    expect(idLabel0).not.toBe(idStart0);
    expect(idLabel0).toMatch(/^admin-delivery-slot-0-label-:.+:$/);
    expect(idStart0).toMatch(/^admin-delivery-slot-0-start-:.+:$/);
  });

  it("returns a stable factory across re-renders with stable inputs", () => {
    const { result, rerender } = renderHook(
      ({ scope, prefix }: { scope: string; prefix: string }) =>
        useIndexedFieldIds(scope, prefix),
      { initialProps: { scope: "s", prefix: "p" } },
    );
    const first = result.current(0, "k");
    rerender({ scope: "s", prefix: "p" });
    expect(result.current(0, "k")).toBe(first);
  });
});
