import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { error as logError } from '@/lib/logger';

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminApi(request, 'manage_products');
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  if (!UUID_LIKE.test(id)) {
    return NextResponse.json(
      { success: false, error: 'المنتج غير موجود' },
      { status: 404 }
    );
  }

  try {
    const result = await query(
      `SELECT p.id, p.category_id, p.name_ar, p.name_en, p.barcode, p.description,
              p.price::float as price, p.discount_price::float as discount_price,
              p.stock_qty, p.unit, p.is_featured, p.is_active, p.image_url,
              COALESCE(p.images, '{}') as images,
              p.created_at, p.updated_at,
              c.name_ar as category_name, c.slug as category_slug
       FROM products_unified p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = $1
       LIMIT 1`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المنتج غير موجود' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError('GET product by id error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل جلب المنتج' },
      { status: 500 }
    );
  }
}