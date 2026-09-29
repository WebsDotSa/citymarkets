import { NextResponse } from "next/server";
import {
  ROLE_PERMISSIONS,
  type AdminRole,
} from "@/lib/admin-types";

/**
 * Pure helpers (no DB / no JWT). Re-exported from the `@/lib/identity`
 * barrel. The DB-backed guard `requireAdminApi` lives in
 * `admin-api-auth-db.ts` so that client components can still pull
 * lightweight helpers like `adminUnauthorized` / `adminForbidden`
 * without dragging pg into the edge bundle.
 */

export function adminUnauthorized(): NextResponse {
  return NextResponse.json(
    { success: false, error: "يجب تسجيل الدخول" },
    { status: 401 },
  );
}

export function adminForbidden(): NextResponse {
  return NextResponse.json(
    { success: false, error: "ليست لديك صلاحية لهذا الإجراء" },
    { status: 403 },
  );
}

export function adminHasPermission(role: AdminRole, permission: string): boolean {
  const list = ROLE_PERMISSIONS[role];
  return Array.isArray(list) && list.includes(permission);
}
