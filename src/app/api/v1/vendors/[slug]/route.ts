import { NextResponse } from "next/server";
import { query } from "@/lib/db";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';
// BUGFIX (audit 2026-09-29): see siblings — replace local isStoreOpen
// with the Riyadh-tz-aware helper that already exists in
// `src/lib/delivery/vendor-store-hours`.
import { isVendorOpen, parseVendorHours } from "@/lib/delivery/vendor-store-hours";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const result = await query(
      `SELECT
        v.id, v.slug, v.name_ar, v.name_en,
        v.description_ar, v.description_en,
        v.logo_url, v.banner_url, v.vendor_type, v.primary_color,
        v.contact_phone, v.contact_email, v.contact_whatsapp,
        v.address_ar, v.pickup_lat, v.pickup_lng,
        v.open_time::text, v.close_time::text,
        v.is_active, v.is_featured,
        vs.delivery_mode, vs.delivery_fee_override, vs.min_order_amount,
        vs.accepts_cod, vs.accepts_online_payment,
        vs.meta_title_ar, vs.meta_description_ar
       FROM vendors v
       LEFT JOIN vendor_settings vs ON v.id = vs.vendor_id
       WHERE v.slug = $1 AND v.is_active = TRUE`,
      [slug]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "المتجر غير موجود" },
        { status: 404 }
      );
    }

    const v = result.rows[0];

    // Get products count
    const productsCount = await query(
      "SELECT COUNT(*) as count FROM vendor_products WHERE vendor_id = $1 AND is_active = TRUE",
      [v.id]
    );

    const vendor = {
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
      contact: {
        phone: v.contact_phone,
        email: v.contact_email,
        whatsapp: v.contact_whatsapp,
      },
      address: v.address_ar,
      pickupLocation: v.pickup_lat && v.pickup_lng ? {
        lat: parseFloat(v.pickup_lat),
        lng: parseFloat(v.pickup_lng),
      } : null,
      openTime: v.open_time,
      closeTime: v.close_time,
      isOpen: isVendorOpen(parseVendorHours(v)),
      settings: {
        deliveryMode: v.delivery_mode,
        deliveryFee: v.delivery_fee_override,
        minOrder: v.min_order_amount,
        acceptsCod: v.accepts_cod,
        acceptsOnlinePayment: v.accepts_online_payment,
      },
      seo: {
        title: v.meta_title_ar,
        description: v.meta_description_ar,
      },
      stats: {
        productsCount: parseInt(productsCount.rows[0].count),
      },
    };

    return NextResponse.json({ vendor });
  } catch (error) {
    logError("Vendor details error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في جلب بيانات المتجر" },
      { status: 500 }
    );
  }
}
