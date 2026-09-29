import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

function qr<T extends QueryResultRow = QueryResultRow>(rows: T[] = [], rowCount = rows.length): QueryResult<T> {
  return { rows, rowCount, command: "", oid: 0, fields: [] };
}

// `vi.mock` is hoisted above imports by vitest. The factory functions run
// at module load and create their own `vi.fn()` instances; we grab those
// instances via `vi.mocked()` after the import to assert on them.
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

vi.mock("@/lib/app-settings", () => ({
  getNotificationSettings: vi.fn(),
  fillOrderNotificationTemplate: vi.fn((tmpl, vars) =>
    tmpl
      .replace(/\{order_id\}/g, String(vars.order_id))
      .replace(/\{customer\}/g, vars.customer)
      .replace(/\{total\}/g, vars.total),
  ),
}));

vi.mock("@/lib/utils", () => ({
  buildWhatsAppUrl: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
}));

import { notifyAdminNewOrder } from "./order-notify-admin";
import { query } from "@/lib/db";
import { getNotificationSettings } from "@/lib/app-settings";
import { buildWhatsAppUrl } from "@/lib/utils";

const mockQuery = vi.mocked(query);
const mockGetNotificationSettings = vi.mocked(getNotificationSettings);
const mockBuildWhatsAppUrl = vi.mocked(buildWhatsAppUrl);

describe("notifyAdminNewOrder", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetNotificationSettings.mockReset();
    mockBuildWhatsAppUrl.mockReset();
  });

  it("returns {whatsappUrl: null} when new-order notifications are disabled", async () => {
    mockGetNotificationSettings.mockResolvedValueOnce({
      notify_new_order: false,
      whatsapp_admin_phone: "+966500000000",
      message_template: "t",
    });
    const out = await notifyAdminNewOrder({ id: 1, total: 100 });
    expect(out).toEqual({ whatsappUrl: null });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockBuildWhatsAppUrl).not.toHaveBeenCalled();
  });

  it("returns {whatsappUrl: null} when admin phone is not configured", async () => {
    mockGetNotificationSettings.mockResolvedValueOnce({
      notify_new_order: true,
      whatsapp_admin_phone: "",
      message_template: "t",
    });
    const out = await notifyAdminNewOrder({ id: 1, total: 100 });
    expect(out).toEqual({ whatsappUrl: null });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("fills the template, builds the WhatsApp URL, and logs to payment_events", async () => {
    mockGetNotificationSettings.mockResolvedValueOnce({
      notify_new_order: true,
      whatsapp_admin_phone: "+966500000000",
      message_template: "طلب #{order_id} {customer} {total}",
    });
    mockBuildWhatsAppUrl.mockReturnValueOnce("https://wa.me/966500000000?text=...");
    mockQuery.mockResolvedValueOnce(qr());

    const out = await notifyAdminNewOrder({
      id: 42,
      total: 100,
      customerName: "محمد",
    });

    expect(out.whatsappUrl).toBe("https://wa.me/966500000000?text=...");
    expect(mockBuildWhatsAppUrl).toHaveBeenCalledWith(
      "+966500000000",
      "طلب #42 محمد 100.00",
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payment_events/i),
      [42, expect.any(String)],
    );
  });

  it("defaults customerName to 'عميل' when null/undefined/missing", async () => {
    mockGetNotificationSettings.mockResolvedValue({
      notify_new_order: true,
      whatsapp_admin_phone: "+966500000000",
      message_template: "{customer}",
    });
    mockBuildWhatsAppUrl.mockReturnValue("url");
    mockQuery.mockResolvedValue(qr());

    await notifyAdminNewOrder({ id: 1, total: 50, customerName: null });
    expect(mockBuildWhatsAppUrl).toHaveBeenCalledWith("+966500000000", "عميل");

    mockBuildWhatsAppUrl.mockClear();
    await notifyAdminNewOrder({ id: 1, total: 50, customerName: undefined });
    expect(mockBuildWhatsAppUrl).toHaveBeenCalledWith("+966500000000", "عميل");
  });

  it("formats total as a 2-decimal string", async () => {
    mockGetNotificationSettings.mockResolvedValueOnce({
      notify_new_order: true,
      whatsapp_admin_phone: "+966500000000",
      message_template: "{total}",
    });
    mockBuildWhatsAppUrl.mockReturnValueOnce("url");
    mockQuery.mockResolvedValueOnce(qr());

    await notifyAdminNewOrder({ id: 1, total: 99.5 });
    expect(mockBuildWhatsAppUrl).toHaveBeenCalledWith(
      "+966500000000",
      "99.50",
    );
  });

  it("swallows the payment_events insert error (logs but does not throw)", async () => {
    mockGetNotificationSettings.mockResolvedValueOnce({
      notify_new_order: true,
      whatsapp_admin_phone: "+966500000000",
      message_template: "x",
    });
    mockBuildWhatsAppUrl.mockReturnValueOnce("url");
    // Make the insert fail; the .catch(() => {}) inside the SUT swallows it.
    mockQuery.mockRejectedValueOnce(new Error("insert failed"));

    const out = await notifyAdminNewOrder({ id: 1, total: 50 });
    // whatsappUrl is the URL the function already built — the side-effect
    // insert failure does NOT null it out because the catch is silent
    // and only the outer try/catch would set it to null.
    expect(out.whatsappUrl).toBe("url");
  });

  it("returns {whatsappUrl: null} on top-level exception (e.g. settings read fails)", async () => {
    mockGetNotificationSettings.mockRejectedValueOnce(
      new Error("settings unavailable"),
    );
    const out = await notifyAdminNewOrder({ id: 1, total: 50 });
    expect(out).toEqual({ whatsappUrl: null });
  });

  it("still attempts to insert an audit row when buildWhatsAppUrl returns null", async () => {
    mockGetNotificationSettings.mockResolvedValueOnce({
      notify_new_order: true,
      whatsapp_admin_phone: "not-a-phone",
      message_template: "x",
    });
    mockBuildWhatsAppUrl.mockReturnValueOnce(null);
    mockQuery.mockResolvedValueOnce(qr());

    const out = await notifyAdminNewOrder({ id: 1, total: 50 });
    expect(out).toEqual({ whatsappUrl: null });
    // The insert still happens with whatsapp_url=null so the audit log
    // captures the attempt (useful for debugging missed notifications).
    expect(mockQuery).toHaveBeenCalled();
  });
});