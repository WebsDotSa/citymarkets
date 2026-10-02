import { NextRequest, NextResponse } from "next/server";
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { isValidGuestKey } from '@/lib/identity/address-service';
import { sanitizePlaceImageUrls } from '@/lib/catalog';
import {
  type AddressRow,
  createAddress as createAddressService,
  deleteAddress as deleteAddressService,
  listAddresses as listAddressesService,
  updateAddress as updateAddressService,
} from '@/lib/identity/address-service';

import { error as logError } from "@/lib/logger";

import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";

// SECURITY (PCP-130): rate limit on address creation/deletion. An
// authenticated user could otherwise spam the delivery_addresses
// table (1 INSERT per request) and balloon the row count. 30/hour
// per user, 60/hour per IP — caps legitimate-use while still
// allowing address book cleanups.
const ADDRESS_WRITE_CONFIG = {
  maxRequests: 30,
  windowMs: 60 * 60 * 1000,
  keyPrefix: "address:write",
} as const;

const ADDRESS_WRITE_IP_CONFIG = {
  maxRequests: 60,
  windowMs: 60 * 60 * 1000,
  keyPrefix: "address:write:ip",
} as const;

// SECURITY: place_images validation now mirrors the strict C3 RBAC
// allowlist from `@/lib/place-image`. Previous prefix-only check
// accepted `..`, protocol-relative URLs, and arbitrary schemes —
// kept here for parity with `/api/v1/addresses` so any client that
// can hit the looser route can no longer bypass the stricter one.
//
// P2-3: all four handlers now delegate to the canonical address
// service. The service owns the SQL (user_id vs guest_key scope,
// title fallback, is_default toggle) so the route stays an HTTP
// shaper + auth gate.

type Owner =
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestKey: string };

/**
 * Strip owner-identifying fields from a row before sending it to the
 * client. The address service returns `user_id` and `guest_key` so
 * internal callers can audit, but the delivery-addresses contract
 * never exposed them — keep the response shape consistent.
 *
 * `place_images` is COALESCEd to `[]` here because the service can
 * return NULL when the row was written before the column was added
 * (migration 049). The web client treats `null` as `[]` via
 * rowToAddress on the client side, but the raw JSON shape here stays
 * consistent.
 */
function toClientRow(row: AddressRow): Record<string, unknown> {
  const { user_id: _u, guest_key: _g, ...rest } = row;
  void _u;
  void _g;
  return {
    ...rest,
    place_images: Array.isArray(row.place_images) ? row.place_images : [],
  };
}

async function ownerFromRequest(request: NextRequest): Promise<Owner | null> {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (userId) return { kind: "user", userId };
  // Client-supplied — only whitelisted formats (UUID / guest_<ts>_<rand>)
  // are honoured; anything else is treated as absent (→ 400 below).
  // Hotfix 9580caf: validate the x-guest-key header before letting it
  // reach SQL — without this guard the original code would have
  // emitted a SQL-injection vector into the VALUES clause.
  const rawGuestKey = request.headers.get("x-guest-key");
  const guestKey = isValidGuestKey(rawGuestKey) ? rawGuestKey : null;
  if (guestKey) return { kind: "guest", guestKey };
  return null;
}

// GET /api/v1/delivery-addresses
export async function GET(request: NextRequest) {
  const owner = await ownerFromRequest(request);
  if (!owner) {
    return NextResponse.json(
      { success: false, error: "يجب تسجيل الدخول أو استخدام معرّف الضيف" },
      { status: 400 }
    );
  }

  try {
    const rows = await listAddressesService(owner);
    return NextResponse.json({
      success: true,
      data: rows.map(toClientRow),
    });
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
  const owner = await ownerFromRequest(request);
  if (!owner) {
    return NextResponse.json(
      { success: false, error: "يجب تسجيل الدخول أو استخدام معرّف الضيف" },
      { status: 400 }
    );
  }

  // SECURITY (PCP-130): rate limit writes. IP-first (catches unauth
  // guest floods) then per-owner. The owner key is namespaced by kind
  // so user A and guest G never share a bucket.
  const clientIp = getClientIp(request);
  const ipLimit = await checkRateLimit(clientIp, ADDRESS_WRITE_IP_CONFIG);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "تجاوزت عدد العمليات، حاول لاحقاً" },
      { status: 429 }
    );
  }
  const ownerKey =
    owner.kind === "user" ? `user:${owner.userId}` : `guest:${owner.guestKey}`;
  const userLimit = await checkRateLimit(ownerKey, ADDRESS_WRITE_CONFIG);
  if (!userLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "تجاوزت عدد العمليات، حاول لاحقاً" },
      { status: 429 }
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

    // Validate place_images via the shared allowlist (see SECURITY note
    // at the top of this file). Cap at 5.
    const validImages = sanitizePlaceImageUrls(place_images, 5);

    // P2-3: title fallback (title → description → label) lives in the
    // service as `resolveTitle`. Pass through the explicit values.
    const row = await createAddressService(owner, {
      label,
      title: typeof title === "string" ? title : null,
      description: typeof description === "string" ? description : null,
      lat: Number(lat),
      lng: Number(lng),
      address_text,
      is_default: is_default === true,
      place_images: validImages,
    });

    return NextResponse.json({
      success: true,
      data: toClientRow(row),
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
  const owner = await ownerFromRequest(request);
  if (!owner) {
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

    // P2-3: title fallback is now in the service — pass the explicit
    // values and let `resolveTitle` do the ladder.
    let validImages: string[] | null | undefined;
    if (Array.isArray(place_images)) {
      validImages = sanitizePlaceImageUrls(place_images, 5);
    }

    // Pre-P2-3 the PUT always set is_default = `is_default === true`
    // (a boolean), so an absent `is_default` in the body wrote `false`
    // to the column. Preserve that exact semantics: we always pass a
    // boolean and let the service decide whether to clear-others
    // (only fires when is_default===true).
    const row = await updateAddressService(owner, id, {
      label,
      title: typeof title === "string" ? title : null,
      description: typeof description === "string" ? description : null,
      lat: Number(lat),
      lng: Number(lng),
      address_text,
      is_default: is_default === true,
      place_images: validImages ?? null,
    });

    if (!row) {
      return NextResponse.json(
        { success: false, error: "العنوان غير موجود" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: toClientRow(row) });
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
  const owner = await ownerFromRequest(request);
  if (!owner) {
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
    // Service pins both id AND owner in the WHERE clause, so a guest
    // can never delete a user's row (or vice-versa). Pre-P2-3 the
    // route returned 200 even when rowCount=0; preserve that to keep
    // the response contract.
    await deleteAddressService(owner, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "فشل حذف العنوان" },
      { status: 500 }
    );
  }
}