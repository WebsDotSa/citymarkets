import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdminApi } from '@/lib/identity';
import { couponInputSchema } from '@/lib/validation';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

function idCheck(url: URL) {
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'المعرّف مطلوب' }, { status: 400 });
  return id;
}

function normalizeNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_coupons');
  if (gate instanceof NextResponse) return gate;
  try {
    const result = await query('SELECT id, code, type::text as type, value::float as value, min_order::float as min_order, max_discount::float as max_discount, max_uses, used_count, source::text as source, expires_at, used_at, is_active FROM coupons ORDER BY id DESC');
    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    logError('Coupons fetch error:', error);
    return NextResponse.json({ success: false, error: 'فشل جلب الكوبونات' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_coupons');
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await request.json();
    const parsed = couponInputSchema.safeParse({
      ...body,
      value: normalizeNumeric(body.value),
      min_order: normalizeNumeric(body.min_order),
      max_discount: normalizeNumeric(body.max_discount),
      max_uses: normalizeNumeric(body.max_uses),
    });
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || 'بيانات الكوبون غير صالحة' },
        { status: 400 }
      );
    }
    const { code, type, value, min_order, max_discount, max_uses, source, expires_at, is_active } = parsed.data;
    const result = await query(
      'INSERT INTO coupons (code, type, value, min_order, max_discount, max_uses, source, expires_at, is_active) VALUES ($1, $2::coupon_type_enum, $3, $4, $5, $6, $7::coupon_source_enum, $8, $9) RETURNING id',
      [code, type, value ?? null, min_order ?? null, max_discount ?? null, max_uses ?? null, source, expires_at || null, is_active !== false]
    );
    return NextResponse.json({ success: true, data: { id: result.rows[0].id } });
  } catch (error) {
    logError('Create coupon error:', error);
    return NextResponse.json({ success: false, error: 'فشل إنشاء الكوبون' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_coupons');
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const idCheckResult = idCheck(url);
    if (typeof idCheckResult !== 'string') return idCheckResult;
    const body = await request.json();
    const parsed = couponInputSchema.safeParse({
      ...body,
      value: normalizeNumeric(body.value),
      min_order: normalizeNumeric(body.min_order),
      max_discount: normalizeNumeric(body.max_discount),
      max_uses: normalizeNumeric(body.max_uses),
    });
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || 'بيانات الكوبون غير صالحة' },
        { status: 400 }
      );
    }
    const { code, type, value, min_order, max_discount, max_uses, source, expires_at, is_active } = parsed.data;
    await query(
      `UPDATE coupons SET code = $1, type = $2::coupon_type_enum, value = $3, min_order = $4, max_discount = $5,
              max_uses = $6, source = $7::coupon_source_enum, expires_at = $8, is_active = $9 WHERE id = $10`,
      [code, type, value ?? null, min_order ?? null, max_discount ?? null, max_uses ?? null, source, expires_at || null, is_active !== false, idCheckResult]
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    logError('Update coupon error:', error);
    return NextResponse.json({ success: false, error: 'فشل تحديث الكوبون' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_coupons');
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const idCheckResult = idCheck(url);
    if (typeof idCheckResult !== 'string') return idCheckResult;
    await query('DELETE FROM coupons WHERE id = $1', [idCheckResult]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'فشل حذف الكوبون' }, { status: 500 });
  }
}
