/**
 * @deprecated 2026-10-04 — kept for iOS APIClient.swift backward
 * compatibility. New client-side flows should POST to
 * `/api/v1/checkout` (see `@/lib/orders/checkout/checkout-service`)
 * which owns the unified parent-order + vendor-order creation flow,
 * idempotency, and the address-priority invariant. Removal tracked
 * under docs/09-IMPLEMENTATION-BACKLOG.md "iOS APIClient migration".
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import {
  getGuestSessionIdFromRequest,
  resolveCustomerUserIdFromRequest,
} from '@/lib/identity';
import { resolveOrderAddress } from '@/lib/identity/address-service';
import { createOrderSchema, validationError } from '@/lib/validation';
import { checkRateLimit, ORDER_CREATE_CONFIG, createRateLimitHeaders } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { isAppleReviewUser } from '@/lib/apple-review';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';
import { reportCheckoutError } from '@/lib/errors/checkout-error-reporter';
import {
  parseSlotsConfig,
  riyadhWallClockToUtc,
  toRiyadhDateKey,
  validateSlotSelection,
} from '@/lib/delivery';
import { evaluateHours } from '@/lib/delivery/delivery-hours';
import { getActiveStoreHours } from '@/lib/delivery/store-hours';
import { resolvePaymentMethod } from '@/lib/payments/payment-methods';
import { ORDER_LIST_COLUMNS } from '@/lib/orders/sql-fragments';
import { getLoyaltySettings } from '@/lib/orders/loyalty';
import { getMainStoreAndDistance } from '@/lib/delivery/main-store';

/**
 * Order item type for internal use
 */
interface OrderItem {
  product_id: string;
  quantity: number;
  price: string | number;
  discount_price: string | number | null;
  stock_qty: string | number;
  name_ar: string;
}

/**
 * Database product row type
 */
interface ProductRow {
  product_id: string;
  price: string | number;
  discount_price: string | number | null;
  stock_qty: string | number;
  name_ar: string;
  is_active: boolean;
}

/**
 * Guest info type for order creation
 */
interface GuestInfo {
  name?: string | null;
  phone?: string | null;
  city?: string | null;
  district?: string | null;
  street?: string | null;
  building_number?: string | null;
  email?: string | null;
  lat?: number;
  lng?: number;
}

function parsePositiveInt(value: unknown): number | null {
  const n = parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export async function GET(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);

  if (!userId) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }

  const client = await pool.connect();

  try {
    // Pagination: cursor-based on (created_at DESC, id DESC) to handle
    // ties when many orders share the same millisecond. The cursor is
    // the `created_at` value of the last item from the previous page;
    // pass it back as `?cursor=<ISO8601>` to fetch the next page.
    // Limit defaults to 20 (the previous hardcoded value) and caps at
    // 100 to bound response size.
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;
    const url = new URL(request.url);
    const limit = Math.min(
      Math.max(parsePositiveInt(url.searchParams.get('limit')) ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const cursorRaw = url.searchParams.get('cursor');
    const cursorDate = cursorRaw ? new Date(cursorRaw) : null;
    if (cursorRaw && (!cursorDate || Number.isNaN(cursorDate.getTime()))) {
      return NextResponse.json(
        { success: false, error: 'cursor غير صالح' },
        { status: 400 },
      );
    }

    // Build the WHERE clause. With a cursor we want strictly older
    // rows (created_at < cursor) to keep descending order stable.
    const params: unknown[] = [userId];
    let whereExtra = '';
    if (cursorDate) {
      params.push(cursorDate.toISOString());
      whereExtra = `AND o.created_at < $${params.length}::timestamptz`;
    }
    params.push(limit);

    const result = await client.query(
      // Audit 2026-09-30 (Finding 6.1): replaced the inline `SELECT o.*`
      // with the canonical ORDER_LIST_COLUMNS fragment so the new
      // scheduled fields and any future cast (e.g. tax::float) flow
      // through here too. Customer addresses don't need the full
      // ORDER_ADDRESS_COLUMNS so we project only `address_text`.
      `SELECT ${ORDER_LIST_COLUMNS},
        a.address_text,
        COALESCE(o.tracking_code, LEFT(o.id::text, 8)) AS order_number,
        COALESCE(
          a.address_text,
          NULLIF(TRIM(CONCAT_WS('، ', o.guest_district, o.guest_street, o.guest_building, o.guest_city)), '')
        ) AS delivery_address,
        COUNT(DISTINCT oi.id)::int AS items_count,
        COALESCE(json_agg(json_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'name_ar', p.name_ar,
          'price', oi.unit_price,
          'quantity', oi.qty,
          'image_url', p.image_url
        )) FILTER (WHERE oi.id IS NOT NULL), '[]'::json) as items
      FROM orders o
      LEFT JOIN addresses a ON o.address_id = a.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN products_unified p ON oi.product_id = p.id
      WHERE o.user_id = $1::uuid
        ${whereExtra}
      GROUP BY o.id, a.address_text
      ORDER BY o.created_at DESC
      LIMIT $${params.length}`,
      params
    );

    const rows = result.rows.map((row) => ({
      ...row,
      total: Number(row.total),
      subtotal: Number(row.subtotal),
      delivery_fee: Number(row.delivery_fee ?? 0),
      discount: Number(row.discount ?? 0),
      items: (() => {
        if (Array.isArray(row.items)) return row.items;
        if (typeof row.items === 'string' && row.items.trim()) {
          try {
            const parsed = JSON.parse(row.items);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        }
        return [];
      })(),
    }));

    // If we filled the page exactly, there may be more — emit a
    // `nextCursor` so the client can continue. Use the created_at of
    // the last row; client passes it back as `?cursor=`.
    const last = rows[rows.length - 1];
    const nextCursor =
      rows.length === limit && last?.created_at
        ? new Date(last.created_at).toISOString()
        : null;

    return NextResponse.json({
      success: true,
      orders: rows,
      data: rows,
      pagination: {
        limit,
        nextCursor,
        hasMore: nextCursor !== null,
      },
    });
  } catch (error) {
    logError('Orders error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST() {
  // DEPRECATED (audit 2026-09-30, item A4):
  // POST /api/v1/orders has been superseded by POST /api/v1/checkout
  // (the unified multi-vendor checkout, backed by CheckoutService).
  // Apple-review sandbox behaviour (the previous
  // `isAppleReviewUser()` short-circuit) now lives in the new
  // checkout route — keep that gate there so the App Store
  // reviewer still gets a synthetic success response.
  return NextResponse.json(
    {
      success: false,
      error: "deprecated",
      message: "POST /api/v1/orders moved to POST /api/v1/checkout",
      replacement: "/api/v1/checkout",
    },
    { status: 410 },
  );
}
