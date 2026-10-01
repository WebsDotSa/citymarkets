import { NextResponse } from "next/server";

/**
 * Read the required `?id=` search param used by the admin collection routes
 * (PUT/DELETE `/api/admin/<resource>?id=...`). Returns the id, or the
 * standard 400 response to return as-is. Replaces eight identical local
 * `idCheck()` helpers; the response body is unchanged.
 */
export function requireIdParam(url: URL): string | NextResponse {
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { success: false, error: "المعرّف مطلوب" },
      { status: 400 },
    );
  }
  return id;
}
