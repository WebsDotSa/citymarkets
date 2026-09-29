import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import {
  getNotificationSettings,
  setAppSetting,
  type NotificationSettings,
} from "@/lib/app-settings";
import { logAdminAction } from "@/lib/admin-audit";
import { buildWhatsAppUrl } from "@/lib/utils";
import { notificationSettingsSchema } from "@/lib/validation";
import { error as logError } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const settings = await getNotificationSettings();
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    return NextResponse.json({ success: false, error: "فشل الجلب" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await request.json();
    const parsed = notificationSettingsSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || "إعدادات الإشعارات غير صالحة" },
        { status: 400 },
      );
    }
    const settings: NotificationSettings = parsed.data;
    await setAppSetting("notifications", settings as unknown as Record<string, unknown>);
    await logAdminAction(gate.admin, "settings.notifications_update", {
      entityType: "settings",
      entityId: "notifications",
      details: settings,
      request,
    });
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    logError("Notification settings PUT:", error);
    return NextResponse.json({ success: false, error: "فشل الحفظ" }, { status: 500 });
  }
}

/** معاينة رابط واتساب للاختبار */
export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const settings = await getNotificationSettings();
    const sample = "طلب تجريبي #123 — عميل تجريبي — 99.00 ر.س";
    const url = buildWhatsAppUrl(settings.whatsapp_admin_phone, sample);
    return NextResponse.json({ success: true, whatsapp_url: url });
  } catch (error) {
    logError("Notification settings preview:", error);
    return NextResponse.json({ success: false, error: "فشل المعاينة" }, { status: 500 });
  }
}
