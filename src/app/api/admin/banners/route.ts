import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { query } from '@/lib/db';
import { requireAdminApi } from '@/lib/admin-api-auth';
import { bannerInputSchema } from '@/lib/validation';

function idCheck(url: URL) {
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'المعرّف مطلوب' }, { status: 400 });
  return id;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_banners');
  if (gate instanceof NextResponse) return gate;
  try {
    const result = await query('SELECT id, image_url, link_type, link_value, active, sort_order, created_at FROM banners ORDER BY sort_order ASC');
    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'فشل جلب البانرات' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_banners');
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await request.json();
    const parsed = bannerInputSchema.safeParse({
      ...body,
      sort_order: body.sort_order !== undefined ? Number(body.sort_order) : undefined,
    });
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || 'بيانات البانر غير صالحة' },
        { status: 400 }
      );
    }
    const { image_url, link_type, link_value, active, sort_order } = parsed.data;
    const result = await query(
      'INSERT INTO banners (image_url, link_type, link_value, active, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [image_url, link_type, link_value || null, active !== false, sort_order ?? 0]
    );
    return NextResponse.json({ success: true, data: { id: result.rows[0].id } });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'فشل إنشاء البانر' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_banners');
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const idCheckResult = idCheck(url);
    if (typeof idCheckResult !== 'string') return idCheckResult;
    const body = await request.json();
    const parsed = bannerInputSchema.safeParse({
      ...body,
      sort_order: body.sort_order !== undefined ? Number(body.sort_order) : undefined,
    });
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || 'بيانات البانر غير صالحة' },
        { status: 400 }
      );
    }
    const { image_url, link_type, link_value, active, sort_order } = parsed.data;
    await query('UPDATE banners SET image_url = $1, link_type = $2, link_value = $3, active = $4, sort_order = $5 WHERE id = $6',
      [image_url, link_type, link_value || null, active !== false, sort_order ?? 0, idCheckResult]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'فشل تحديث البانر' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_banners');
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const idCheckResult = idCheck(url);
    if (typeof idCheckResult !== 'string') return idCheckResult;

    // Delete image file if local
    const bannerResult = await query('SELECT image_url FROM banners WHERE id = $1', [idCheckResult]);
    if (bannerResult.rows.length > 0 && bannerResult.rows[0].image_url?.startsWith('/images/')) {
      const filename = path.basename(bannerResult.rows[0].image_url);
      const imgPath = path.join(process.cwd(), 'public', 'images', filename);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }

    await query('DELETE FROM banners WHERE id = $1', [idCheckResult]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'فشل حذف البانر' }, { status: 500 });
  }
}
