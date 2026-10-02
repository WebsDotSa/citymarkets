import { describe, it, expect } from "vitest";
import {
  parsePagination,
  clampLimit,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_PAGE,
} from "./pagination";

const mkParams = (kv: Record<string, string>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(kv)) p.set(k, v);
  return p;
};

describe("parsePagination", () => {
  it("returns DEFAULT_LIMIT when no params", () => {
    const r = parsePagination(mkParams({}));
    expect(r.limit).toBe(DEFAULT_LIMIT);
    expect(r.page).toBe(1);
    expect(r.offset).toBe(0);
  });

  it("parses a normal limit + page", () => {
    const r = parsePagination(mkParams({ limit: "10", page: "3" }));
    expect(r.limit).toBe(10);
    expect(r.page).toBe(3);
    expect(r.offset).toBe(20);
  });

  it("caps limit at MAX_LIMIT (PCP-118: 999999 → 100)", () => {
    const r = parsePagination(mkParams({ limit: "999999" }));
    expect(r.limit).toBe(MAX_LIMIT);
  });

  it("treats negative limit as DEFAULT (PCP-118: -1 → 50, not 1)", () => {
    const r = parsePagination(mkParams({ limit: "-1" }));
    expect(r.limit).toBe(DEFAULT_LIMIT);
  });

  it("treats NaN limit as DEFAULT (PCP-118: abc → 50, not 50 from Math.min)", () => {
    const r = parsePagination(mkParams({ limit: "abc" }));
    expect(r.limit).toBe(DEFAULT_LIMIT);
  });

  it("treats empty string as DEFAULT (PCP-118: limit= → 50)", () => {
    const r = parsePagination(mkParams({ limit: "" }));
    expect(r.limit).toBe(DEFAULT_LIMIT);
  });

  it("treats zero as DEFAULT (PCP-118: limit=0 → 50, not 0)", () => {
    const r = parsePagination(mkParams({ limit: "0" }));
    expect(r.limit).toBe(DEFAULT_LIMIT);
  });

  it("caps page at MAX_PAGE (avoid OFFSET full scans)", () => {
    const r = parsePagination(mkParams({ page: "999999" }));
    expect(r.page).toBe(MAX_PAGE);
  });

  it("treats negative page as 1 (PCP-118: page=-1 → 1, not -1)", () => {
    const r = parsePagination(mkParams({ page: "-5" }));
    expect(r.page).toBe(1);
  });

  it("honours custom defaultLimit / maxLimit", () => {
    const r = parsePagination(mkParams({ limit: "200" }), { maxLimit: 25 });
    expect(r.limit).toBe(25);
  });
});

describe("clampLimit", () => {
  it("caps at MAX_LIMIT", () => {
    expect(clampLimit("999999")).toBe(MAX_LIMIT);
  });

  it("returns default for negative / zero", () => {
    expect(clampLimit("-1")).toBe(DEFAULT_LIMIT);
    expect(clampLimit("0")).toBe(DEFAULT_LIMIT);
  });

  it("returns default for NaN / empty", () => {
    expect(clampLimit("abc")).toBe(DEFAULT_LIMIT);
    expect(clampLimit("")).toBe(DEFAULT_LIMIT);
    expect(clampLimit(null)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
  });

  it("accepts numbers directly", () => {
    expect(clampLimit(50)).toBe(50);
    expect(clampLimit(999999)).toBe(MAX_LIMIT);
  });
});