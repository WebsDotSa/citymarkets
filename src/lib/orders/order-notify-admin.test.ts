import { describe, it, expect, vi, beforeEach } from "vitest";

// `vi.mock` is hoisted above imports by vitest. The factory functions run
// at module load and create their own `vi.fn()` instances; we grab those
// instances via `vi.mocked()` after the import to assert on them.
vi.mock("@/lib/app-settings", () => ({
  getNotificationSettings: vi.fn(),
  fillOrderNotificationTemplate: vi.fn((tmpl, vars) =>
    tmpl
      .replace(/\{order_id\}/g, String(vars.order_id))
      .replace(/\{customer\}/g, vars.customer)
      .replace(/\{total\}/g, vars.total),
  ),
}));

vi.mock("@/lib/format", () => ({
  buildWhatsAppUrl: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { notifyAdminNewOrder } from "./order-notify-admin";
import { getNotificationSettings } from "@/lib/app-settings";
import { buildWhatsAppUrl } from "@/lib/format";
import * as loggerMod from "@/lib/logger";

const mockGetNotificationSettings = vi.mocked(getNotificationSettings);
const mockBuildWhatsAppUrl = vi.mocked(buildWhatsAppUrl);
const mockLogInfo = vi.mocked(loggerMod.info);
const mockLogError = vi.mocked(loggerMod.error);

describe("notifyAdminNewOrder", () => {
  beforeEach(() => {
    mockGetNotificationSettings.mockReset();
    mockBuildWhatsAppUrl.mockReset();
    mockLogInfo.mockReset();
    mockLogError.mockReset();
  });

  it("returns {whatsappUrl: null} when new-order notifications are disabled", async () => {
    mockGetNotificationSettings.mockResolvedValueOnce({
      notify_new_order: false,
      whatsapp_admin_phone: "+966500000000",
      message_template: "t",
    });
    const out = await notifyAdminNewOrder({ id: 1, total: 100 });
    expect(out).toEqual({ whatsappUrl: null });
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
  });

  it("fills the template, builds the WhatsApp URL, and logs an audit event", async () => {
    mockGetNotificationSettings.mockResolvedValueOnce({
      notify_new_order: true,
      whatsapp_admin_phone: "+966500000000",
      message_template: "طلب #{order_id} {customer} {total}",
    });
    mockBuildWhatsAppUrl.mockReturnValueOnce("https://wa.me/966500000000?text=...");

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
    // Audit: structured log, not a payment_events INSERT (that table is
    // reserved for payment-gateway events; admin-notification audits are
    // not payment events).
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.stringMatching(/notify-admin/),
      expect.objectContaining({ orderId: 42, hasUrl: true }),
    );
  });

  it("defaults customerName to 'عميل' when null/undefined/missing", async () => {
    mockGetNotificationSettings.mockResolvedValue({
      notify_new_order: true,
      whatsapp_admin_phone: "+966500000000",
      message_template: "{customer}",
    });
    mockBuildWhatsAppUrl.mockReturnValue("url");

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

    await notifyAdminNewOrder({ id: 1, total: 99.5 });
    expect(mockBuildWhatsAppUrl).toHaveBeenCalledWith(
      "+966500000000",
      "99.50",
    );
  });

  it("returns {whatsappUrl: null} on top-level exception (e.g. settings read fails)", async () => {
    mockGetNotificationSettings.mockRejectedValueOnce(
      new Error("settings unavailable"),
    );
    const out = await notifyAdminNewOrder({ id: 1, total: 50 });
    expect(out).toEqual({ whatsappUrl: null });
    expect(mockLogError).toHaveBeenCalled();
  });

  it("returns {whatsappUrl: null} when buildWhatsAppUrl returns null (invalid phone)", async () => {
    mockGetNotificationSettings.mockResolvedValueOnce({
      notify_new_order: true,
      whatsapp_admin_phone: "not-a-phone",
      message_template: "x",
    });
    mockBuildWhatsAppUrl.mockReturnValueOnce(null);

    const out = await notifyAdminNewOrder({ id: 1, total: 50 });
    expect(out).toEqual({ whatsappUrl: null });
    // Audit still fires with hasUrl=false so ops can spot missed notifications.
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.stringMatching(/notify-admin/),
      expect.objectContaining({ orderId: 1, hasUrl: false }),
    );
  });
});