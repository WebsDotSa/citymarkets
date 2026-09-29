import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/identity';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

// GET /api/v1/profile - Get customer profile
export async function GET(request: NextRequest) {
  const authResult = await requireAuth();
  if (!('user' in authResult)) return authResult;
  
  const userId = authResult.user.id;
  
  try {
    const result = await query(
      'SELECT id, phone, name, email, avatar_url, loyalty_points, loyalty_tier, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'العميل غير موجود' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError('Profile fetch error:', error);
    return NextResponse.json({ success: false, error: 'فشل جلب البيانات' }, { status: 500 });
  }
}

// PUT /api/v1/profile - Update customer profile
//
// Only updates fields the client actually sent. The legacy implementation
// destructured `phone` and `avatar_url` from the body unconditionally and
// wrote them — when the form sent only `{name, email}` the missing
// `phone` became `null`, but `users.phone` is `NOT NULL`, so every save
// failed with a constraint violation. Phone changes must go through the
// OTP flow at `/profile/security`, so we now skip `phone` entirely here.
export async function PUT(request: NextRequest) {
  const authResult = await requireAuth();
  if (!('user' in authResult)) return authResult;

  const userId = authResult.user.id;

  try {
    const body = await request.json();

    const sets: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (typeof body.name === 'string') {
      sets.push(`name = $${n++}`);
      vals.push(body.name.trim() || null);
    }
    if (typeof body.email === 'string') {
      sets.push(`email = $${n++}`);
      vals.push(body.email.trim() || null);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'avatar_url')) {
      // avatar_url is nullable, so explicit null is a valid clear.
      sets.push(`avatar_url = $${n++}`);
      vals.push(body.avatar_url ?? null);
    }

    if (sets.length === 0) {
      return NextResponse.json(
        { success: false, error: 'لا توجد حقول للتحديث' },
        { status: 400 },
      );
    }

    sets.push('updated_at = NOW()');
    vals.push(userId);

    await query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${n}`,
      vals,
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logError('Profile update error:', error);
    return NextResponse.json({ success: false, error: 'فشل تحديث البيانات' }, { status: 500 });
  }
}
