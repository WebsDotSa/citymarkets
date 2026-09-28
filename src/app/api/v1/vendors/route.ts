import { NextResponse } from "next/server";
import { query } from "@/lib/db";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export async function GET() {
  try {
    const result = await query(
      `SELECT
        id, slug, name_ar, name_en, description_ar, description_en,
        logo_url, banner_url, vendor_type, primary_color,
        contact_phone, contact_whatsapp, address_ar,
        open_time::text, close_time::text,
        is_active, is_featured, sort_order,
        created_at
       FROM vendors
       WHERE is_active = TRUE
       ORDER BY is_featured DESC, sort_order ASC, created_at ASC`
    );

    const vendors = result.rows.map((v) => ({
      id: v.id,
      slug: v.slug,
      name: v.name_ar,
      nameEn: v.name_en,
      description: v.description_ar,
      descriptionEn: v.description_en,
      logo: v.logo_url,
      banner: v.banner_url,
      type: v.vendor_type,
      primaryColor: v.primary_color,
      contactPhone: v.contact_phone,
      contactWhatsapp: v.contact_whatsapp,
      address: v.address_ar,
      openTime: v.open_time,
      closeTime: v.close_time,
      isOpen: isStoreOpen(v.open_time, v.close_time),
    }));

    return NextResponse.json({ vendors });
  } catch (error) {
    logError("Vendors list error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في جلب المتاجر" },
      { status: 500 }
    );
  }
}

function isStoreOpen(openTime: string, closeTime: string): boolean {
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();
  
  const [openHour, openMin] = openTime.split(":").map(Number);
  const [closeHour, closeMin] = closeTime.split(":").map(Number);
  
  const open = openHour * 60 + openMin;
  const close = closeHour * 60 + closeMin;
  
  if (close < open) {
    // Overnight (e.g., 21:00 to 03:00)
    return currentTime >= open || currentTime < close;
  }
  
  return currentTime >= open && currentTime < close;
}
