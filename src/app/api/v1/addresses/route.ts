import { NextRequest, NextResponse } from 'next/server';
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { sanitizePlaceImageUrls } from '@/lib/catalog';
import {
  createAddress as createAddressService,
  deleteAddress as deleteAddressService,
  listAddresses as listAddressesService,
} from '@/lib/identity/address-service';

import { error as logError } from '@/lib/logger';

// SECURITY (C3 RBAC): strict allowlist for place_images URLs is
// centralised in `@/lib/place-image`. The route sanitises input
// BEFORE handing off to the address service — the service does not
// re-validate (the URL allowlist is HTTP-layer concern, not a DB
// concern).

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
    // P2-3 (production hardening 2): list delegated to the address
    // service so the SELECT statement, ORDER BY, and COALESCE for
    // place_images live in one place.
    const rows = await listAddressesService({ kind: 'user', userId });
    return NextResponse.json({ success: true, data: rows });
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

    if (!label || lat == null || lng == null) {
      return NextResponse.json(
        { success: false, error: 'بيانات العنوان غير مكتملة' },
        { status: 400 }
      );
    }

    // Validate place_images: must be an array of valid image URLs (max 5).
    const validImages = sanitizePlaceImageUrls(place_images, 5);

    // P2-3: insert delegated to the service. The service handles
    // title fallback + is_default toggling atomically. If is_default
    // is true (or this is the user's first address), the service
    // clears the flag on the user's other rows first.
    const row = await createAddressService(
      { kind: 'user', userId },
      {
        label,
        title: typeof title === 'string' ? title : null,
        description: typeof description === 'string' ? description : null,
        lat: Number(lat),
        lng: Number(lng),
        address_text: typeof address_text === 'string' ? address_text : null,
        is_default: !!is_default,
        place_images: validImages,
      },
    );

    // Provide multiple aliases so different clients (web + iOS) can
    // consume the response without a contract change. The iOS app
    // accepts `address` / `deliveryAddress` / `customerAddress`
    // objects, OR a bare `id` / `addressId` / `address_id` /
    // `deliveryAddressId` scalar. Web still reads `data`.
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

    // P2-3: delete delegated to the service. The service's WHERE
    // clause pins ownership (user_id = $1::uuid) so a caller can't
    // delete another user's address by passing its id.
    await deleteAddressService({ kind: 'user', userId }, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'فشل حذف العنوان' },
      { status: 500 }
    );
  }
}
