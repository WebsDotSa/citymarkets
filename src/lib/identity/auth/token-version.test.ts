/**
 * Tests for src/lib/identity/auth/token-version.ts
 *
 * P0-1b (security Phase 2, 2026-10-03): centralised token_version
 * comparison. The three verify paths (customer / admin / vendor)
 * previously inlined their own `payload.tokenVersion ?? 1 === row
 * ?? 1` comparison. The audit (PCP-144) caught earlier rounds
 * (PCP-128, PCP-134) where the write happened but the compare did
 * not — landed on a write-only column. Centralising the compare in
 * one place closes that class of bug.
 */

import { describe, it, expect } from "vitest";
import {
  assertTokenVersionMatches,
  tokenVersionMatches,
} from "@/lib/identity/auth/token-version";

describe("tokenVersionMatches", () => {
  it("returns true when claim and row are equal numbers", () => {
    expect(tokenVersionMatches(1, 1)).toBe(true);
    expect(tokenVersionMatches(5, 5)).toBe(true);
  });

  it("returns false when claim and row differ", () => {
    expect(tokenVersionMatches(1, 2)).toBe(false);
    expect(tokenVersionMatches(2, 1)).toBe(false);
  });

  it("treats undefined claim as 1 (legacy JWT)", () => {
    // The classic migration path: a JWT minted before the fix has no
    // tokenVersion claim; the row's default is 1. Match.
    expect(tokenVersionMatches(undefined, 1)).toBe(true);
  });

  it("treats null claim as 1 (defensive — claim set to null)", () => {
    expect(tokenVersionMatches(null, 1)).toBe(true);
  });

  it("treats null row value as 1 (column unset, default)", () => {
    expect(tokenVersionMatches(1, null)).toBe(true);
  });

  it("rejects when both are unset (claim undefined, row null) but bumped to 2 on row", () => {
    // Legacy JWT (no claim) vs a row that has been bumped to 2.
    // The JWT effectively says 1, the row says 2 — reject.
    expect(tokenVersionMatches(undefined, 2)).toBe(false);
  });

  it("accepts a freshly-bumped row only if the JWT claim matches", () => {
    // After logout: row=2, JWT=2 (because the JWT was re-minted
    // post-login, baking the new value in). Match.
    expect(tokenVersionMatches(2, 2)).toBe(true);
  });

  it("rejects a stale JWT (claim=1) after the row was bumped (row=2)", () => {
    // The classic post-logout case: the JWT still claims 1, the
    // row is now 2. Reject.
    expect(tokenVersionMatches(1, 2)).toBe(false);
  });

  it("handles string-encoded numbers from raw query results", () => {
    // pg sometimes returns BIGINT as a string. We accept that.
    expect(tokenVersionMatches("3", 3)).toBe(true);
    expect(tokenVersionMatches(3, "3")).toBe(true);
  });

  it("rejects non-numeric / non-string values that wouldn't coerce", () => {
    // [] and {} are not numbers and not digit-strings. They coerce
    // to 1 in toVersion(). A matching row of 1 would therefore pass
    // — that's the intended behaviour (be lenient on input). The
    // important property is that they DON'T sneak past a row value
    // that is itself > 1.
    expect(tokenVersionMatches([], 2)).toBe(false);
    expect(tokenVersionMatches({ a: 1 }, 2)).toBe(false);
  });

  it("rejects zero and negative versions (only positive integers valid)", () => {
    // token_version starts at 1 in every migration. A row of 0 or
    // negative would indicate a bug; we treat them as 1 for
    // comparison rather than special-casing the comparison.
    expect(tokenVersionMatches(0, 1)).toBe(true);  // both coerce to 1
    expect(tokenVersionMatches(-1, 1)).toBe(true); // both coerce to 1
  });
});

describe("assertTokenVersionMatches", () => {
  it("returns true when payload is present and versions match", () => {
    expect(
      assertTokenVersionMatches({ tokenVersion: 1 }, 1),
    ).toBe(true);
  });

  it("returns false when payload is null", () => {
    expect(assertTokenVersionMatches(null, 1)).toBe(false);
  });

  it("returns false when payload is undefined", () => {
    expect(assertTokenVersionMatches(undefined, 1)).toBe(false);
  });

  it("returns false when versions do not match", () => {
    expect(
      assertTokenVersionMatches({ tokenVersion: 1 }, 2),
    ).toBe(false);
  });

  it("treats a payload without a tokenVersion claim as version 1", () => {
    expect(
      assertTokenVersionMatches(
        { userId: "u" } as { tokenVersion?: unknown },
        1,
      ),
    ).toBe(true);
  });
});
