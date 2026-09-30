// Path-param PUT/DELETE for /api/v1/delivery-addresses/[id].
//
// Migration 078 (2026-09-30): `delivery-addresses` is the canonical
// address API. Previously the path-param variants (PUT/DELETE) only
// existed on `/api/v1/addresses` (user-only), which left guest sessions
// with a query-string-only DELETE workaround. We mirror the path-param
// contract here so both users AND guests can use REST-style URLs.
//
// Auth & ownership: the underlying address service pins BOTH `id` AND
// `owner` in the WHERE clause, so a guest can never touch a user's
// row (or vice-versa) regardless of how the id was guessed.

import { NextRequest, NextResponse } from "next/server";
import { resolveCustomerUserIdFromRequest } from "@/lib/identity";
import {
  type AddressRow,
  deleteAddress as deleteAddressService,
  updateAddress as updateAddressService,
} from "@/lib/identity/address-service";
import { sanitizePlaceImageUrls } from "@/lib/catalog";

import { error as logError } from "@/lib/logger";

type Owner =
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestKey: string };

async function ownerFromRequest(request: NextRequest): Promise<Owner | null> {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (userId) return { kind: "user", userId };
  const guestKey = request.headers.get("x-guest-key");
  if (guestKey) return { kind: "guest", guestKey };
  return null;
}

function toClientRow(row: AddressRow): Record<string, unknown> {
  const { user_id: _u, guest_key: _g, ...rest } = row;
  void _u;
  void _g;
  return {
    ...rest,
    place_images: Array.isArray(row.place_images) ? row.place_images : [],
  };
}

// PUT /api/v1/delivery-addresses/[id] — edit an existing address
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const owner = await ownerFromRequest(request);
  if (!owner) {
    return NextResponse.json(
      { success: false, error: "يجب تسجيل الدخول أو استخدام معرّف الضيف" },
      { status: 400 },
    );
  }

  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json(
      { success: false, error: "المعرّف مطلوب" },
      { status: 400 },
    );
  }

  try {
    const body = await request.json();
    const { label, lat, lng, address_text, description, title, is_default, place_images } = body;

    if (!label || !address_text) {
      return NextResponse.json(
        { success: false, error: "التسمية والعنوان مطلوبان" },
        { status: 400 },
      );
    }

    let validImages: string[] | null | undefined;
    if (Array.isArray(place_images)) {
      validImages = sanitizePlaceImageUrls(place_images, 5);
    }

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
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: toClientRow(row) });
  } catch (error) {
    logError("[delivery-addresses/[id]] PUT failed:", error);
    return NextResponse.json(
      { success: false, error: "فشل تعديل العنوان" },
      { status: 500 },
    );
  }
}

// DELETE /api/v1/delivery-addresses/[id] — delete an address
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const owner = await ownerFromRequest(request);
  if (!owner) {
    return NextResponse.json(
      { success: false, error: "يجب تسجيل الدخول أو استخدام معرّف الضيف" },
      { status: 400 },
    );
  }

  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json(
      { success: false, error: "المعرّف مطلوب" },
      { status: 400 },
    );
  }

  try {
    await deleteAddressService(owner, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("[delivery-addresses/[id]] DELETE failed:", error);
    return NextResponse.json(
      { success: false, error: "فشل حذف العنوان" },
      { status: 500 },
    );
  }
}
