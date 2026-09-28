import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { resolveCustomerUserIdFromRequest } from '@/lib/customer-session';
import { sanitizePlaceImageUrls } from '@/lib/place-image';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

// SECURITY (C3 RBAC): strict allowlist for place_images URLs is
// centralised in `@/lib/place-image`. Do NOT inline a weaker copy here —
// the C3 fix rejected path traversal (`..`), protocol-relative URLs
// (`//evil.com`), arbitrary schemes (`javascript:`, `data:`, `file:`),
// and non-image file extensions.

// GET /api/v1/addresses - Get customer addresses
export async function GET(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح' },
      { status: 401 }
    );
  }

  try {
    const result = await query(
      `SELECT id, label, description, title, lat, lng, address_text, is_default,
              COALESCE(place_images, '{}') AS place_images, created_at
       FROM addresses
       WHERE user_id = $1::uuid
       ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );
    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'فشل جلب العناوين' },
      { status: 500 }
    );
  }
}

// POST /api/v1/addresses - Create address
export async function POST(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { label, lat, lng, address_text, description, title, is_default, place_images } = body;

    // Title is the user-facing display label (e.g. "المنزل"). Required
    // from clients since migration 049 added NOT NULL. Fall back to
    // description, then label, so older web/iOS clients don't break.
    const resolvedTitle = (() => {
      if (typeof title === 'string' && title.trim().length > 0) return title.trim();
      if (typeof description === 'string' && description.trim().length > 0) return description.trim();
      return typeof label === 'string' && label.trim().length > 0 ? label.trim() : null;
    })();

    if (!label || lat == null || lng == null || !resolvedTitle) {
      return NextResponse.json(
        { success: false, error: 'بيانات العنوان غير مكتملة' },
        { status: 400 }
      );
    }

    // Validate place_images: must be an array of valid image URLs (max 5).
    // The strict allowlist (in `@/lib/place-image`) prevents arbitrary
    // or path-traversal URLs from being persisted.
    const validImages = sanitizePlaceImageUrls(place_images, 5);

    // If marked default, unset other defaults
    if (is_default) {
      await query('UPDATE addresses SET is_default = false WHERE user_id = $1::uuid', [userId]);
    }

    const result = await query(
      `INSERT INTO addresses (user_id, label, description, title, lat, lng, address_text, is_default, place_images)
       VALUES ($1::uuid, $2, $3, $4, $5::float8, $6::float8, $7, $8, $9::text[])
       RETURNING id, label, description, title, lat, lng, address_text, is_default, place_images, created_at`,
      [userId, label, description || null, resolvedTitle, lat, lng, address_text || null, !!is_default, validImages]
    );

    const row = result.rows[0];
    // Provide multiple aliases so different clients (web + iOS) can
    // consume the response without a contract change. The iOS app
    // (APIClient.swift) accepts `address` / `deliveryAddress` /
    // `customerAddress` objects, OR a bare `id` / `addressId` /
    // `address_id` / `deliveryAddressId` scalar. Web still reads `data`.
    const address = {
      id: row.id,
      label: row.label,
      title: row.title,
      description: row.description,
      lat: row.lat,
      lng: row.lng,
      addressText: row.address_text,
      isDefault: row.is_default,
      placeImages: row.place_images,
      createdAt: row.created_at,
    };
    return NextResponse.json({
      success: true,
      data: row,
      address,
      deliveryAddress: address,
      customerAddress: address,
      addressId: row.id,
      address_id: row.id,
      deliveryAddressId: row.id,
    });
  } catch (error: any) {
    logError('Create address error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل حفظ العنوان: ' + (error?.message || 'خطأ غير معروف') },
      { status: 500 }
    );
  }
}

// DELETE /api/v1/addresses - Delete address
export async function DELETE(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح' },
      { status: 401 }
    );
  }

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'معرّف العنوان مطلوب' },
        { status: 400 }
      );
    }

    await query(
      'DELETE FROM addresses WHERE id = $1::uuid AND user_id = $2::uuid',
      [id, userId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'فشل حذف العنوان' },
      { status: 500 }
    );
  }
}
