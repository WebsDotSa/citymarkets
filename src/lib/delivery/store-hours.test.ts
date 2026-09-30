/**
 * Tests for `src/lib/delivery/store-hours.ts` — per-branch opening
 * hours resolution (migration 079).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/db";
import {
  DEFAULT_STORE_OPENING_HOURS,
  evaluateStoreHours,
  getActiveStoreHours,
  parseStoreHours,
} from "./store-hours";

describe("store-hours — parseStoreHours", () => {
  it("returns defaults for null/undefined/non-object input", () => {
    expect(parseStoreHours(null).enabled).toBe(false);
    expect(parseStoreHours(undefined).open_time).toBe("09:00");
    expect(parseStoreHours("oops").close_time).toBe("23:00");
  });

  it("preserves overrides while filling missing keys", () => {
    const out = parseStoreHours({ enabled: true, open_time: "08:00" });
    expect(out.enabled).toBe(true);
    expect(out.open_time).toBe("08:00");
    expect(out.close_time).toBe("23:00"); // default fallback
  });

  it("rejects malformed HH:MM strings and falls back", () => {
    const out = parseStoreHours({ open_time: "99:99", close_time: "abc" });
    expect(out.open_time).toBe("09:00");
    expect(out.close_time).toBe("23:00");
  });

  it("trims the closed_message but keeps it non-empty", () => {
    const out = parseStoreHours({ closed_message: "  مغلق  " });
    expect(out.closed_message).toBe("مغلق");
  });

  it("replaces an empty closed_message with the default", () => {
    const out = parseStoreHours({ closed_message: "   " });
    expect(out.closed_message).toBe(DEFAULT_STORE_OPENING_HOURS.closed_message);
  });
});

describe("store-hours — evaluateStoreHours", () => {
  it("treats enabled=false as always-open (matches global default semantics)", () => {
    const out = evaluateStoreHours({
      enabled: false,
      open_time: "09:00",
      close_time: "23:00",
      timezone: "Asia/Riyadh",
      closed_message: "x",
    }, new Date("2026-09-30T03:00:00.000Z")); // 06:00 Riyadh — outside 09-23
    expect(out.open).toBe(true);
  });

  it("gates when enabled=true and now is outside [open, close)", () => {
    const out = evaluateStoreHours({
      enabled: true,
      open_time: "09:00",
      close_time: "23:00",
      timezone: "Asia/Riyadh",
      closed_message: "مغلق",
    }, new Date("2026-09-30T03:00:00.000Z")); // 06:00 Riyadh
    expect(out.open).toBe(false);
    expect(out.message).toBe("مغلق");
  });

  it("opens when enabled=true and now is inside [open, close)", () => {
    const out = evaluateStoreHours({
      enabled: true,
      open_time: "09:00",
      close_time: "23:00",
      timezone: "Asia/Riyadh",
      closed_message: "مغلق",
    }, new Date("2026-09-30T07:00:00.000Z")); // 10:00 Riyadh
    expect(out.open).toBe(true);
  });
});

describe("store-hours — getActiveStoreHours", () => {
  it("returns branch hours when opening_hours.enabled = true", async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        {
          opening_hours: {
            enabled: true,
            open_time: "10:00",
            close_time: "20:00",
            timezone: "Asia/Riyadh",
            closed_message: "الفرع مغلق",
          },
        },
      ],
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      fields: [],
    });
    // No second call needed — branch wins.
    const out = await getActiveStoreHours(
      { query: vi.mocked(query) },
      "00000000-0000-0000-0000-000000000000",
    );
    expect(out?.enabled).toBe(true);
    expect(out?.open_time).toBe("10:00");
    expect(out?.close_time).toBe("20:00");
    expect(out?.closed_message).toBe("الفرع مغلق");
  });

  it("falls back to global delivery_settings.hours when branch is disabled", async () => {
    vi.mocked(query)
      // First call: stores.opening_hours (disabled)
      .mockResolvedValueOnce({
        rows: [{ opening_hours: { enabled: false, open_time: "09:00", close_time: "23:00", timezone: "Asia/Riyadh", closed_message: "x" } }],
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
      })
      // Second call: delivery_settings.hours (global)
      .mockResolvedValueOnce({
        rows: [
          {
            value: {
              enabled: true,
              open_time: "08:00",
              close_time: "22:00",
              timezone: "Asia/Riyadh",
              closed_message: "global-msg",
            },
          },
        ],
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
      });
    const out = await getActiveStoreHours(
      { query: vi.mocked(query) },
      "00000000-0000-0000-0000-000000000000",
    );
    expect(out?.enabled).toBe(true);
    expect(out?.open_time).toBe("08:00"); // from global, not branch
    expect(out?.closed_message).toBe("global-msg");
  });

  it("returns null when the store id is unknown", async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [],
      command: "SELECT",
      rowCount: 0,
      oid: 0,
      fields: [],
    });
    const out = await getActiveStoreHours(
      { query: vi.mocked(query) },
      "missing-store",
    );
    expect(out).toBeNull();
  });

  it("falls back to defaults if global settings hiccup on a disabled branch", async () => {
    vi.mocked(query)
      // stores.opening_hours (disabled)
      .mockResolvedValueOnce({
        rows: [{ opening_hours: { enabled: false, open_time: "09:00", close_time: "23:00", timezone: "Asia/Riyadh", closed_message: "x" } }],
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
      })
      // delivery_settings.hours → throws
      .mockRejectedValueOnce(new Error("connection refused"));
    const out = await getActiveStoreHours(
      { query: vi.mocked(query) },
      "00000000-0000-0000-0000-000000000000",
    );
    expect(out?.enabled).toBe(true);
    expect(out?.open_time).toBe("09:00");
  });
});
