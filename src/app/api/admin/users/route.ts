import { NextRequest, NextResponse } from 'next/server';
import { pool, query } from '@/lib/db';
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { adminUserInputSchema as userInputSchema } from '@/lib/validation';
import { parsePagination } from "@/lib/api/pagination";
import { logAdminAction } from '@/lib/admin-audit';
import { error as logError } from '@/lib/logger';

function idCheck(url: URL) {
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'المعرّف مطلوب' }, { status: 400 });
  return id;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_users');
  if (gate instanceof NextResponse) return gate;
  try {
    // P2-10 (PCP-101 audit): LIMIT + offset pagination — the previous
    // "SELECT all users" response was 4.17 MB / 19,922 rows and froze
    // the admin Users page on useMemo. Same pattern as /api/admin/vendors
    // + /api/admin/products (per skill 'Pagination OOM' lesson).
    // PCP-118: use the centralised parsePagination helper for consistent
    // clamp + edge-case handling across every list endpoint.
    const url = new URL(request.url);
    const { limit, page, offset } = parsePagination(url.searchParams, {
      defaultLimit: 25,
    });

    const [rows, countRows] = await Promise.all([
      query(
        `SELECT id, phone, name, email, loyalty_points, loyalty_tier,
                spin_count_today, created_at
           FROM users
          ORDER BY created_at DESC
          LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      query<{ total: string }>(`SELECT COUNT(*)::int AS total FROM users`),
    ]);
    const total = Number(countRows.rows[0]?.total ?? 0);
    return NextResponse.json({
      success: true,
      data: rows.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'فشل جلب المستخدمين' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_users');
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await request.json();
    const parsed = userInputSchema.safeParse({
      ...body,
      loyalty_points: body.loyalty_points !== undefined ? Number(body.loyalty_points) : undefined,
    });
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || 'بيانات المستخدم غير صالحة' },
        { status: 400 }
      );
    }
    const { phone, name, email, loyalty_points, loyalty_tier } = parsed.data;
    const result = await query(
      'INSERT INTO users (phone, name, email, loyalty_points, loyalty_tier) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [phone, name || null, email || null, loyalty_points ?? 0, loyalty_tier || 'bronze']
    );
    return NextResponse.json({ success: true, data: { id: result.rows[0].id } });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'فشل إنشاء المستخدم' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_users');
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const idCheckResult = idCheck(url);
    if (typeof idCheckResult !== 'string') return idCheckResult;
    const body = await request.json();
    const parsed = userInputSchema.safeParse({
      ...body,
      loyalty_points: body.loyalty_points !== undefined ? Number(body.loyalty_points) : undefined,
    });
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || 'بيانات المستخدم غير صالحة' },
        { status: 400 }
      );
    }
    const { phone, name, email, loyalty_points, loyalty_tier } = parsed.data;
    await query('UPDATE users SET phone = $1, name = $2, email = $3, loyalty_points = $4, loyalty_tier = $5 WHERE id = $6',
      [phone, name || null, email || null, loyalty_points ?? 0, loyalty_tier || 'bronze', idCheckResult]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'فشل تحديث المستخدم' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_users');
  if (gate instanceof NextResponse) return gate;
  const admin = gate.admin;

  const url = new URL(request.url);
  const idCheckResult = idCheck(url);
  if (typeof idCheckResult !== 'string') return idCheckResult;
  const userId = idCheckResult;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the row first so a concurrent customer soft-delete or admin
    // re-delete cannot race us. Also confirms the user exists.
    const existing = await client.query<{
      deleted_at: string | null;
      phone: string;
      has_orders: string;
    }>(
      `SELECT u.deleted_at,
              u.phone,
              EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id) AS has_orders
         FROM users u
        WHERE u.id = $1
        FOR UPDATE OF u`,
      [userId],
    );
    if (existing.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود' },
        { status: 404 },
      );
    }
    const row = existing.rows[0];
    if (row.deleted_at) {
      // Idempotent: already soft-deleted, return success without re-touching
      // PII (preserves the original deletion timestamp for audit).
      await client.query('COMMIT');
      return NextResponse.json({
        success: true,
        message: 'المستخدم محذوف مسبقاً',
        already_deleted: true,
      });
    }

    // PCP-134: soft-delete + PII anonymize (mirrors
    // src/app/api/v1/profile/delete/route.ts). Hard delete is unsafe because
    //   - orders.user_id is ON DELETE RESTRICT (intentional, for legal/tax)
    //   - refund_requests.requested_by_user_id is ON DELETE SET NULL
    //   - payment_events.related_order_id points at orders (which still own
    //     the user_id FK)
    // so any user with even one historical order throws an FK violation
    // and the admin sees a 500 with the raw PG error in app logs.
    //
    // Phone is replaced with a unique placeholder so the partial unique
    // index uniq_users_phone_active (phone WHERE deleted_at IS NULL) does
    // not collide if a new user signs up with the same number. Email is
    // NULLed out — auth_login by email will not match, matching the
    // customer-side behaviour.
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

    // Detach FK-SET-NULL links so push tokens / spin wins do not continue
    // attributing activity to the deleted account.
    await client.query(
      `UPDATE push_subscriptions SET user_id = NULL WHERE user_id = $1`,
      [userId],
    );
    await client.query(
      `UPDATE spin_results SET user_id = NULL WHERE user_id = $1`,
      [userId],
    );

    await client.query('COMMIT');

    // Audit log OUTSIDE the transaction so a failed log write cannot roll
    // back the actual deletion. logAdminAction swallows its own errors
    // (see src/lib/admin-audit.ts).
    void logAdminAction(admin, 'user.soft_delete', {
      entityType: 'user',
      entityId: userId,
      details: { had_orders: row.has_orders === 't' },
      request,
    });

    return NextResponse.json({
      success: true,
      message: 'تم حذف المستخدم بنجاح',
      had_orders: row.has_orders === 't',
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logError('admin user soft-delete failed:', error);
    return NextResponse.json(
      { success: false, error: 'فشل حذف المستخدم' },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
