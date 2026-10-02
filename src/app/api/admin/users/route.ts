import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { adminUserInputSchema as userInputSchema } from '@/lib/validation';
import { parsePagination } from "@/lib/api/pagination";

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
  try {
    const url = new URL(request.url);
    const idCheckResult = idCheck(url);
    if (typeof idCheckResult !== 'string') return idCheckResult;
    await query('DELETE FROM users WHERE id = $1', [idCheckResult]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'فشل حذف المستخدم' }, { status: 500 });
  }
}
