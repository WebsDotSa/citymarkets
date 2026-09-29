// POST /api/v1/addresses/[id]/default — set the address as the
// customer's default delivery address.
//
// Pre-fix (D12): profile-new.tsx called
// `fetch("/api/v1/addresses/${id}/default", { method: "POST" })` but
// the route did not exist. The fetch 404'd and the toggle silently
// failed.
//
// Today the route unsets every other default on the customer's rows
// then sets `is_default = true` on the target. The two-step pattern
// (verify ownership → unset other defaults → set this default)
// mirrors `delivery-addresses/route.ts:99-107` so the two surfaces
// stay in sync. The "unset others first" step is critical: marking
// a row default only flips one boolean; without the explicit unset
// the user could end up with two default addresses and the
// checkout / direct-order address picker would pick one
// non-deterministically.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from "@/lib/identity";
import { error as logError } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "غير مصرح" },
      { status: 401 },
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
    // 1. Confirm ownership. Cheaper than running both updates in a
    //    transaction and matches the rowCount pattern used by
    //    /api/v1/addresses DELETE.
    const own = await query(
      "SELECT id FROM addresses WHERE id = $1::uuid AND user_id = $2::uuid",
      [id, userId],
    );
    if (own.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: "العنوان غير موجود" },
        { status: 404 },
      );
    }

    // 2. Unset other defaults. Idempotent: if no rows are currently
    //    default, the UPDATE just touches zero rows.
    await query(
      "UPDATE addresses SET is_default = false WHERE user_id = $1::uuid AND id <> $2::uuid",
      [userId, id],
    );

    // 3. Mark this row as default.
    await query(
      "UPDATE addresses SET is_default = true WHERE id = $1::uuid AND user_id = $2::uuid",
      [id, userId],
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("[api/v1/addresses/[id]/default] POST failed:", error);
    return NextResponse.json(
      { success: false, error: "فشل تحديد العنوان الافتراضي" },
      { status: 500 },
    );
  }
}
