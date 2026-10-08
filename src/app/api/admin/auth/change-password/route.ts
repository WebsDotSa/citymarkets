import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyPassword, hashPassword } from '@/lib/password';
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { error as logError } from '@/lib/logger';

// POST /api/admin/auth/change-password
export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request);
  if (gate instanceof NextResponse) return gate;

  try {
    const body = await request.json();
    const { current_password, new_password } = body;
    const plain = typeof new_password === 'string' ? new_password : '';

    if (!current_password || plain.length < 8) {
      return NextResponse.json(
        { success: false, error: 'كلمة المرور الحالية والجديدة (8 أحرف على الأقل) مطلوبة' },
        { status: 400 }
      );
    }

    const result = await query(
      'SELECT id, password_hash FROM admin_users WHERE id = $1 AND is_active = true',
      [gate.admin.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'المستخدم غير موجود' }, { status: 401 });
    }

    const admin = result.rows[0];
    const isValid = await verifyPassword(current_password, admin.password_hash);

    if (!isValid) {
      return NextResponse.json({ success: false, error: 'كلمة المرور الحالية غير صحيحة' }, { status: 401 });
    }

    const newHash = await hashPassword(plain);
    // SECURITY (PCP-128): bump token_version so any existing JWT for this
    // admin becomes invalid. Without this, an attacker who stole the
    // current session keeps their access even after the legitimate
    // owner rotated the password. Migration 027 created the column; the
    // rotation logic is the caller's responsibility.
    await query(
      'UPDATE admin_users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2',
      [newHash, admin.id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logError('Change password error:', error);
    return NextResponse.json({ success: false, error: 'خطأ في الخادم' }, { status: 500 });
  }
}
