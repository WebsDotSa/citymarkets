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
import { resolveCustomerUserIdFromRequest } from "@/lib/identity";
import { setDefaultAddress as setDefaultAddressService } from "@/lib/identity/address-service";
import { error as logError } from "@/lib/logger";

import { validateUuidOrError } from "@/lib/api/uuid-guard";
import { checkRateLimit } from "@/lib/rate-limit";

// SECURITY (PCP-147): the default-toggle endpoint takes a verified
// user + a 2-step UPDATE (clear-others + set-target), which is more
// expensive than the average write. Cap at 30/hour per user to bound
// the cost of a single misbehaving session spamming the toggle.
const ADDRESS_DEFAULT_CONFIG = {
  maxRequests: 30,
  windowMs: 60 * 60 * 1000,
  keyPrefix: "address:default",
} as const;
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

  // SECURITY (PCP-147): per-user cap on the default-toggle endpoint.
  const userLimit = await checkRateLimit(`user:${userId}`, ADDRESS_DEFAULT_CONFIG);
  if (!userLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "تجاوزت عدد العمليات، حاول لاحقاً" },
      { status: 429 },
    );
  }

  const { id } = await params;
  const badId = validateUuidOrError(id, "معرّف العنوان");
  if (badId) return badId;
  if (!id || typeof id !== "string") {
    return NextResponse.json(
      { success: false, error: "معرّف العنوان مطلوب" },
      { status: 400 },
    );
  }

  try {
    // P2-3: delegate to the address service. The service does ownership
    // check + clear-others + set-target atomically in one transaction.
    // Returning null means the address doesn't exist OR isn't owned
    // by the caller; we surface 404 in both cases so the caller can't
    // distinguish "row doesn't exist" from "not yours" (the latter
    // would leak address ownership).
    const row = await setDefaultAddressService({ kind: "user", userId }, id);
    if (!row) {
      return NextResponse.json(
        { success: false, error: "العنوان غير موجود" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("[api/v1/addresses/[id]/default] POST failed:", error);
    return NextResponse.json(
      { success: false, error: "فشل تحديد العنوان الافتراضي" },
      { status: 500 },
    );
  }
}
