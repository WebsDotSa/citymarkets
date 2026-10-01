import { describe, expect, it } from "vitest";
import { getApiErrorCode, getApiErrorMessage } from "./api-error";

describe("getApiErrorMessage", () => {
  it("reads the legacy string envelope", () => {
    expect(getApiErrorMessage({ success: false, error: "خطأ" }, "fb")).toBe("خطأ");
  });
  it("reads the canonical envelope (ar default, en on request)", () => {
    const body = { success: false, error: { code: "BAD_REQUEST", messageAr: "عربي", messageEn: "English" } };
    expect(getApiErrorMessage(body, "fb")).toBe("عربي");
    expect(getApiErrorMessage(body, "fb", "en")).toBe("English");
    expect(getApiErrorCode(body)).toBe("BAD_REQUEST");
  });
  it("falls back on empty / missing / non-object bodies (same as `|| fallback`)", () => {
    expect(getApiErrorMessage({ error: "" }, "fb")).toBe("fb");
    expect(getApiErrorMessage({}, "fb")).toBe("fb");
    expect(getApiErrorMessage(null, "fb")).toBe("fb");
    expect(getApiErrorMessage("oops", "fb")).toBe("fb");
    expect(getApiErrorCode({ error: "x" })).toBeNull();
  });
});
