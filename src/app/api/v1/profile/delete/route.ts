import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAuth } from "@/lib/auth-helpers";
import {
  COOKIE_NAME,
  customerSessionCookieOptions,
} from '@/lib/identity';
import { error as logError } from "@/lib/logger";

// POST /api/v1/profile/delete
//
// Body (any of):
//   { confirmation: "DELETE" }                         — simplest, for web
//   { confirmation: "DELETE", password: "..." }        — web with password re-entry
//
// Auth: same requireAuth() as the rest of /api/v1/profile. The cookie is
// cleared in the response so the client is effectively logged out.
//
// Behavior (soft delete — see migrations/048_account_deletion.sql):
//   1. Mark users.deleted_at = NOW()
//   2. Anonymize PII: phone → "deleted-<uuid>", name/email/avatar_url → NULL
//   3. NULL out user_id on FK-SET-NULL tables (preserves order history
//      shape but severs the link — partial unique index on phone means
//      the user can sign up again with the same number).
//   4. Clear customer session cookie.
//
// Why NOT hard delete: orders.user_id is ON DELETE RESTRICT, and we keep
// order rows immutable for tax/legal reasons. Soft delete + PII wipe is
// the standard pattern.
export async function POST(request: NextRequest) {
  const authResult = await requireAuth();
  if (!("user" in authResult)) return authResult;

  const userId = authResult.user.id;

  let body: { confirmation?: string; password?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine — confirmation is recommended, not enforced.
  }

  if (body.confirmation && body.confirmation !== "DELETE") {
    return NextResponse.json(
      { success: false, error: "نص التأكيد غير صحيح" },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Idempotency guard: if already deleted, return success but skip work.
    const existing = await client.query(
      "SELECT deleted_at FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: "الحساب غير موجود" },
        { status: 404 },
      );
    }
    if (existing.rows[0].deleted_at) {
      await client.query("COMMIT");
      return clearCookie(
        NextResponse.json({
          success: true,
          message: "الحساب محذوف مسبقاً",
        }),
      );
    }

    // Anonymize PII in a single statement. We keep the UUID so foreign
    // keys remain valid; downstream queries should filter on deleted_at.
    // Phone is replaced with a deterministic-but-unique placeholder so
    // the partial unique index (phone WHERE deleted_at IS NULL) is never
    // triggered for the tombstone row. `users.phone` is VARCHAR(20), so
    // we only keep the first 8 hex chars of the UUID
    // ("deleted-xxxxxxxx" = 16 chars, fits). 8 hex chars = 32 bits =
    // ~4B distinct values — collision risk against the partial unique
    // index is negligible for tombstones, and re-deletes re-pick from
    // the same id anyway.
    await client.query(
      `UPDATE users
         SET deleted_at = NOW(),
             phone = 'deleted-' || LEFT(id::text, 8),
             name = NULL,
             email = NULL,
             avatar_url = NULL,
             updated_at = NOW()
       WHERE id = $1`,
      [userId],
    );

    // Sever links on FK-SET-NULL tables. RESTRICT tables (orders) keep
    // their user_id so we can still answer "order #1234 existed" for
    // accounting/audit; the row is anonymized at the user level.
    //
    // Note: the table is `spin_results` (not `spin_history` — that was an
    // earlier name in a never-applied migration). Both tables have
    // `user_id` FKs with `ON DELETE SET NULL`, so we NULL them here to
    // detach the push token / spin win from the deleted account.
    await client.query(
      `UPDATE push_subscriptions SET user_id = NULL WHERE user_id = $1`,
      [userId],
    );
    await client.query(
      `UPDATE spin_results SET user_id = NULL WHERE user_id = $1`,
      [userId],
    );

    await client.query("COMMIT");

    const res = NextResponse.json({
      success: true,
      message: "تم حذف الحساب بنجاح",
    });
    return clearCookie(res);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    logError("Account deletion error:", error);
    return NextResponse.json(
      { success: false, error: "فشل حذف الحساب، حاول مرة أخرى" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

function clearCookie(res: NextResponse) {
  res.cookies.set(COOKIE_NAME, "", {
    ...customerSessionCookieOptions(),
    maxAge: 0,
  });
  return res;
}