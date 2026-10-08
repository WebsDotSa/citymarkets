import { describe, it, expect } from "vitest";
import {
  UUID_RE,
  isValidUuid,
  validateUuidOrError,
} from "./uuid-guard";

describe("UUID_RE", () => {
  it("matches canonical 8-4-4-4-12 hex", () => {
    expect(UUID_RE.test("11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(UUID_RE.test("aBcDeF01-2345-6789-aBcD-eF0123456789")).toBe(true);
    expect(UUID_RE.test("00000000-0000-0000-0000-000000000000")).toBe(true);
  });

  it("rejects malformed UUIDs", () => {
    expect(UUID_RE.test("")).toBe(false);
    expect(UUID_RE.test("bad-uuid")).toBe(false);
    expect(UUID_RE.test("11111111-1111-1111-1111-11111111111")).toBe(false); // too short
    expect(UUID_RE.test("11111111-1111-1111-1111-1111111111111")).toBe(false); // too long
    expect(UUID_RE.test("11111111_1111_1111_1111_111111111111")).toBe(false); // underscores
    expect(UUID_RE.test("11111111-1111-1111-1111-11111111111g")).toBe(false); // bad hex
  });
});

describe("isValidUuid", () => {
  it("accepts canonical UUIDs", () => {
    expect(isValidUuid("11111111-1111-1111-1111-111111111111")).toBe(true);
  });

  it("rejects empty string and non-strings", () => {
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(123)).toBe(false);
    expect(isValidUuid({})).toBe(false);
  });
});

describe("validateUuidOrError", () => {
  it("returns null for valid UUIDs (caller proceeds)", () => {
    expect(
      validateUuidOrError("11111111-1111-1111-1111-111111111111", "معرّف الطلب")
    ).toBeNull();
  });

  it("returns a 400 NextResponse for invalid UUIDs", async () => {
    const r = validateUuidOrError("bad-uuid", "معرّف الطلب");
    expect(r).not.toBeNull();
    expect(r!.status).toBe(400);
    const body = await r!.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("معرّف الطلب غير صالح");
  });

  it("preserves the entity label so offers / vendors / etc. read naturally", async () => {
    const r = validateUuidOrError("not-a-uuid", "معرّف العرض");
    expect(r!.status).toBe(400);
    const body = await r!.json();
    expect(body.error).toBe("معرّف العرض غير صالح");
  });
});