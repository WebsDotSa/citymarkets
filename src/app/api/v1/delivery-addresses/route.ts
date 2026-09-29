import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { sanitizePlaceImageUrls } from '@/lib/catalog';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

// SECURITY: place_images validation now mirrors the strict C3 RBAC
// allowlist from `@/lib/place-image`. Previous prefix-only check
// accepted `..`, protocol-relative URLs, and arbitrary schemes —
// kept here for parity with `/api/v1/addresses` so any client that
// can hit the looser route can no longer bypass the stricter one.

async function ownerFromRequest(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  const guestKey = request.headers.get("x-guest-key");
  return { userId, guestKey };
}

// GET /api/v1/delivery-addresses
export async function GET(request: NextRequest) {
  const { userId, guestKey } = await ownerFromRequest(request);
  if (!userId && !guestKey) {
    return NextResponse.json(
      { success: false, error: "يجب تسجيل الدخول أو استخدام معرّف الضيف" },
      { status: 400 }
    );
  }

  try {
    const result = userId
      ? await query(
          `SELECT id, label, description, title, lat, lng, address_text, is_default,
                  COALESCE(place_images, '{}') AS place_images, created_at
           FROM addresses WHERE user_id = $1
           ORDER BY is_default DESC, created_at DESC`,
          [userId]
        )
      : await query(
          `SELECT id, label, description, title, lat, lng, address_text, is_default,
                  COALESCE(place_images, '{}') AS place_images, created_at
           FROM addresses WHERE guest_key = $1
           ORDER BY is_default DESC, created_at DESC`,
          [guestKey]
        );

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    logError("delivery-addresses GET:", error);
    return NextResponse.json(
      { success: false, error: "فشل جلب العناوين" },
      { status: 500 }
    );
  }
}

// POST /api/v1/delivery-addresses
export async function POST(request: NextRequest) {
  const { userId, guestKey } = await ownerFromRequest(request);
  if (!userId && !guestKey) {
    return NextResponse.json(
      { success: false, error: "يجب تسجيل الدخول أو استخدام معرّف الضيف" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { label, lat, lng, address_text, description, title, is_default, place_images } = body;

    if (!label || !address_text) {
      return NextResponse.json(
        { success: false, error: "التسمية والعنوان مطلوبان" },
        { status: 400 }
      );
    }

    // Title is the user-facing display label. Required since migration
    // 049 made the column NOT NULL. Fall back to description, then
    // label, so older clients (iOS + web) keep working.
    const resolvedTitle = (() => {
      if (typeof title === "string" && title.trim().length > 0) return title.trim();
      if (typeof description === "string" && description.trim().length > 0) return description.trim();
      return label;
    })();

    // Validate place_images via the shared allowlist (see SECURITY note
    // at the top of this file). Cap at 5.
    const validImages = sanitizePlaceImageUrls(place_images, 5);

    const countSql = userId
      ? "SELECT COUNT(*)::int AS c FROM addresses WHERE user_id = $1"
      : "SELECT COUNT(*)::int AS c FROM addresses WHERE guest_key = $1";
    const countResult = await query(countSql, [userId || guestKey]);
    const isFirst = countResult.rows[0]?.c === 0;
    const makeDefault = is_default === true || isFirst;

    if (makeDefault && userId) {
      await query(
        "UPDATE addresses SET is_default = false WHERE user_id = $1",
        [userId]
      );
    } else if (makeDefault && guestKey) {
      await query(
        "UPDATE addresses SET is_default = false WHERE guest_key = $1",
        [guestKey]
      );
    }

    const insertResult = userId
      ? await query(
          `INSERT INTO addresses (user_id, label, lat, lng, address_text, description, title, is_default, place_images)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[])
           RETURNING id, label, lat, lng, address_text, description, title, is_default, place_images, created_at`,
          [
            userId,
            label,
            parseFloat(lat) || 0,
            parseFloat(lng) || 0,
            address_text,
            description || null,
            resolvedTitle,
            makeDefault,
            validImages,
          ]
        )
      : await query(
          `INSERT INTO addresses (guest_key, label, lat, lng, address_text, description, title, is_default, place_images)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[])
           RETURNING id, label, lat, lng, address_text, description, title, is_default, place_images, created_at`,
          [
            guestKey,
            label,
            parseFloat(lat) || 0,
            parseFloat(lng) || 0,
            address_text,
            description || null,
            resolvedTitle,
            makeDefault,
            validImages,
          ]
        );

    return NextResponse.json({
      success: true,
      data: insertResult.rows[0],
    });
  } catch (error) {
    logError("delivery-addresses POST:", error);
    return NextResponse.json(
      { success: false, error: "فشل حفظ العنوان" },
      { status: 500 }
    );
  }
}

// PUT /api/v1/delivery-addresses?id=  (edit)
export async function PUT(request: NextRequest) {
  const { userId, guestKey } = await ownerFromRequest(request);
  if (!userId && !guestKey) {
    return NextResponse.json(
      { success: false, error: "يجب تسجيل الدخول أو استخدام معرّف الضيف" },
      { status: 400 }
    );
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { success: false, error: "المعرّف مطلوب" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { label, lat, lng, address_text, description, title, is_default, place_images } = body;

    if (!label || !address_text) {
      return NextResponse.json(
        { success: false, error: "التسمية والعنوان مطلوبان" },
        { status: 400 }
      );
    }

    // Mirror the POST fallback so editing a row always leaves a
    // non-empty `title`.
    const resolvedTitle = (() => {
      if (typeof title === "string" && title.trim().length > 0) return title.trim();
      if (typeof description === "string" && description.trim().length > 0) return description.trim();
      return label;
    })();

    let validImages: string[] | undefined;
    if (Array.isArray(place_images)) {
      validImages = sanitizePlaceImageUrls(place_images, 5);
    }

    if (is_default === true) {
      if (userId) {
        await query(
          "UPDATE addresses SET is_default = false WHERE user_id = $1 AND id <> $2",
          [userId, id]
        );
      } else if (guestKey) {
        await query(
          "UPDATE addresses SET is_default = false WHERE guest_key = $1 AND id <> $2",
          [guestKey, id]
        );
      }
    }

    const scopeFilter = userId
      ? "id = $1 AND user_id = $2"
      : "id = $1 AND guest_key = $2";
    const scopeArg = userId || guestKey;

    const result = await query(
      `UPDATE addresses
       SET label = $3,
           lat = $4,
           lng = $5,
           address_text = $6,
           description = $7,
           title = $8,
           is_default = $9,
           place_images = COALESCE($10::text[], place_images)
       WHERE ${scopeFilter}
       RETURNING id, label, lat, lng, address_text, description, title, is_default, place_images, created_at`,
      [
        id,
        scopeArg,
        label,
        parseFloat(lat) || 0,
        parseFloat(lng) || 0,
        address_text,
        description || null,
        resolvedTitle,
        is_default === true,
        validImages ?? null,
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "العنوان غير موجود" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError("delivery-addresses PUT:", error);
    return NextResponse.json(
      { success: false, error: "فشل تعديل العنوان" },
      { status: 500 }
    );
  }
}

// DELETE /api/v1/delivery-addresses?id=
export async function DELETE(request: NextRequest) {
  const { userId, guestKey } = await ownerFromRequest(request);
  if (!userId && !guestKey) {
    return NextResponse.json(
      { success: false, error: "يجب تسجيل الدخول أو استخدام معرّف الضيف" },
      { status: 400 }
    );
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { success: false, error: "المعرّف مطلوب" },
      { status: 400 }
    );
  }

  try {
    if (userId) {
      await query("DELETE FROM addresses WHERE id = $1 AND user_id = $2", [
        id,
        userId,
      ]);
    } else if (guestKey) {
      await query("DELETE FROM addresses WHERE id = $1 AND guest_key = $2", [
        id,
        guestKey,
      ]);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "فشل حذف العنوان" },
      { status: 500 }
    );
  }
}
