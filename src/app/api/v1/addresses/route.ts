import { NextRequest, NextResponse } from 'next/server';
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { sanitizePlaceImageUrls } from '@/lib/catalog';
import {
  createAddress as createAddressService,
  deleteAddress as deleteAddressService,
  listAddresses as listAddressesService,
} from '@/lib/identity/address-service';

import { error as logError } from '@/lib/logger';

import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';

// SECURITY (PCP-146): mirror the `/api/v1/delivery-addresses` write
// caps (PCP-130). Without these, an authenticated user could spam
// the addresses table (1 INSERT per request) and balloon row counts
// at no cost. 30/hour per user, 60/hour per IP — generous enough
// for legitimate address-book edits while still capping abuse.
const LEGACY_ADDRESS_WRITE_CONFIG = {
  maxRequests: 30,
  windowMs: 60 * 60 * 1000,
  keyPrefix: 'address:legacy:write',
} as const;

const LEGACY_ADDRESS_WRITE_IP_CONFIG = {
  maxRequests: 60,
  windowMs: 60 * 60 * 1000,
  keyPrefix: 'address:legacy:write:ip',
} as const;

// SECURITY (C3 RBAC): strict allowlist for place_images URLs is
// centralised in `@/lib/place-image`. The route sanitises input
// BEFORE handing off to the address service — the service does not
// re-validate (the URL allowlist is HTTP-layer concern, not a DB
// concern).

// DEPRECATION: Migration 078 (2026-09-30). `/api/v1/addresses` is the
// legacy user-only address surface. The canonical replacement is
// `/api/v1/delivery-addresses`, which supports BOTH user sessions AND
// guest sessions (`x-guest-key` header) and ships path-param variants
// for PUT/DELETE/default under `/api/v1/delivery-addresses/[id]/...`.
//
// The route is kept alive for backward-compat with the iOS APIClient
// (see `src/app/vendor/[slug]/admin/settings/page.tsx:343` and the iOS
// release notes). Every response here now carries an
// `X-API-Deprecated` header so a client owner can grep their logs and
// migrate at their own pace. No removal date is set yet — the iOS app
// is the gate.
function deprecationHeaders(): HeadersInit {
  // ASCII-only: HTTP header values must be ByteString (0..255). Em-dash
  // (—) breaks NextResponse.json with "character at index N has a value
  // greater than 255". Use plain dash.
  return {
    'X-API-Deprecated':
      'use /api/v1/delivery-addresses - supports user + guest sessions',
  };
}

// GET /api/v1/addresses - Get customer addresses (LEGACY → /delivery-addresses)
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
    return NextResponse.json(
      { success: true, data: rows },
      { headers: deprecationHeaders() },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'فشل جلب العناوين' },
      { status: 500, headers: deprecationHeaders() }
    );
  }
}

// POST /api/v1/addresses - Create address (LEGACY → /delivery-addresses)
export async function POST(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح' },
      { status: 401, headers: deprecationHeaders() }
    );
  }

  // SECURITY (PCP-146): rate limit writes. IP-first then per-user,
  // matching the delivery-addresses canonical (PCP-130).
  const clientIp = getClientIp(request);
  const ipLimit = await checkRateLimit(clientIp, LEGACY_ADDRESS_WRITE_IP_CONFIG);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { success: false, error: 'تجاوزت عدد العمليات، حاول لاحقاً' },
      { status: 429, headers: deprecationHeaders() }
    );
  }
  const userLimit = await checkRateLimit(`user:${userId}`, LEGACY_ADDRESS_WRITE_CONFIG);
  if (!userLimit.allowed) {
    return NextResponse.json(
      { success: false, error: 'تجاوزت عدد العمليات، حاول لاحقاً' },
      { status: 429, headers: deprecationHeaders() }
    );
  }

  try {
    const body = await request.json();
    const { label, lat, lng, address_text, description, title, is_default, place_images } = body;

    if (!label || lat == null || lng == null) {
      return NextResponse.json(
        { success: false, error: 'بيانات العنوان غير مكتملة' },
        { status: 400, headers: deprecationHeaders() }
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
    return NextResponse.json(
      {
        success: true,
        data: row,
        address,
        deliveryAddress: address,
        customerAddress: address,
        addressId: row.id,
        address_id: row.id,
        deliveryAddressId: row.id,
      },
      { headers: deprecationHeaders() },
    );
  } catch (error: any) {
    logError('Create address error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل حفظ العنوان: ' + (error?.message || 'خطأ غير معروف') },
      { status: 500, headers: deprecationHeaders() }
    );
  }
}

// DELETE /api/v1/addresses - Delete address (LEGACY → /delivery-addresses/[id])
export async function DELETE(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح' },
      { status: 401, headers: deprecationHeaders() }
    );
  }

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'معرّف العنوان مطلوب' },
        { status: 400, headers: deprecationHeaders() }
      );
    }

    // P2-3: delete delegated to the service. The service's WHERE
    // clause pins ownership (user_id = $1::uuid) so a caller can't
    // delete another user's address by passing its id.
    await deleteAddressService({ kind: 'user', userId }, id);

    return NextResponse.json(
      { success: true },
      { headers: deprecationHeaders() },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'فشل حذف العنوان' },
      { status: 500, headers: deprecationHeaders() }
    );
  }
}
