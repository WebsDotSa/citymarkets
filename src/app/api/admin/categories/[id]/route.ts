import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { error as logError } from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminApi(request, 'manage_categories');
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { success: false, error: 'المعرّف مطلوب' },
      { status: 400 }
    );
  }

  try {
    const result = await query(
      `SELECT
         c.id,
         c.name_ar,
         c.name_en,
         c.slug,
         c.parent_id,
         c.sort_order,
         c.is_active,
         c.description_ar,
         c.description_en,
         c.icon_url,
         c.created_at,
         p.name_ar AS parent_name_ar,
         p.slug AS parent_slug
       FROM categories c
       LEFT JOIN categories p ON p.id = c.parent_id
       WHERE c.id = $1
       LIMIT 1`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'الفئة غير موجودة' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError('GET category by id error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل جلب الفئة' },
      { status: 500 }
    );
  }
}