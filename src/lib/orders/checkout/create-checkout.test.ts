import { describe, it, expect, beforeEach } from 'vitest';
import { createCheckout } from './create-checkout';
import type { PoolClient } from 'pg';
import { CITY_MARKETS_VENDOR_ID } from '@/lib/types';
import type { DeliveryAddressRow } from './resolve-address';

type QueryCall = { sql: string; params: unknown[] };

/**
 * Test-only PoolClient that records every query and returns canned rows
 * depending on the SQL fragment. Far cheaper than spinning up Postgres
 * for unit tests of the orchestrator; resolve-items / pricing / etc.
 * are tested independently.
 */
class FakeClient {
  public queries: QueryCall[] = [];
  private nextId = 0;
  private mode: 'happy' | 'replay' | 'productMissing' | 'stockShort' | 'vendorInactive' = 'happy';

  setMode(m: typeof this.mode) {
    this.mode = m;
    this.queries = [];
    this.nextId = 0;
  }

  async query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    this.queries.push({ sql, params });
    const norm = sql.trim().toUpperCase();

    // -- Idempotency replay check (parent) --
    if (norm.startsWith('SELECT ID, PAYMENT_METHOD, CATALOG_SUBTOTAL, TOTAL') && this.mode === 'replay') {
      return {
        rows: [
          {
            id: 'order-original-parent-id',
            payment_method: 'cash',
            catalog_subtotal: '120.00',
            total: '135.00',
          },
        ],
      };
    }
    if (norm.startsWith('SELECT ID, PAYMENT_METHOD, CATALOG_SUBTOTAL, TOTAL') && this.mode !== 'replay') {
      return { rows: [] };
    }

    // -- Idempotency replay: children --
    if (norm.startsWith('SELECT ID FROM VENDOR_ORDERS WHERE PARENT_ORDER_ID')) {
      return {
        rows: [
          { id: 'vo-existing-a' },
          { id: 'vo-existing-b' },
        ],
      };
    }

    // -- resolve-items: catalog SELECT (products_unified) --
    if (norm.includes('FROM PRODUCTS_UNIFIED')) {
      if (this.mode === 'productMissing') return { rows: [] };
      return {
        rows: [
          {
            id: '00000000-0000-0000-0000-000000000a01',
            name_ar: 'حليب طازج',
            price: '10.00',
            discount_price: '8.00',
            stock_qty: 100,
            track_stock: true,
            image_url: 'https://cdn.example/milk.jpg',
            vendor_id: CITY_MARKETS_VENDOR_ID,
          },
        ],
      };
    }

    // -- resolve-items: vendor SELECT FOR UPDATE on `vendors` --
    if (/FROM\s+VENDORS(\s|$)/.test(norm) && norm.includes('FOR UPDATE')) {
      if (this.mode === 'vendorInactive') {
        return {
          rows: [
            {
              id: params[0],
              slug: 'qahwa-amaze',
              name_ar: 'قهوة اعجوبة',
              is_active: false,
              min_order_amount: 0,
            },
          ],
        };
      }
      return {
        rows: [
          {
            id: params[0],
            slug: 'qahwa-amaze',
            name_ar: 'قهوة اعجوبة',
            is_active: true,
            min_order_amount: 0,
          },
        ],
      };
    }

    // -- resolve-items: vendor_products SELECT FOR UPDATE --
    if (norm.includes('FROM VENDOR_PRODUCTS') && norm.includes('FOR UPDATE')) {
      if (this.mode === 'stockShort') {
        return {
          rows: [
            {
              id: '00000000-0000-0000-0000-000000000b01',
              name_ar: 'قهوة عربية',
              price: '25.00',
              discount_price: null,
              stock_quantity: 0,
              track_stock: true,
              image_urls: ['https://cdn.example/coffee.jpg'],
              vendor_id: '00000000-0000-0000-0000-0000000000aa',
            },
          ],
        };
      }
      return {
        rows: [
          {
            id: '00000000-0000-0000-0000-000000000b01',
            name_ar: 'قهوة عربية',
            price: '25.00',
            discount_price: null,
            stock_quantity: 100,
            track_stock: true,
            image_urls: ['https://cdn.example/coffee.jpg'],
            vendor_id: '00000000-0000-0000-0000-0000000000aa',
          },
        ],
      };
    }

    // -- coupon used_count ++ --
    if (norm.startsWith('UPDATE COUPONS')) {
      return { rows: [] };
    }

    // -- vendor_products stock decrement --
    if (norm.startsWith('UPDATE VENDOR_PRODUCTS')) {
      return { rows: [] };
    }

    // -- parent order INSERT RETURNING id --
    if (norm.startsWith('INSERT INTO ORDERS')) {
      this.nextId += 1;
      return { rows: [{ id: `parent-${this.nextId}` }] };
    }

    // -- order_items INSERT --
    if (norm.startsWith('INSERT INTO ORDER_ITEMS')) {
      return { rows: [] };
    }

    // -- vendor_orders INSERT RETURNING id --
    if (norm.startsWith('INSERT INTO VENDOR_ORDERS')) {
      this.nextId += 1;
      return { rows: [{ id: `vo-${this.nextId}` }] };
    }

    // -- vendor_order_items INSERT --
    if (norm.startsWith('INSERT INTO VENDOR_ORDER_ITEMS')) {
      return { rows: [] };
    }

    // -- loyalty pending_redeem hold --
    if (norm.startsWith('INSERT INTO LOYALTY_TRANSACTIONS')) {
      return { rows: [] };
    }

    // -- delivery_settings slots config (only when scheduled delivery used) --
    if (norm.startsWith('SELECT VALUE FROM DELIVERY_SETTINGS')) {
      return { rows: [{ value: null }] };
    }

    // -- cart DELETE --
    if (norm.startsWith('DELETE FROM CART')) {
      return { rows: [] };
    }

    // -- BEGIN / COMMIT / ROLLBACK --
    return { rows: [] };
  }

  release(): void {
    /* noop */
  }
}

// Main City Markets store. Picked ~1.1 km east of `baseAddress` so the
// Haversine distance falls inside the 2 km "included" window → fee is
// the flat 3 SAR (matches the happy-path assertions).
const baseMainStore = {
  lat: 24.7136,
  lng: 46.6853,
};

const baseAddress: DeliveryAddressRow = {
  id: '11111111-1111-1111-1111-111111111111',
  lat: 24.7136,
  lng: 46.6753,
};

const basePricing = {
  serviceFeeEnabled: true,
  serviceFeeType: 'fixed' as const,
  serviceFeeValue: 3,
};

const baseInput = {
  customerId: '99999999-9999-9999-9999-999999999999',
  guestInfo: null,
  catalog: [
    { product_id: '00000000-0000-0000-0000-000000000a01', quantity: 15 },
  ],
  vendorGroups: [
    {
      vendor_id: '00000000-0000-0000-0000-0000000000aa',
      items: [{ product_id: '00000000-0000-0000-0000-000000000b01', quantity: 2 }],
    },
  ],
  addressId: null,
  deliveryMode: 'delivery' as const,
  paymentMethod: 'cash',
  couponCode: null,
  pointsRequested: 0,
  userLoyaltyBalance: 0,
  notes: null,
  scheduledFor: null,
  slotId: null,
  idempotencyKey: 'idem-test-001',
};

describe('createCheckout', () => {
  let client: FakeClient;

  beforeEach(() => {
    client = new FakeClient();
  });

  it('returns empty_cart when both catalog and vendor groups are empty', async () => {
    const result = await createCheckout({
      client: client as unknown as PoolClient,
      input: { ...baseInput, catalog: [], vendorGroups: [] },
      pricing: basePricing,
      coupon: null,
      mainStore: baseMainStore,
      addresses: [baseAddress],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.kind).toBe('empty_cart');
    }
  });

  it('happy path — mixed cart inserts 1 parent + 1 vendor_orders child', async () => {
    client.setMode('happy');
    const result = await createCheckout({
      client: client as unknown as PoolClient,
      input: baseInput,
      pricing: basePricing,
      coupon: null,
      mainStore: baseMainStore,
      addresses: [baseAddress],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.parentOrderId).toBe('parent-1');
      expect(result.vendorOrderIds).toEqual(['vo-2']); // 1st parent, 2nd child
      expect(result.duplicate).toBe(false);
      // catalog subtotal: 15 × 8 = 120
      // vendor subtotal: 2 × 25 = 50
      // distance ~1.1 km → flat 3 SAR delivery (catalog + each vendor)
      // service fee 3
      // discount 0
      // total = (120 + 3) + (50 + 3) + 3 = 179
      expect(result.totals.catalogSubtotal).toBe(120);
      expect(result.totals.total).toBe(179);
    }

    // verify parent INSERT happened with catalog_subtotal
    const parentInsert = client.queries.find((q) =>
      q.sql.trim().toUpperCase().startsWith('INSERT INTO ORDERS'),
    );
    expect(parentInsert).toBeDefined();
    // params[] is 0-indexed. $14=totals.total lives at params[13];
    // $15=catalog_subtotal at params[14].
    expect(parentInsert!.params[13]).toBe(179);
    expect(parentInsert!.params[14]).toBe(120);

    // child idempotency key was derived as `<parent>:<slug>`
    const childInsert = client.queries.find((q) =>
      q.sql
        .trim()
        .toUpperCase()
        .startsWith('INSERT INTO VENDOR_ORDERS'),
    );
    expect(childInsert).toBeDefined();
    // last param is the idempotency_key
    expect(childInsert!.params[childInsert!.params.length - 1]).toBe(
      'idem-test-001:qahwa-amaze',
    );
    // parent_order_id is the second-to-last
    expect(childInsert!.params[childInsert!.params.length - 2]).toBe('parent-1');
  });

  it('product_not_found when catalog id has no matching products_unified row', async () => {
    client.setMode('productMissing');
    const result = await createCheckout({
      client: client as unknown as PoolClient,
      input: baseInput,
      pricing: basePricing,
      coupon: null,
      mainStore: baseMainStore,
      addresses: [baseAddress],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.kind).toBe('product_not_found');
      expect(result.productId).toBe('00000000-0000-0000-0000-000000000a01');
    }
  });

  it('stock_insufficient when vendor product is out of stock', async () => {
    client.setMode('stockShort');
    const result = await createCheckout({
      client: client as unknown as PoolClient,
      input: baseInput,
      pricing: basePricing,
      coupon: null,
      mainStore: baseMainStore,
      addresses: [baseAddress],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.kind).toBe('stock_insufficient');
      expect(result.productId).toBe('00000000-0000-0000-0000-000000000b01');
    }
  });

  it('vendor_inactive when the vendor row says is_active=false', async () => {
    client.setMode('vendorInactive');
    const result = await createCheckout({
      client: client as unknown as PoolClient,
      input: baseInput,
      pricing: basePricing,
      coupon: null,
      mainStore: baseMainStore,
      addresses: [baseAddress],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.kind).toBe('vendor_inactive');
      expect(result.vendorId).toBe('00000000-0000-0000-0000-0000000000aa');
    }
  });

  it('idempotency replay returns the existing parent + children without re-inserting', async () => {
    client.setMode('replay');
    const before = client.queries.length;
    const result = await createCheckout({
      client: client as unknown as PoolClient,
      input: baseInput,
      pricing: basePricing,
      coupon: null,
      mainStore: baseMainStore,
      addresses: [baseAddress],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.duplicate).toBe(true);
      expect(result.parentOrderId).toBe('order-original-parent-id');
      expect(result.vendorOrderIds).toEqual(['vo-existing-a', 'vo-existing-b']);
      // Replayed total comes from DB row, not from re-pricing.
      expect(result.totals.total).toBe(135);
      expect(result.totals.catalogSubtotal).toBe(120);
    }

    // No parent INSERT or vendor_orders INSERT occurred during replay.
    const insertsAfterReplay = client.queries
      .slice(before)
      .filter((q) => /INSERT INTO (ORDERS|VENDOR_ORDERS)/i.test(q.sql));
    expect(insertsAfterReplay).toHaveLength(0);
  });

  it('coupon is burned atomically (UPDATE coupons.used_count) once per checkout', async () => {
    client.setMode('happy');
    await createCheckout({
      client: client as unknown as PoolClient,
      input: {
        ...baseInput,
        catalog: [{ product_id: '00000000-0000-0000-0000-000000000a01', quantity: 15 }],
        vendorGroups: [],
        couponCode: 'WELCOME10',
      },
      pricing: basePricing,
      // coupon loaded by the route with coupon.id set (FOR UPDATE-locked)
      coupon: {
        id: 'coupon-uuid',
        code: 'WELCOME10',
        type: 'percentage',
        value: 10,
        is_active: true,
      },
      mainStore: baseMainStore,
      addresses: [baseAddress],
    });

    const couponUpdates = client.queries.filter((q) =>
      q.sql.trim().toUpperCase().startsWith('UPDATE COUPONS'),
    );
    expect(couponUpdates).toHaveLength(1);
    expect(couponUpdates[0].params[0]).toBe('coupon-uuid');
    // totals.couponDiscount = 10% of 120 = 12; that's > 0 so the UPDATE fires.
  });

  it('no_address when customer has no saved address and delivery is requested', async () => {
    client.setMode('happy');
    const result = await createCheckout({
      client: client as unknown as PoolClient,
      input: { ...baseInput, vendorGroups: [] },
      pricing: basePricing,
      coupon: null,
      mainStore: baseMainStore,
      addresses: [], // empty — no address saved
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.kind).toBe('no_address');
    }
  });

  it('pickup mode skips delivery fee resolution entirely', async () => {
    client.setMode('happy');
    const result = await createCheckout({
      client: client as unknown as PoolClient,
      input: { ...baseInput, deliveryMode: 'pickup', vendorGroups: [] },
      pricing: basePricing,
      coupon: null,
      mainStore: null,
      addresses: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.totals.totalDeliveryFee).toBe(0);
      // catalogSubtotal 120 + service 3 = 123
      expect(result.totals.total).toBe(123);
    }
  });

  it('declares requiresOnlinePayment=false for cash and true for card', async () => {
    client.setMode('happy');

    const cash = await createCheckout({
      client: client as unknown as PoolClient,
      input: { ...baseInput, deliveryMode: 'pickup', vendorGroups: [] },
      pricing: basePricing,
      coupon: null,
      mainStore: null,
      addresses: [],
    });
    expect(cash.success).toBe(true);
    if (cash.success) {
      expect(cash.requiresOnlinePayment).toBe(false);
      expect(cash.paymentStatus).toBe('pending');
    }

    client.setMode('happy');
    const card = await createCheckout({
      client: client as unknown as PoolClient,
      input: {
        ...baseInput,
        deliveryMode: 'pickup',
        vendorGroups: [],
        paymentMethod: 'card',
      },
      pricing: basePricing,
      coupon: null,
      mainStore: null,
      addresses: [],
    });
    expect(card.success).toBe(true);
    if (card.success) {
      expect(card.requiresOnlinePayment).toBe(true);
      // payment_status is 'pending' for both online and offline orders
      // (the webhook advances it to 'paid' on successful capture).
      expect(card.paymentStatus).toBe('pending');
    }
  });
});
