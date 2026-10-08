import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { clearAdminRoleCache, requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { logAdminAction } from '@/lib/admin-audit';
import { adminStaffCreateSchema, adminStaffUpdateSchema } from '@/lib/validation/admin';
import { normalizeSaudiToE164 } from '@/lib/phone-format';

import { error as logError } from '@/lib/logger';

function forbidden(error: string) {
  return NextResponse.json({ success: false, error }, { status: 403 });
}

// SECURITY: `manage_roles` is held by both `super_admin` and `admin`, so
// the permission alone does not protect the owner account. Only a
// super_admin may create, edit, delete or grant the super_admin role —
// otherwise any `admin` could reset the owner's password and take the
// account over, or delete it to lock the owner out.
async function loadTargetRole(id: string): Promise<string | null> {
  const result = await query('SELECT role::text AS role FROM admin_users WHERE id = $1', [id]);
  return result.rows[0]?.role ?? null;
}

function idCheck(url: URL) {
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'المعرّف مطلوب' }, { status: 400 });
  return id;
}

// GET /api/admin/admin-users
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_roles');
  if (gate instanceof NextResponse) return gate;
  try {
    const result = await query(
      'SELECT id, name, email, role, phone, avatar_url, is_active, last_login_at, created_at FROM admin_users ORDER BY created_at DESC'
    );
    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'فشل جلب الموظفين' }, { status: 500 });
  }
}

// POST /api/admin/admin-users
//
// Phone is REQUIRED (so admins can sign in via phone+OTP), email is
// OPTIONAL. The schema in `adminStaffCreateSchema` enforces both rules
// at the boundary — bad clients get a 400 with a localized message
// instead of a half-inserted row.
export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_roles');
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await request.json();
    const parsed = adminStaffCreateSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { success: false, error: first?.message || 'بيانات غير صالحة' },
        { status: 400 }
      );
    }
    const data = parsed.data;
    if (data.role === 'super_admin' && gate.admin.role !== 'super_admin') {
      return forbidden('فقط المدير العام يمكنه إنشاء حساب مدير عام');
    }
    const phoneE164 = normalizeSaudiToE164(data.phone);
    const passwordHash = await hashPassword(data.password);

    try {
      const result = await query(
        `INSERT INTO admin_users (name, email, password_hash, role, phone, is_active)
         VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6)
         RETURNING id, name, email, role, phone, is_active`,
        [
          data.name,
          data.email ?? '',
          passwordHash,
          data.role || 'admin',
          phoneE164,
          data.is_active !== false,
        ]
      );
      return NextResponse.json({ success: true, data: result.rows[0] });
    } catch (error: any) {
      if (error.code === '23505') {
        // Either the email or phone unique index tripped.
        return NextResponse.json(
          { success: false, error: 'البريد الإلكتروني أو رقم الجوال مستخدم بالفعل' },
          { status: 400 }
        );
      }
      throw error;
    }
  } catch (error: any) {
    logError('Create admin user error:', error);
    return NextResponse.json({ success: false, error: 'فشل إنشاء المستخدم' }, { status: 500 });
  }
}

// PUT /api/admin/admin-users?id=xxx
//
// Same rules as POST: phone required, email optional. `password` is
// optional (empty = leave unchanged) per the existing UX contract.
export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_roles');
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const idCheckResult = idCheck(url);
    if (typeof idCheckResult !== 'string') return idCheckResult;

    const body = await request.json();
    const parsed = adminStaffUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { success: false, error: first?.message || 'بيانات غير صالحة' },
        { status: 400 }
      );
    }
    const data = parsed.data;
    const nextRole = data.role || 'admin';
    const isSuper = gate.admin.role === 'super_admin';

    const targetRole = await loadTargetRole(idCheckResult);
    if (!targetRole) {
      return NextResponse.json({ success: false, error: 'المستخدم غير موجود' }, { status: 404 });
    }
    if (!isSuper && (targetRole === 'super_admin' || nextRole === 'super_admin')) {
      return forbidden('فقط المدير العام يمكنه تعديل حساب مدير عام أو منح هذا الدور');
    }
    // No self-promotion/demotion or self-deactivation (prevents
    // escalation and accidental lockout).
    if (idCheckResult === gate.admin.id && (nextRole !== targetRole || data.is_active === false)) {
      return forbidden('لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك');
    }

    const phoneE164 = normalizeSaudiToE164(data.phone);

    const passwordChanged = Boolean(data.password);
    if (passwordChanged) {
      const passwordHash = await hashPassword(data.password!);
      // SECURITY (PCP-143): bump token_version on every password rotation
      // so any leaked admin JWT stops authenticating immediately. Without
      // this, an attacker with a stolen JWT keeps admin privileges for up
      // to 7 days (the JWT lifetime). The verify path (see
      // admin-api-auth-db.ts) compares the JWT's tv claim against the DB
      // value on every request.
      await query(
        `UPDATE admin_users
            SET name = $1,
                email = NULLIF($2, ''),
                role = $3,
                phone = $4,
                is_active = $5,
                password_hash = $6,
                token_version = COALESCE(token_version, 1) + 1,
                updated_at = NOW()
          WHERE id = $7`,
        [
          data.name,
          data.email ?? '',
          nextRole,
          phoneE164,
          data.is_active !== false,
          passwordHash,
          idCheckResult,
        ]
      );
    } else {
      await query(
        `UPDATE admin_users
            SET name = $1,
                email = NULLIF($2, ''),
                role = $3,
                phone = $4,
                is_active = $5,
                updated_at = NOW()
          WHERE id = $6`,
        [
          data.name,
          data.email ?? '',
          nextRole,
          phoneE164,
          data.is_active !== false,
          idCheckResult,
        ]
      );
    }

    // SECURITY (F6): clearAdminRoleCache busts the 60s in-memory cache
    // so the target admin's role/active changes take effect immediately
    // instead of waiting up to 60s for cache TTL. Without this, a
    // freshly promoted admin could keep their old permissions (or
    // vice versa) for the TTL window.
    clearAdminRoleCache(idCheckResult);

    // Audit log: role changes are security-sensitive and must be traceable.
    await logAdminAction(gate.admin, 'admin_users.update', {
      entityType: 'admin_user',
      entityId: idCheckResult,
      details: {
        name: data.name,
        email: data.email,
        role: data.role,
        is_active: data.is_active,
        passwordChanged,
      },
      request,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logError('Update admin user error:', error);
    return NextResponse.json({ success: false, error: 'فشل حفظ المستخدم' }, { status: 500 });
  }
}

// DELETE /api/admin/admin-users?id=xxx
export async function DELETE(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_roles');
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const idCheckResult = idCheck(url);
    if (typeof idCheckResult !== 'string') return idCheckResult;

    // SECURITY (F6): prevent self-delete to avoid accidental lockout
    // and to ensure an admin can't delete their own account as a way
    // to evade audit trails.
    if (idCheckResult === gate.admin.id) {
      return NextResponse.json(
        { success: false, error: 'لا يمكنك حذف حسابك الخاص' },
        { status: 400 }
      );
    }

    const targetRole = await loadTargetRole(idCheckResult);
    if (targetRole === 'super_admin' && gate.admin.role !== 'super_admin') {
      return forbidden('فقط المدير العام يمكنه حذف حساب مدير عام');
    }

    await query('DELETE FROM admin_users WHERE id = $1', [idCheckResult]);

    // SECURITY (F6): same cache invalidation as PUT — the deleted admin
    // should not retain any cached role/active privileges.
    clearAdminRoleCache(idCheckResult);

    await logAdminAction(gate.admin, 'admin_users.delete', {
      entityType: 'admin_user',
      entityId: idCheckResult,
      request,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logError('Delete admin user error:', error);
    return NextResponse.json({ success: false, error: 'فشل حذف المستخدم' }, { status: 500 });
  }
}
