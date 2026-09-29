import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireVendorRole } from "@/lib/identity";
import { verifyVendorRequestWithDb } from "@/lib/identity/vendor-auth-with-db";
import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export async function GET(request: Request) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const result = await query(
      `SELECT v.*, vs.delivery_mode, vs.delivery_fee_override, vs.min_order_amount,
              vs.accepts_cod, vs.accepts_online_payment,
              vs.notify_on_new_order_whatsapp, vs.notify_on_new_order_email,
              vs.meta_title_ar, vs.meta_description_ar
       FROM vendors v
       LEFT JOIN vendor_settings vs ON v.id = vs.vendor_id
       WHERE v.id = $1`,
      [session.vendorId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "المتجر غير موجود" }, { status: 404 });
    }

    const v = result.rows[0];

    return NextResponse.json({
      vendor: {
        id: v.id,
        slug: v.slug,
        name: v.name_ar,
        nameEn: v.name_en,
        description: v.description_ar,
        descriptionEn: v.description_en,
        logo: v.logo_url,
        banner: v.banner_url,
        vendorType: v.vendor_type,
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
        isActive: v.is_active,
        isFeatured: v.is_featured,
      },
      settings: {
        deliveryMode: v.delivery_mode || "shared",
        deliveryFeeOverride: v.delivery_fee_override,
        minOrderAmount: v.min_order_amount,
        acceptsCod: v.accepts_cod,
        acceptsOnlinePayment: v.accepts_online_payment,
        notifyWhatsapp: v.notify_on_new_order_whatsapp,
        notifyEmail: v.notify_on_new_order_email,
        seo: {
          title: v.meta_title_ar,
          description: v.meta_description_ar,
        },
      },
    });
  } catch (error) {
    logError("Get vendor settings error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في جلب الإعدادات" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const unauthorized = requireVendorRole(session, "manager");
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const { vendor, settings } = body;

    // Update vendor info
    if (vendor) {
      const vendorUpdates: string[] = [];
      const vendorValues: any[] = [];
      let paramIndex = 1;

      const vendorFields: Record<string, string> = {
        name: "name_ar",
        nameEn: "name_en",
        description: "description_ar",
        descriptionEn: "description_en",
        logo: "logo_url",
        banner: "banner_url",
        primaryColor: "primary_color",
        contactPhone: "contact_phone",
        contactEmail: "contact_email",
        contactWhatsapp: "contact_whatsapp",
        address: "address_ar",
        openTime: "open_time",
        closeTime: "close_time",
      };

      for (const [key, dbField] of Object.entries(vendorFields)) {
        if (vendor[key] !== undefined) {
          vendorUpdates.push(`${dbField} = $${paramIndex}`);
          vendorValues.push(vendor[key]);
          paramIndex++;
        }
      }

      if (vendorUpdates.length > 0) {
        vendorValues.push(session.vendorId);
        await query(
          `UPDATE vendors SET ${vendorUpdates.join(", ")} WHERE id = $${paramIndex}`,
          vendorValues
        );
      }
    }

    // Update settings
    if (settings) {
      const settingsUpdates: string[] = ["updated_at = NOW()"];
      const settingsValues: any[] = [];
      let paramIndex = 1;

      const settingsFields: Record<string, string> = {
        deliveryMode: "delivery_mode",
        deliveryFeeOverride: "delivery_fee_override",
        minOrderAmount: "min_order_amount",
        acceptsCod: "accepts_cod",
        acceptsOnlinePayment: "accepts_online_payment",
        notifyWhatsapp: "notify_on_new_order_whatsapp",
        notifyEmail: "notify_on_new_order_email",
        seoTitle: "meta_title_ar",
        seoDescription: "meta_description_ar",
      };

      for (const [key, dbField] of Object.entries(settingsFields)) {
        if (settings[key] !== undefined) {
          settingsUpdates.push(`${dbField} = $${paramIndex}`);
          settingsValues.push(settings[key]);
          paramIndex++;
        }
      }

      settingsValues.push(session.vendorId);

      await query(
        `INSERT INTO vendor_settings (vendor_id, ${settingsUpdates.slice(0, -1).map((u) => u.split(" = ")[0]).join(", ")})
         VALUES ($${paramIndex}, ${settingsUpdates.slice(0, -1).map((u, i) => `$${i + 1}`).join(", ")})
         ON CONFLICT (vendor_id) DO UPDATE SET ${settingsUpdates.join(", ")}`,
        [...settingsValues.slice(0, -1), session.vendorId]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("Update vendor settings error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في تحديث الإعدادات" },
      { status: 500 }
    );
  }
}
