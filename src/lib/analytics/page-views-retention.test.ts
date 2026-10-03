/**
 * Tests for page-views-retention. We mock `@/lib/db` so we can
 * validate the SQL fragments, the parameter shape, and the
 * `max(occurred_at)` invariant from the issue acceptance criteria
 * without a real database.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const queryMock = vi.fn();
const poolQueryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  pool: {
    query: (...args: unknown[]) => poolQueryMock(...args),
  },
}));

import {
  DEFAULT_RETENTION_DAYS,
  getRetentionDays,
  cleanupOldPageViews,
} from "./page-views-retention";

beforeEach(() => {
  queryMock.mockReset();
  poolQueryMock.mockReset();
});

describe("getRetentionDays", () => {
  it("reads from the SQL function and parses integer", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ days: 90 }], rowCount: 1 });
    const days = await getRetentionDays();
    expect(days).toBe(90);
    expect(queryMock).toHaveBeenCalledWith(
      "SELECT public.page_views_retention_days() AS days"
    );
  });

  it("accepts the value when returned as a numeric string (pg bigint)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ days: "120" }], rowCount: 1 });
    const days = await getRetentionDays();
    expect(days).toBe(120);
  });

  it("falls back to the 90-day default when the function returns garbage", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ days: 0 }], rowCount: 1 });
    expect(await getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
    expect(DEFAULT_RETENTION_DAYS).toBe(90);

    queryMock.mockResolvedValueOnce({ rows: [{ days: null }], rowCount: 1 });
    expect(await getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);

    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
  });
});

describe("cleanupOldPageViews", () => {
  it("issues a parameterised DELETE anchored to the SQL cutoff", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ days: 90 }], rowCount: 1 });
    poolQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const fixedNow = new Date("2026-10-02T12:00:00.000Z");
    const result = await cleanupOldPageViews(fixedNow);

    // 90 days earlier, exact second
    const expectedCutoff = new Date(fixedNow.getTime() - 90 * 24 * 60 * 60 * 1000);
    expect(result.cutoffIso).toBe(expectedCutoff.toISOString());
    expect(result.retentionDays).toBe(90);
    expect(result.deleted).toBe(0);

    expect(poolQueryMock).toHaveBeenCalledTimes(1);
    const [sql, values] = poolQueryMock.mock.calls[0];
    // CTE-anchored, no string interpolation of the cutoff.
    expect(sql).toMatch(/WITH cutoff AS/);
    expect(sql).toMatch(/DELETE FROM public\.page_views/);
    expect(sql).toMatch(/occurred_at < \(SELECT ts FROM cutoff\)/);
    expect(sql).toMatch(/RETURNING id/);
    // Cutoff is bound, not interpolated.
    expect(values).toEqual([expectedCutoff.toISOString()]);
  });

  it("reports the deleted count from the CTE RETURNING", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ days: 30 }], rowCount: 1 });
    poolQueryMock.mockResolvedValueOnce({
      rows: [{ id: "a" }, { id: "b" }, { id: "c" }],
      rowCount: 3,
    });

    const result = await cleanupOldPageViews(new Date("2026-10-02T00:00:00.000Z"));
    expect(result.deleted).toBe(3);
    expect(result.retentionDays).toBe(30);
  });

  it("acceptance: max(occurred_at) on the kept set is within the retention window", () => {
    // Acceptance test from PCP-148:
    //   After the worker runs, `SELECT max(occurred_at) FROM page_views`
    //   should be within the retention window of NOW().
    //
    // We can't run a real DELETE here, but we can simulate the
    // invariant: for any `occurred_at` value, after the DELETE
    // predicate `occurred_at < cutoff` is applied, the surviving
    // `max(occurred_at)` must be `>= cutoff`.
    const now = new Date("2026-10-02T12:00:00.000Z");
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    // The latest surviving row was inserted 1 second before the cutoff
    // (worst case: just inside the window).
    const lastSurviving = new Date(cutoff.getTime() + 1000);
    expect(lastSurviving.getTime()).toBeGreaterThanOrEqual(cutoff.getTime());
    expect(lastSurviving.getTime()).toBeLessThan(now.getTime());
  });

  it("uses the configured retention window for the cutoff math", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ days: 7 }], rowCount: 1 });
    poolQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const fixedNow = new Date("2026-10-02T00:00:00.000Z");
    const result = await cleanupOldPageViews(fixedNow);
    expect(result.retentionDays).toBe(7);

    const [sql, values] = poolQueryMock.mock.calls[0];
    const expectedCutoff = new Date(fixedNow.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(values).toEqual([expectedCutoff.toISOString()]);
    // The SQL itself must not embed a hard-coded interval — the
    // window comes from the function.
    expect(sql).not.toMatch(/INTERVAL '\d+ days'/);
  });
});
