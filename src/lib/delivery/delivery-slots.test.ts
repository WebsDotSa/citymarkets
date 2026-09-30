/**
 * Tests for `src/lib/delivery/delivery-slots.ts` — slot config parsing,
 * availability building, and slot selection validation.
 *
 * Migration 078 (2026-09-30): previously there was no dedicated test
 * for the slots module — coverage was implicit through the orders
 * routes. This file pins down the public contract so future refactors
 * (per-branch capacity, multi-zone capacity, etc.) don't accidentally
 * regress the customer-facing slot picker.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLOTS_CONFIG,
  addDays,
  buildAvailability,
  findWindow,
  parseSlotsConfig,
  riyadhWallClockToUtc,
  toRiyadhDateKey,
  validateSlotSelection,
  windowForTime,
  type SlotsConfig,
} from "./delivery-slots";

describe("delivery-slots — config parsing", () => {
  it("returns DEFAULT_SLOTS_CONFIG for null/undefined/non-object input", () => {
    expect(parseSlotsConfig(null).enabled).toBe(true);
    expect(parseSlotsConfig(undefined).windows).toHaveLength(4);
    expect(parseSlotsConfig("not an object").windows).toHaveLength(4);
  });

  it("preserves partial overrides while filling missing keys", () => {
    const parsed = parseSlotsConfig({
      enabled: false,
      lead_time_minutes: 90,
      windows: [{ id: "x", label_ar: "س", start: "10:00", end: "12:00", capacity: 5 }],
    });
    expect(parsed.enabled).toBe(false);
    expect(parsed.lead_time_minutes).toBe(90);
    expect(parsed.windows).toHaveLength(1);
    expect(parsed.timezone).toBe("Asia/Riyadh");
    expect(parsed.max_days_ahead).toBe(7);
  });

  it("falls back to default windows when caller passes an empty array", () => {
    const parsed = parseSlotsConfig({ windows: [] });
    expect(parsed.windows).toHaveLength(4);
    expect(parsed.windows[0].id).toBe("morning");
  });
});

describe("delivery-slots — Riyadh TZ math", () => {
  it("toRiyadhDateKey converts a UTC instant to a Riyadh calendar date", () => {
    // 2026-09-30 22:30 UTC = 2026-10-01 01:30 Riyadh → next day.
    const utc = new Date("2026-09-30T22:30:00.000Z");
    expect(toRiyadhDateKey(utc)).toBe("2026-10-01");
    // 2026-09-30 02:00 UTC = 2026-09-30 05:00 Riyadh → same day.
    expect(toRiyadhDateKey(new Date("2026-09-30T02:00:00.000Z"))).toBe(
      "2026-09-30",
    );
  });

  it("riyadhWallClockToUtc inverts the offset (wall - 3h)", () => {
    const dt = riyadhWallClockToUtc("2026-09-30", "09:00");
    expect(dt.toISOString()).toBe("2026-09-30T06:00:00.000Z");
  });

  it("addDays handles month rollover", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("delivery-slots — windowForTime + findWindow", () => {
  const cfg: SlotsConfig = DEFAULT_SLOTS_CONFIG;

  it("finds the window containing a HH:MM instant", () => {
    expect(windowForTime(cfg, "2026-09-30", "09:30")?.id).toBe("morning");
    expect(windowForTime(cfg, "2026-09-30", "12:00")?.id).toBe("noon");
    expect(windowForTime(cfg, "2026-09-30", "15:00")?.id).toBe("afternoon");
    expect(windowForTime(cfg, "2026-09-30", "18:30")?.id).toBe("evening");
  });

  it("returns null for gaps between windows (e.g. 11:30)", () => {
    expect(windowForTime(cfg, "2026-09-30", "11:30")).toBeNull();
  });

  it("returns null for windows that wrap to the next day", () => {
    expect(windowForTime(cfg, "2026-09-30", "23:00")).toBeNull();
  });

  it("findWindow by id is order-stable", () => {
    expect(findWindow(cfg, "noon")?.start).toBe("12:00");
    expect(findWindow(cfg, "does-not-exist")).toBeNull();
  });
});

describe("delivery-slots — buildAvailability", () => {
  it("marks a window as full when booked >= capacity", () => {
    const cfg: SlotsConfig = { ...DEFAULT_SLOTS_CONFIG, lead_time_minutes: 0 };
    const out = buildAvailability(cfg, toRiyadhDateKey(new Date()), {
      morning: 20,
      noon: 0,
      afternoon: 0,
      evening: 0,
    });
    const morning = out.find((w) => w.id === "morning");
    expect(morning?.available).toBe(false);
    expect(morning?.booked).toBe(20);
  });

  it("emits a UTC ISO for the window start", () => {
    const cfg: SlotsConfig = { ...DEFAULT_SLOTS_CONFIG, lead_time_minutes: 0 };
    const out = buildAvailability(cfg, "2026-09-30", {
      morning: 0,
      noon: 0,
      afternoon: 0,
      evening: 0,
    });
    const morning = out.find((w) => w.id === "morning");
    expect(morning?.start_at).toBe("2026-09-30T06:00:00.000Z");
    expect(morning?.end_at).toBe("2026-09-30T08:00:00.000Z");
  });

  it("respects cfg.enabled — disables all when false", () => {
    const cfg: SlotsConfig = { ...DEFAULT_SLOTS_CONFIG, enabled: false };
    const out = buildAvailability(cfg, "2026-12-31", {
      morning: 0,
      noon: 0,
      afternoon: 0,
      evening: 0,
    });
    expect(out.every((w) => w.available === false)).toBe(true);
  });
});

describe("delivery-slots — validateSlotSelection (regression: zone=null)", () => {
  // Tests run with a mocked `now` so the [min_days_ahead, max_days_ahead]
  // window is reproducible regardless of the real wall-clock.
  const now = new Date("2026-09-30T03:00:00.000Z"); // 06:00 Riyadh
  const cfg = DEFAULT_SLOTS_CONFIG;

  it("accepts a slot whose scheduled_for is exactly the window start", () => {
    // 2026-10-01 09:00 Riyadh — within lead-time, within max_days_ahead
    const scheduledFor = riyadhWallClockToUtc("2026-10-01", "09:00");
    const out = validateSlotSelection(
      cfg,
      "morning",
      scheduledFor.toISOString(),
      0,
      now,
    );
    expect(out.ok).toBe(true);
  });

  it("rejects when slot_id and scheduled_for disagree", () => {
    // scheduled_for lands at 12:30 → 'noon' window, but caller said 'morning'
    const scheduledFor = riyadhWallClockToUtc("2026-10-01", "12:30");
    const out = validateSlotSelection(
      cfg,
      "morning",
      scheduledFor.toISOString(),
      0,
      now,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/الفترة المختارة لا تطابق/);
    }
  });

  it("rejects when scheduled_for is inside the lead-time window", () => {
    const scheduledFor = riyadhWallClockToUtc("2026-10-01", "09:00"); // +3h ahead
    const out = validateSlotSelection(
      cfg,
      "morning",
      scheduledFor.toISOString(),
      0,
      new Date("2026-10-01T05:30:00.000Z"), // +3.5h Riyadh
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/بعد 120 دقيقة/);
    }
  });

  it("rejects when date is past max_days_ahead", () => {
    const farFuture = riyadhWallClockToUtc(
      addDays(toRiyadhDateKey(now), 30),
      "09:00",
    );
    const out = validateSlotSelection(
      cfg,
      "morning",
      farFuture.toISOString(),
      0,
      now,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/بين 0 و 7 أيام/);
    }
  });

  it("rejects when the window is full", () => {
    const scheduledFor = riyadhWallClockToUtc("2026-10-01", "09:00");
    const out = validateSlotSelection(
      cfg,
      "morning",
      scheduledFor.toISOString(),
      20, // capacity = 20 in DEFAULT_SLOTS_CONFIG
      now,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/ممتلئة/);
    }
  });

  it("rejects when scheduling is disabled", () => {
    const disabled: SlotsConfig = { ...cfg, enabled: false };
    const scheduledFor = riyadhWallClockToUtc("2026-10-01", "09:00");
    const out = validateSlotSelection(
      disabled,
      "morning",
      scheduledFor.toISOString(),
      0,
      now,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/غير متاحة/);
    }
  });

  it("rejects an unknown slot_id", () => {
    const scheduledFor = riyadhWallClockToUtc("2026-10-01", "09:00");
    const out = validateSlotSelection(
      cfg,
      "wee-hours",
      scheduledFor.toISOString(),
      0,
      now,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/غير صالحة/);
    }
  });

  it("rejects a malformed scheduled_for", () => {
    const out = validateSlotSelection(cfg, "morning", "not-an-iso", 0, now);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/غير صالح/);
    }
  });
});
