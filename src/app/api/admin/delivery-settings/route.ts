import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdminApi } from '@/lib/identity';
import { logAdminAction } from "@/lib/admin-audit";
import {
  deliveryPricingSchema,
  deliverySlotsSchema,
  deliveryHoursSchema,
} from "@/lib/validation";
import { DEFAULT_DELIVERY_HOURS } from "@/lib/delivery-hours";

import { error as logError } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    // Get all delivery settings
    const result = await query(
      `SELECT key, value, updated_at FROM delivery_settings ORDER BY key`
    );

    // Return as key-value object
    const settings: Record<string, any> = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }

    // Return default pricing if not set. Migration 060 — delivery fee
    // is `computeDistanceFee(distanceKm, settings)` driven by these
    // admin-tunable knobs. Service fee + tax are still editable from
    // the same panel.
    if (!settings.pricing) {
      settings.pricing = {
        // Distance-based fee (matches `DELIVERY_*` defaults in
        // `@/lib/delivery-distance-fee` so a fresh install behaves
        // identically to a deployment that has never saved pricing).
        baseSar: 3,
        includedKm: 2,
        perExtraKmSar: 1.5,
        // Service + tax knobs
        serviceFeeEnabled: true,
        serviceFeeType: "fixed",
        serviceFeeValue: 3,
        taxEnabled: false,
        taxPercent: 0,
      };
    } else {
      // Older records (pre-tuning) may not carry the distance knobs —
      // backfill them in-flight so the admin form never has to branch
      // on `undefined`. The form saves the full object on next PUT.
      const p = settings.pricing as Record<string, unknown>;
      if (p.baseSar == null) p.baseSar = 3;
      if (p.includedKm == null) p.includedKm = 2;
      if (p.perExtraKmSar == null) p.perExtraKmSar = 1.5;
    }
    // Mirror the same default for slots so the dashboard always has a
    // shape to render even on a fresh install (migration 047 seeds the
    // DB but this is a belt-and-braces fallback).
    if (!settings.slots) {
      settings.slots = {
        enabled: true,
        lead_time_minutes: 120,
        max_days_ahead: 7,
        min_days_ahead: 0,
        timezone: "Asia/Riyadh",
        slot_duration_minutes: 120,
        windows: [
          { id: "morning", label_ar: "صباحاً", start: "09:00", end: "11:00", capacity: 20 },
          { id: "noon", label_ar: "ظهراً", start: "12:00", end: "14:00", capacity: 25 },
          { id: "afternoon", label_ar: "عصراً", start: "15:00", end: "17:00", capacity: 25 },
          { id: "evening", label_ar: "مساءً", start: "18:00", end: "20:00", capacity: 30 },
        ],
      };
    }

    // Daily working-hours config: empty until the admin saves it. We
    // always surface the shape so the admin form can render without
    // branching on `undefined`.
    if (!settings.hours) {
      settings.hours = { ...DEFAULT_DELIVERY_HOURS };
    }

    return NextResponse.json({ success: true, data: settings });
  } catch (error) {
    logError("delivery-settings GET:", error);
    return NextResponse.json({ success: false, error: "فشل الجلب" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await request.json();
    const updatedKeys: string[] = [];

    // Update pricing settings
    if (body.pricing) {
      const parsed = deliveryPricingSchema.safeParse(body.pricing);
      if (!parsed.success) {
        const firstIssue = parsed.error.errors[0];
        return NextResponse.json(
          { success: false, error: firstIssue?.message || 'بيانات التسعير غير صالحة' },
          { status: 400 }
        );
      }
      await query(
        `INSERT INTO delivery_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
        ["pricing", JSON.stringify(parsed.data)]
      );
      updatedKeys.push("pricing");
    }

    // Update delivery time-slots config
    if (body.slots) {
      const parsed = deliverySlotsSchema.safeParse(body.slots);
      if (!parsed.success) {
        const firstIssue = parsed.error.errors[0];
        return NextResponse.json(
          { success: false, error: firstIssue?.message || 'بيانات الفتحات غير صالحة' },
          { status: 400 }
        );
      }
      // Range sanity: min_days_ahead <= max_days_ahead.
      const data = parsed.data;
      if (data.min_days_ahead > data.max_days_ahead) {
        return NextResponse.json(
          { success: false, error: "min_days_ahead يجب أن يكون ≤ max_days_ahead" },
          { status: 400 }
        );
      }
      // Window sanity: start < end (lexicographic works for HH:MM).
      for (const w of data.windows) {
        if (w.start >= w.end) {
          return NextResponse.json(
            { success: false, error: `بداية الفترة (${w.start}) يجب أن تكون قبل النهاية (${w.end}) في "${w.label_ar}"` },
            { status: 400 }
          );
        }
      }
      await query(
        `INSERT INTO delivery_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
        ["slots", JSON.stringify(data)]
      );
      updatedKeys.push("slots");
    }

    // Update daily working-hours config (used to gate checkout).
    if (body.hours) {
      const parsed = deliveryHoursSchema.safeParse(body.hours);
      if (!parsed.success) {
        const firstIssue = parsed.error.errors[0];
        return NextResponse.json(
          { success: false, error: firstIssue?.message || 'بيانات ساعات العمل غير صالحة' },
          { status: 400 }
        );
      }
      await query(
        `INSERT INTO delivery_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
        ["hours", JSON.stringify(parsed.data)]
      );
      updatedKeys.push("hours");
    }

    if (updatedKeys.length === 0) {
      return NextResponse.json(
        { success: false, error: "لم يتم تحديد بيانات للتحديث" },
        { status: 400 }
      );
    }

    await logAdminAction(gate.admin, "delivery_settings.update", {
      entityType: "delivery_settings",
      entityId: updatedKeys.join(","),
      details: body,
      request,
    });

    return NextResponse.json({ success: true, updated_keys: updatedKeys });
  } catch (error) {
    logError("delivery-settings PUT:", error);
    return NextResponse.json({ success: false, error: "فشل التحديث" }, { status: 500 });
  }
}
