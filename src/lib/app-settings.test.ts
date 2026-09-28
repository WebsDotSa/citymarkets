import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/db so the test never opens a real connection.
const mockQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

import {
  getAppSetting,
  setAppSetting,
  getNotificationSettings,
  getInventorySettings,
  fillOrderNotificationTemplate,
} from "./app-settings";

describe("getAppSetting", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns the fallback when the row does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const out = await getAppSetting("missing", { foo: "bar" });
    expect(out).toEqual({ foo: "bar" });
  });

  it("returns the row value merged onto the fallback (DB overrides fallback)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { foo: "from-db", extra: 42 } }],
      rowCount: 1,
    });
    const out = await getAppSetting("any", { foo: "default", keep: "yes" });
    expect(out).toEqual({ foo: "from-db", extra: 42, keep: "yes" });
  });

  it("returns the fallback when the query throws (DB unavailable)", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection refused"));
    const out = await getAppSetting("any", { x: 1 });
    expect(out).toEqual({ x: 1 });
  });

  it("passes the key as the first SQL parameter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await getAppSetting("notifications", { whatsapp_admin_phone: "" });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM app_settings"),
      ["notifications"],
    );
  });
});

describe("setAppSetting", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("uses UPSERT syntax (ON CONFLICT DO UPDATE) so the same key can be re-set", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await setAppSetting("inventory", { low_stock_threshold: 10 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/INSERT INTO app_settings/i);
    expect(sql).toMatch(/ON CONFLICT \(key\) DO UPDATE/i);
  });

  it("serializes the value as JSON and passes [key, jsonStr] to query", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const payload = { low_stock_threshold: 7 };
    await setAppSetting("inventory", payload);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
      "inventory",
      JSON.stringify(payload),
    ]);
  });

  it("casts the value to jsonb so PostgreSQL stores nested objects", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await setAppSetting("k", { nested: { ok: true } });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/\$2::jsonb/);
  });

  it("propagates errors from the underlying query", async () => {
    mockQuery.mockRejectedValueOnce(new Error("write failed"));
    await expect(setAppSetting("k", {})).rejects.toThrow("write failed");
  });
});

describe("getNotificationSettings / getInventorySettings", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("getNotificationSettings returns the default shape when nothing is stored", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const out = await getNotificationSettings();
    expect(out.whatsapp_admin_phone).toBe("");
    expect(out.notify_new_order).toBe(true);
    expect(out.message_template).toContain("#{order_id}");
  });

  it("getNotificationSettings merges DB overrides over the defaults", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { whatsapp_admin_phone: "+966500000000" } }],
      rowCount: 1,
    });
    const out = await getNotificationSettings();
    expect(out.whatsapp_admin_phone).toBe("+966500000000");
    // Other defaults are still present
    expect(out.notify_new_order).toBe(true);
    expect(typeof out.message_template).toBe("string");
  });

  it("getInventorySettings returns low_stock_threshold=5 by default", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const out = await getInventorySettings();
    expect(out.low_stock_threshold).toBe(5);
  });

  it("getInventorySettings returns the DB value when present", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { low_stock_threshold: 20 } }],
      rowCount: 1,
    });
    const out = await getInventorySettings();
    expect(out.low_stock_threshold).toBe(20);
  });
});

describe("fillOrderNotificationTemplate", () => {
  it("replaces {order_id} with the string form of the id (numeric)", () => {
    const out = fillOrderNotificationTemplate("طلب #{order_id}", {
      order_id: 42,
      customer: "محمد",
      total: "100.00 ر.س",
    });
    expect(out).toBe("طلب #42");
  });

  it("replaces {order_id} with the string form of the id (string)", () => {
    const out = fillOrderNotificationTemplate("طلب #{order_id}", {
      order_id: "abc-123",
      customer: "محمد",
      total: "100.00 ر.س",
    });
    expect(out).toBe("طلب #abc-123");
  });

  it("replaces {customer} and {total}", () => {
    const out = fillOrderNotificationTemplate(
      "{customer} طلب {total}",
      {
        order_id: 1,
        customer: "سارة",
        total: "75.50 ر.س",
      },
    );
    expect(out).toBe("سارة طلب 75.50 ر.س");
  });

  it("replaces all three tokens together in the canonical template", () => {
    const tmpl =
      "طلب جديد #{order_id} — {customer} — {total} ر.س — أسواق سيتي";
    const out = fillOrderNotificationTemplate(tmpl, {
      order_id: 12345,
      customer: "محمد",
      total: "250.00",
    });
    expect(out).toBe("طلب جديد #12345 — محمد — 250.00 ر.س — أسواق سيتي");
  });

  it("replaces every occurrence (uses /g flag), not just the first", () => {
    const out = fillOrderNotificationTemplate("{order_id} -> {order_id}", {
      order_id: 7,
      customer: "x",
      total: "0",
    });
    expect(out).toBe("7 -> 7");
  });

  it("leaves the template untouched when no tokens are present", () => {
    const out = fillOrderNotificationTemplate("static message", {
      order_id: 1,
      customer: "x",
      total: "0",
    });
    expect(out).toBe("static message");
  });
});