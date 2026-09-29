import { describe, expect, it } from "vitest";
import {
  buildHoursStatus,
  DEFAULT_DELIVERY_HOURS,
  evaluateHours,
  parseDeliveryHours,
  type DeliveryHours,
} from "./delivery-hours";

const baseHours: DeliveryHours = {
  ...DEFAULT_DELIVERY_HOURS,
};

const at = (h: number, m: number = 0): Date => {
  // 2026-08-23 is a Sunday in Riyadh. Pick a date in the middle of the
  // week so we don't accidentally land on a DST boundary (Saudi has
  // none, but tests should still be deterministic).
  const d = new Date(Date.UTC(2026, 7, 23, h - 3, m, 0, 0));
  return d;
};

describe("parseDeliveryHours", () => {
  it("returns defaults for null/undefined input", () => {
    expect(parseDeliveryHours(null)).toEqual(DEFAULT_DELIVERY_HOURS);
    expect(parseDeliveryHours(undefined)).toEqual(DEFAULT_DELIVERY_HOURS);
  });

  it("fills defaults for missing fields", () => {
    expect(parseDeliveryHours({ enabled: false })).toEqual({
      ...DEFAULT_DELIVERY_HOURS,
      enabled: false,
    });
  });

  it("rejects malformed HH:MM and falls back to default", () => {
    const parsed = parseDeliveryHours({
      enabled: true,
      open_time: "25:00",
      close_time: "not-a-time",
    });
    expect(parsed.open_time).toBe(DEFAULT_DELIVERY_HOURS.open_time);
    expect(parsed.close_time).toBe(DEFAULT_DELIVERY_HOURS.close_time);
  });

  it("preserves valid HH:MM verbatim", () => {
    const parsed = parseDeliveryHours({
      enabled: true,
      open_time: "08:30",
      close_time: "22:15",
      timezone: "Asia/Riyadh",
      closed_message: "  مرحباً  ",
    });
    expect(parsed.open_time).toBe("08:30");
    expect(parsed.close_time).toBe("22:15");
    expect(parsed.closed_message).toBe("مرحباً");
  });
});

describe("evaluateHours", () => {
  it("returns open=true when disabled", () => {
    const hours: DeliveryHours = { ...baseHours, enabled: false };
    expect(evaluateHours(hours, at(15)).open).toBe(true);
    expect(evaluateHours(hours, at(3)).open).toBe(true);
  });

  it("respects a same-day window", () => {
    const hours: DeliveryHours = { ...baseHours, open_time: "09:00", close_time: "23:00" };
    expect(evaluateHours(hours, at(8, 59)).open).toBe(false);
    expect(evaluateHours(hours, at(9)).open).toBe(true);
    expect(evaluateHours(hours, at(15)).open).toBe(true);
    expect(evaluateHours(hours, at(22, 59)).open).toBe(true);
    // [open, close) — exact close time is outside.
    expect(evaluateHours(hours, at(23)).open).toBe(false);
  });

  it("wraps overnight windows past midnight", () => {
    const hours: DeliveryHours = { ...baseHours, open_time: "18:00", close_time: "02:00" };
    expect(evaluateHours(hours, at(15)).open).toBe(false);
    expect(evaluateHours(hours, at(18)).open).toBe(true);
    expect(evaluateHours(hours, at(23)).open).toBe(true);
    expect(evaluateHours(hours, at(1, 59)).open).toBe(true);
    expect(evaluateHours(hours, at(2)).open).toBe(false);
    expect(evaluateHours(hours, at(10)).open).toBe(false);
  });

  it("returns the configured message when closed", () => {
    const hours: DeliveryHours = {
      ...baseHours,
      closed_message: "نلتقي قريباً",
    };
    const r = evaluateHours(hours, at(3));
    expect(r.open).toBe(false);
    expect(r.message).toBe("نلتقي قريباً");
  });
});

describe("buildHoursStatus", () => {
  it("exposes enabled/open snapshot", () => {
    const hours: DeliveryHours = {
      ...baseHours,
      open_time: "09:00",
      close_time: "23:00",
    };
    const status = buildHoursStatus(hours, at(15));
    expect(status.enabled).toBe(true);
    expect(status.open).toBe(true);
    expect(status.open_time).toBe("09:00");
    expect(status.close_time).toBe("23:00");
    expect(status.today_key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reports open=false when outside hours", () => {
    const hours: DeliveryHours = {
      ...baseHours,
      open_time: "09:00",
      close_time: "23:00",
    };
    expect(buildHoursStatus(hours, at(2)).open).toBe(false);
    expect(buildHoursStatus(hours, at(23)).open).toBe(false);
  });
});
