// POST /api/v1/delivery-addresses/[id]/default — set address as default.
//
// Migration 078 (2026-09-30): the path-param default route lived on
// `/api/v1/addresses/[id]/default` (user-only). We mirror it here so
// guest sessions can mark their own address default using the same
// REST URL their user-session counterpart uses.
//
// The address service does ownership check + clear-others + set-target
// atomically in one transaction. Returning null means the address
// doesn't exist OR isn't owned by the caller; we surface 404 in both
// cases so the caller can't distinguish "row doesn't exist" from
// "not yours" (the latter would leak address ownership).

import { NextRequest, NextResponse } from "next/server";
import {
  resolveAddressOwnerFromRequest,
  setDefaultAddress as setDefaultAddressService,
} from "@/lib/identity/address-service";

import { error as logError } from "@/lib/logger";


export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const owner = await resolveAddressOwnerFromRequest(request);
  if (!owner) {
    return NextResponse.json(
      { success: false, error: "يجب تسجيل الدخول أو استخدام معرّف الضيف" },
      { status: 400 },
    );
  }

  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json(
      { success: false, error: "معرّف العنوان مطلوب" },
      { status: 400 },
    );
  }

  try {
    const row = await setDefaultAddressService(owner, id);
    if (!row) {
      return NextResponse.json(
        { success: false, error: "العنوان غير موجود" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("[delivery-addresses/[id]/default] POST failed:", error);
    return NextResponse.json(
      { success: false, error: "فشل تحديد العنوان الافتراضي" },
      { status: 500 },
    );
  }
}
