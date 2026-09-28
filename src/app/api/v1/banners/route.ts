import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// GET /api/v1/banners - Get active banners for homepage
export async function GET() {
  try {
    const result = await query(
      `SELECT id, image_url, link_type, link_value, sort_order 
       FROM banners 
       WHERE active = true 
       ORDER BY sort_order ASC`
    );

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    logError('Error fetching banners:', error);
    return NextResponse.json({
      success: true,
      data: [{
        id: 'fallback-banner',
        image_url: '/images/banners/banner_1.jpg',
        link_type: 'none',
        link_value: null,
        sort_order: 0,
      }],
    });
  }
}
