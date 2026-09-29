import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from '@/lib/identity';
import {
  getStoreStatusSettings,
  setAppSetting,
  DEFAULT_STORE_STATUS,
  type StoreStatusSettings,
} from "@/lib/app-settings";
import { storeStatusSettingsSchema } from "@/lib/validation";
import { logAdminAction } from "@/lib/admin-audit";
import { error as logError } from "@/lib/logger";

/**
 * GET /api/admin/settings/store-status
 * Returns the current open/closed toggle + the banner message shown to
 * storefront visitors when closed.
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const settings = await getStoreStatusSettings();
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    logError("store-status GET:", error);
    return NextResponse.json({ success: false, error: "فشل الجلب" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/settings/store-status
 * Body: { is_open: boolean, message?: string }
 * Updates the toggle + banner message. Falls back to the default
 * banner message when the caller omits `message` or sends an empty
 * string, so we always show a meaningful notice.
 */
export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await request.json();
    const parsed = storeStatusSettingsSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: first?.message || "إعدادات حالة الموقع غير صالحة" },
        { status: 400 },
      );
    }
    const incoming: StoreStatusSettings = {
      is_open: parsed.data.is_open,
      // Empty / whitespace messages fall back to the default copy.
      message:
        parsed.data.message && parsed.data.message.trim().length > 0
          ? parsed.data.message
          : DEFAULT_STORE_STATUS.message,
      updated_by: gate.admin.email ?? null,
    };
    await setAppSetting("store_status", incoming as unknown as Record<string, unknown>);
    await logAdminAction(gate.admin, "settings.store_status_update", {
      entityType: "settings",
      entityId: "store_status",
      details: incoming,
      request,
    });
    return NextResponse.json({ success: true, settings: incoming });
  } catch (error) {
    logError("store-status PUT:", error);
    return NextResponse.json({ success: false, error: "فشل الحفظ" }, { status: 500 });
  }
}
