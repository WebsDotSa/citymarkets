/**
 * Order-related validation schemas.
 *
 * Includes:
 *   - cartItemSchema / orderItemSchema (cart line items)
 *   - createOrderSchema (legacy catalog checkout)
 *   - updateOrderSchema / orderEditSchema (admin order edits)
 *   - directOrderSchema (customer-typed free-text + product items)
 *   - orderItemAddSchema / orderItemUpdateSchema (customer-side line edits)
 *   - orderMessagePostSchema (admin/customer chat on an order)
 *   - orderStatusSchema (admin status flip)
 *   - createReviewSchema (post-delivery rating)
 */

import { z } from "zod";
import {
  couponCodeSchema,
  paymentMethodSchema,
  phoneSchema,
  uuidSchema,
} from "./schemas";
import {
  ALL_ORDER_STATES,
  ALL_PAYMENT_STATES,
  ALL_VENDOR_ORDER_STATES,
} from "@/lib/orders/state-machine";

/**
 * Cart item schema
 */
export const cartItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().positive().max(99),
});

/**
 * Order items schema (used in createOrderSchema.items)
 */
export const orderItemSchema = z.object({
  product_id: z.string().uuid("معرّف المنتج غير صالح"),
  quantity: z.number().int().positive("الكمية يجب أن تكون رقمًا موجبًا"),
});

/**
 * Create order schema — legacy catalog checkout endpoint.
 */
export const createOrderSchema = z.object({
  addressId: z.string().optional(),
  address_id: z.string().optional(),
  paymentMethod: paymentMethodSchema.optional(),
  payment_method: paymentMethodSchema.optional(),
  deliveryType: z.enum(["delivery", "pickup"]).optional(),
  delivery_type: z.enum(["delivery", "pickup"]).optional(),
  // Scheduled delivery: ISO-8601 UTC timestamp of the slot start, plus the
  // slot id from /api/v1/delivery/slots. scheduled_for is required when
  // scheduled=true; ignored when scheduled is false/unset.
  scheduled: z.boolean().optional(),
  scheduled_for: z
    .string()
    .datetime({ message: "scheduled_for must be ISO-8601" })
    .optional(),
  slot_id: z.string().max(64).optional(),
  items: z.array(orderItemSchema).optional(),
  coupon_code: z.string().max(50).optional(),
  notes: z.string().max(500).optional(),
  // Guest info
  name: z.string().max(100).optional(),
  phone: phoneSchema.optional(),
  guestInfo: z
    .object({
      name: z.string().max(100).optional(),
      phone: phoneSchema.optional(),
      city: z.string().max(50).optional(),
      district: z.string().max(100).optional(),
      street: z.string().max(200).optional(),
      building_number: z.string().max(50).optional(),
      email: z.string().email().optional().or(z.literal("")).optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
    })
    .optional(),
});

/**
 * Admin order status update enum — restricts status to known values
 * to prevent arbitrary DB writes. Mirrors the `order_status_enum`
 * Postgres type defined in migrations/001_full_schema.sql and extended
 * in migrations/033 (which added `'paid'`). `'paid'` is intentionally
 * NOT included here — it is a payment_status only and must never be
 * written to the lifecycle column.
 *
 * P2-1 (production hardening 2): the enum members are now derived from
 * `ALL_ORDER_STATES` in `@/lib/orders/state-machine` so adding a new
 * status requires a single edit in the state machine file rather than
 * four edits across the boundary-validation + driver + vendor + UI layers.
 */
export const orderStatusSchema = z.enum(
  ALL_ORDER_STATES as unknown as [string, ...string[]],
  { errorMap: () => ({ message: "حالة الطلب غير صالحة" }) },
);

/**
 * Vendor-order status enum — superset of the parent enum with vendor-only
 * values (`preparing`, `ready`, `out_for_delivery`, `refunded`). Used by
 * vendor-side PATCH endpoints that write to `vendor_orders.status`.
 */
export const vendorOrderStatusSchema = z.enum(
  ALL_VENDOR_ORDER_STATES as unknown as [string, ...string[]],
  { errorMap: () => ({ message: "حالة طلب المتجر غير صالحة" }) },
);

/**
 * Payment-status enum — orthogonal to the lifecycle enum. Used by
 * admin / system routes that explicitly write `payment_status`
 * (e.g. refund endpoint, retry flow).
 */
export const paymentStatusSchema = z.enum(
  ALL_PAYMENT_STATES as unknown as [string, ...string[]],
  { errorMap: () => ({ message: "حالة الدفع غير صالحة" }) },
);

/**
 * PUT /api/admin/orders — simple status + internal-notes flip on a single
 * order id (collection endpoint). No price / item edits.
 */
export const updateOrderSchema = z.object({
  status: orderStatusSchema.optional(),
  internal_notes: z.string().max(2000).nullable().optional(),
  // Phase 1 / T4: admin assigns / unassigns a delivery driver via the
  // simple PUT (status + notes) endpoint as well. The client passes
  // admin_users.id; the route resolves to drivers.id. null = unassign.
  driver_id: z.string().uuid().nullable().optional(),
});

/**
 * PATCH /api/admin/orders/[id] — full admin edit including direct-item
 * reconciliation. Distinct from `updateOrderSchema` (above) because the
 * two endpoints have different scopes:
 *   - updateOrderSchema   → status flip + notes only
 *   - orderEditSchema     → status + notes + price adjustments + item edit
 *
 * FIX (P0-4): previously the status enum here was the union of two
 * different Postgres enums (orders.status + vendor_orders.status).
 * That meant an admin POSTing `{status: "preparing"}` would pass Zod
 * validation then crash at the DB with
 * `invalid input value for enum order_status_enum`. Status here must
 * match the parent's `order_status_enum` only — vendor-only values
 * like `preparing`/`accepted`/`in_progress` belong on `vendor_orders`,
 * never on `orders`. Reuses `orderStatusSchema` to keep one source
 * of truth.
 */
const orderEditItemSchema = z.object({
  itemId: z.string().uuid(),
  resolved_price: z.number().min(0).max(100000).optional(),
  resolved_product_id: z.string().uuid().optional().nullable(),
  remove: z.boolean().optional(),
});

export const orderEditSchema = z.object({
  status: orderStatusSchema.optional(),
  internal_notes: z.string().max(500).optional().nullable(),
  final_subtotal: z.number().min(0).max(1000000).optional(),
  final_delivery_fee: z.number().min(0).max(1000000).optional(),
  items: z.array(orderEditItemSchema).optional(),
  // Phase 1 / T4: admin assigns or unassigns a delivery driver. The
  // client passes the admin_users.id of the driver; the API resolves it
  // to drivers.id (one drivers row per delivery_driver admin_user, joined
  // on drivers.admin_user_id). null = unassign.
  driver_id: z.string().uuid().nullable().optional(),
});

// ──────────────────────────────────────────────────────────────────────
// Direct-order (customer-typed, free-text + product items)
// ──────────────────────────────────────────────────────────────────────
//
// Used by `POST /api/v1/orders/direct` (guest + logged-in callers).

export const directOrderItemSchema = z.object({
  product_id: z.string().uuid().optional().nullable(),
  free_text: z.string().max(500).optional().nullable(),
  quantity: z.number().int().min(1).max(99).default(1),
  notes: z.string().max(200).optional().nullable(),
});

export const directOrderSchema = z.object({
  payment_method: z
    .enum(["mada", "visa", "mastercard", "amex", "apple_pay", "wallet", "bank_transfer"])
    .default("mada"),
  notes: z.string().max(700).optional().nullable(),
  voice_note_url: z.string().url().optional().nullable().or(z.literal("")),
  voice_note_duration: z.number().int().min(1).max(600).optional().nullable(),
  // P1-4 (full-system audit 2026-09-30): top-level phone capture so
  // the SMS confirmation has a destination when the caller is a
  // guest (no users row to read from). For logged-in callers the
  // route reads users.phone as a fallback. Stored in the orders
  // row's `guest_phone` column so the driver chat panel can see it
  // too.
  customer_phone: phoneSchema.optional().nullable(),
  fee_acknowledged: z
    .boolean()
    .refine((v) => v === true, { message: "يجب الموافقة على رسوم الخدمة" }),
  fee_acknowledged_at: z.string().datetime().optional(),
  delivery_address: z.object({
    // Slimmer subset of deliveryAddressSchema — re-imported lazily to
    // avoid a circular dep with validation/address.ts. Keep in sync
    // when either side changes.
    label: z.string().min(1).max(80),
    address_text: z.string().min(1).max(240),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    plus_code: z.string().max(40).optional().nullable(),
    city: z.string().max(80).optional().nullable(),
    district: z.string().max(80).optional().nullable(),
    description: z.string().max(240).optional().nullable(),
    place_images: z.array(z.string()).max(8).optional().default([]),
  }),
  items: z.array(directOrderItemSchema).max(30).optional().default([]),
  // SECURITY (F8): required for guest callers, optional for logged-in
  // users. Lets us dedupe a double-clicked "تأكيد الطلب" and prevents an
  // unauthenticated attacker from spamming order rows for someone else.
  idempotency_key: z.string().min(8).max(64).optional().nullable(),
});

// ──────────────────────────────────────────────────────────────────────
// Native APNs token registration (iOS push) — already in auth.ts.
// Realtime events ACK — see validation/broadcast.ts.
// ──────────────────────────────────────────────────────────────────────

/**
 * Order-message POST body — shared between
 *   POST /api/admin/orders/[id]/messages   (admin reply)
 *   POST /api/v1/orders/[id]/messages      (customer reply)
 * Both surfaces accept the same shape (text OR audio). The `audio_url`
 * literal-empty fallback is intentional: iOS sends `""` instead of
 * null when no audio is attached, and we don't want a 400 on that.
 */
export const orderMessagePostSchema = z.object({
  body: z.string().max(1000).optional().nullable(),
  audio_url: z.string().url().optional().nullable().or(z.literal("")),
  audio_duration: z.number().int().min(1).max(600).optional().nullable(),
  message_kind: z.enum(["text", "audio"]).default("text"),
});

/**
 * Direct-order line-item schemas. Both are owned by
 *   /api/v1/orders/[id]/items
 * which only exposes them to the customer who owns the order. They
 * are intentionally narrow — admin-side item edits (resolved_price,
 * resolved_product_id) live on `orderEditSchema.items`.
 */
export const orderItemAddSchema = z.object({
  product_id: z.string().uuid().optional().nullable(),
  free_text: z.string().max(500).optional().nullable(),
  quantity: z.number().int().min(1).max(99).default(1),
  notes: z.string().max(200).optional().nullable(),
});

/**
 * Admin-side item-add: same shape as `orderItemAddSchema` plus
 * `unit_price` so the admin can pre-fill the line cost when adding a
 * product the customer typed free-form. Used by
 *   POST /api/admin/orders/[id]/items
 * Not exposed to the customer flow — `unit_price` is admin-only.
 */
export const orderAdminItemAddSchema = orderItemAddSchema.extend({
  unit_price: z.number().min(0).max(100000).optional(),
});

export const orderItemUpdateSchema = z.object({
  quantity: z.number().int().min(1).max(99).optional(),
  notes: z.string().max(200).optional().nullable(),
  free_text: z.string().max(500).optional().nullable(),
});

/**
 * Review schema
 */
export const createReviewSchema = z.object({
  order_id: uuidSchema,
  driver_rating: z.number().int().min(1).max(5).optional(),
  store_rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(500).optional(),
});

// Re-export couponCodeSchema for callers that imported it from
// @/lib/validation (the barrel) instead of @/lib/validation/common.
export { couponCodeSchema };