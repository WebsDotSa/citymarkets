// Path-param DELETE for /api/v1/addresses/[id].
//
// Pre-fix (D11): profile-new.tsx called `fetch("/api/v1/addresses/${id}",
// { method: "DELETE" })` but the existing route only accepted
// `?id=` as a query string. The fetch silently no-op'd (or 400'd
// depending on whether the URL included a query), leaving the user
// with an undeletable address.
//
// Today the path-param route handles the call directly. The legacy
// query-param DELETE on `/api/v1/addresses` is kept for backward
// compatibility with iOS APIClient.swift — see
// docs/09-IMPLEMENTATION-BACKLOG.md "P1 — Production completion
// follow-ups (2026-09-29)" for the migration plan.
//
// Auth: `resolveCustomerUserIdFromRequest` (same helper every
// other customer route uses). Ownership: the SQL filter pins both
// `id` AND `user_id` so a customer can never delete another
// customer's row.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from "@/lib/identity";
import { error as logError } from "@/lib/logger";

export async function DELETE(
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
    const result = await query(
      "DELETE FROM addresses WHERE id = $1::uuid AND user_id = $2::uuid RETURNING id",
      [id, userId],
    );
    if (result.rowCount === 0) {
      // Either the row doesn't exist or it belongs to a different
      // user. We don't disclose which — the URL is the same either
      // way and revealing "row exists but isn't yours" would leak
      // address ownership.
      return NextResponse.json(
        { success: false, error: "العنوان غير موجود" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("[api/v1/addresses/[id]] DELETE failed:", error);
    return NextResponse.json(
      { success: false, error: "فشل حذف العنوان" },
      { status: 500 },
    );
  }
}
